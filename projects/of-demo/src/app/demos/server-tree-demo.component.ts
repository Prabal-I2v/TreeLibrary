import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Node, OfVirtualTree, OfVirtualTreeComponent } from 'of-tree';

import { TreeDataModel, createTreeData } from './tree-data';
import { matches } from './tree-backend';
import { TreeNodeComponent } from './tree-node.component';
import { NodeToggleComponent } from './node-toggle.component';

/** Search walks every loaded node, so it is debounced rather than run per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

export type SearchMode = 'client' | 'server';

/**
 * Binds an analytic-server tree straight from the API payload, and offers both search
 * strategies so the trade-off between them is visible rather than theoretical.
 */
@Component({
    selector: 'app-server-tree-demo',
    standalone: true,
    imports: [FormsModule, OfVirtualTreeComponent, TreeNodeComponent, NodeToggleComponent],
    templateUrl: './server-tree-demo.component.html',
    styleUrl: './server-tree-demo.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServerTreeDemoComponent {
    public readonly itemHeight = 28;

    private readonly backend = createTreeData();
    public readonly totalNodes = this.backend.totalNodes;
    public readonly hiddenNodes = this.backend.hiddenNodes;
    public readonly lazyServerCount = this.backend.lazyServers.length;

    public readonly selected = signal<TreeDataModel | undefined>(undefined);
    /** Feedback from the row action buttons. */
    public readonly lastAction = signal<string | undefined>(undefined);
    private readonly loadingIds = signal(new Set<string>());
    private readonly checkedIds = signal(new Set<string>());
    /** State owned by this component, driven by a projected toggle rather than by the row. */
    private readonly enabledIds = signal(new Set<string>());

    public readonly searchMode = signal<SearchMode>('client');
    public readonly searchText = signal('');
    public readonly searching = signal(false);
    public readonly matchCount = signal(0);
    /** What the last search cost, so the two modes can be compared honestly. */
    public readonly lastSearch = signal<{ ms: number; requests: number; loaded: number } | undefined>(undefined);
    private searchTimer: ReturnType<typeof setTimeout> | undefined;
    private searchToken = 0;

    private readonly revision = signal(0);
    public readonly visibleRows = computed(() => {
        this.revision();
        return this.model.items.length;
    });
    public readonly checkedCount = computed(() => this.checkedIds().size);

    public readonly model = new OfVirtualTree<TreeDataModel>({
        // `isParent` is the authority, NOT children.length. Lazy servers arrive with
        // children: [] but are still expandable - that is what drives the lazy fetch.
        canExpand: item => item.isParent,
        // null and [] both mean "nothing to walk yet". undefined is what the tree expects.
        childAccessor: item => item.children ?? undefined,
        lazyLoad: true
    });

    constructor() {
        this.model.load(this.backend.nodes);
        this.model.onDataInvalidated.pipe(takeUntilDestroyed()).subscribe(() => this.revision.update(n => n + 1));
    }

    public get isFiltered() {
        return this.model.isFiltered();
    }

    public setMode(mode: SearchMode) {
        if (this.searchMode() === mode) {
            return;
        }
        this.searchMode.set(mode);
        if (this.searchText()) {
            this.onSearch(this.searchText());
        }
    }

    public onSearch(value: string) {
        this.searchText.set(value);
        clearTimeout(this.searchTimer);

        const term = value.trim().toLowerCase();
        const token = ++this.searchToken;

        if (!term) {
            this.searching.set(false);
            this.model.setFilter(undefined);
            this.matchCount.set(0);
            this.lastSearch.set(undefined);
            return;
        }

        this.searching.set(true);
        this.searchTimer = setTimeout(() => {
            if (this.searchMode() === 'server') {
                void this.runServerSearch(term, token);
            } else {
                this.runClientSearch(term, token);
            }
        }, SEARCH_DEBOUNCE_MS);
    }

    public clearSearch() {
        this.onSearch('');
    }

    /**
     * Client-side: pull down every lazy server first, then filter locally. Complete coverage,
     * but it costs one request per unloaded server before the first result can be shown.
     */
    private async runClientSearch(term: string, token: number) {
        const started = performance.now();
        const outstanding = this.backend.lazyServers.filter(server => this.needsLoad(server));

        if (outstanding.length) {
            await Promise.all(outstanding.map(server => this.loadChildren(server)));
            if (token !== this.searchToken) {
                return;
            }
            this.model.reloadTree();
        }

        const predicate = (item: TreeDataModel) => matches(item, term);
        this.model.setFilter(predicate);
        this.matchCount.set(this.model.items.filter(node => predicate(node.item)).length);
        this.lastSearch.set({
            ms: Math.round(performance.now() - started),
            requests: outstanding.length,
            loaded: outstanding.length
        });
        this.searching.set(false);
    }

    /**
     * Server-side: ask the API which nodes match, then load only the servers needed to show
     * them. One search request plus a fetch per server that actually contains a hit.
     */
    private async runServerSearch(term: string, token: number) {
        const started = performance.now();
        const result = await this.backend.search(term);
        if (token !== this.searchToken) {
            return;
        }

        const toLoad = result.serversToLoad.filter(server => this.needsLoad(server));
        if (toLoad.length) {
            await Promise.all(toLoad.map(server => this.loadChildren(server)));
            if (token !== this.searchToken) {
                return;
            }
            this.model.reloadTree();
        }

        this.model.setFilter(item => result.matchIds.has(item.id));
        this.matchCount.set(result.total);
        this.lastSearch.set({
            ms: Math.round(performance.now() - started),
            requests: 1 + toLoad.length,
            loaded: toLoad.length
        });
        this.searching.set(false);
    }

    public isLoading(item: TreeDataModel) {
        return this.loadingIds().has(item.id);
    }

    public isChecked(item: TreeDataModel) {
        return this.checkedIds().has(item.id);
    }

    /** True when some, but not all, loaded descendants are checked. */
    public isIndeterminate(item: TreeDataModel) {
        const descendants = this.loadedDescendants(item);
        if (!descendants.length) {
            return false;
        }
        const checked = descendants.filter(d => this.checkedIds().has(d.id)).length;
        return checked > 0 && checked < descendants.length;
    }

    /**
     * A node that still needs loading is always fetched and left expanded, whatever its
     * current expand state. Without that, a lazy server left "expanded but empty" by
     * expandAll would need two clicks: one to collapse, another to load.
     */
    public async toggle(item: TreeDataModel, event: MouseEvent) {
        event.stopPropagation();
        if (!item.isParent || this.isLoading(item)) {
            return;
        }

        if (this.needsLoad(item)) {
            await this.loadChildren(item);
            this.model.setExpanded(item, true);
            this.model.invalidateItem(item);
            return;
        }

        this.model.toggle(item);
    }

    // --- Handlers for the actions this component projects into each row -------------------

    public showInfo(node: Node<TreeDataModel>) {
        const item = node.item;
        this.select(item);
        this.lastAction.set(`${item.name} — ${item.data.typeOfNode}, ${item.data.ip}, id ${item.resourceId}`);
    }

    public copyId(item: TreeDataModel) {
        navigator.clipboard?.writeText(item.resourceId).catch(() => undefined);
        this.lastAction.set(`Copied resource id of ${item.name}`);
    }

    public removeNode(node: Node<TreeDataModel>) {
        // Mutate the data, then tell the tree that this parent's children changed.
        const item = node.item;
        const parent = node.parent;
        const siblings = this.childListOf(parent);
        const index = siblings.indexOf(item);
        if (index < 0) {
            return;
        }
        siblings.splice(index, 1);

        if (this.selected() === item) {
            this.selected.set(undefined);
        }
        // A top-level node's parent is the tree's synthetic root, whose item is not one of
        // ours, so the whole tree has to be re-read in that case.
        if (parent && !parent.isRoot) {
            this.model.invalidateItem(parent.item);
        } else {
            this.model.reloadTree();
        }
        this.lastAction.set(`Removed ${item.name}`);
    }

    public isEnabled(item: TreeDataModel) {
        return this.enabledIds().has(item.id);
    }

    public setEnabled(item: TreeDataModel, on: boolean) {
        this.enabledIds.update(prev => {
            const next = new Set(prev);
            if (on) {
                next.add(item.id);
            } else {
                next.delete(item.id);
            }
            return next;
        });
        this.lastAction.set(`${item.name} ${on ? 'enabled' : 'disabled'}`);
    }

    public select(item: TreeDataModel) {
        this.model.selectAndHighlight(item);
        this.selected.set(item);
    }

    /** Checking a node cascades to every descendant that is currently loaded. */
    public toggleCheck(item: TreeDataModel, event: Event) {
        event.stopPropagation();
        const turningOn = !this.isChecked(item);
        const affected = [item, ...this.loadedDescendants(item)];

        this.checkedIds.update(prev => {
            const next = new Set(prev);
            for (const node of affected) {
                if (turningOn) {
                    next.add(node.id);
                } else {
                    next.delete(node.id);
                }
                node.checked = turningOn;
            }
            return next;
        });
    }

    /**
     * Lazy servers are deliberately left collapsed. Marking them expanded would render a
     * down arrow over nothing, since their children are not client-side yet.
     */
    public expandAll() {
        this.model.expandAll();
        for (const server of this.backend.lazyServers) {
            if (this.needsLoad(server)) {
                this.model.setExpanded(server, false);
            }
        }
        this.model.invalidateData();
    }

    public collapseAll() {
        this.model.collapseAll();
    }

    public selectedPath() {
        const item = this.selected();
        if (!item) {
            return '(nothing selected)';
        }
        const node = this.model.getTreeNode(item);
        if (!node) {
            return item.name;
        }

        const parts = [node.item.name];
        for (const ancestor of node.ancestors()) {
            if (!ancestor.isRoot) {
                parts.unshift(ancestor.item.name);
            }
        }
        return '/' + parts.join('/');
    }

    public trackLabel(node: Node<TreeDataModel>) {
        const { typeOfNode, ip } = node.item.data;

        if (typeOfNode === 'VideoSource') {
            return ip;
        }
        if (typeOfNode === 'Pipeline') {
            const sources = node.item.children?.length ?? 0;
            return `${sources} source${sources === 1 ? '' : 's'} · Pipeline`;
        }
        return `${ip} · ${typeOfNode}`;
    }

    /** The array a node lives in: its parent's children, or the root data set. */
    private childListOf(node: Node<TreeDataModel> | undefined): TreeDataModel[] {
        return !node || node.isRoot ? this.backend.nodes : (node.item.children ?? []);
    }

    private needsLoad(item: TreeDataModel) {
        return item.isParent && (item.children === null || item.children.length === 0);
    }

    private async loadChildren(server: TreeDataModel) {
        this.setLoading(server.id, true);
        try {
            server.children = await this.backend.fetchChildren(server);
        } finally {
            this.setLoading(server.id, false);
        }
    }

    private setLoading(id: string, loading: boolean) {
        this.loadingIds.update(prev => {
            const next = new Set(prev);
            if (loading) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }

    private loadedDescendants(item: TreeDataModel): TreeDataModel[] {
        const result: TreeDataModel[] = [];
        const walk = (nodes: TreeDataModel[] | null) => {
            for (const child of nodes ?? []) {
                result.push(child);
                walk(child.children);
            }
        };
        walk(item.children);
        return result;
    }
}
