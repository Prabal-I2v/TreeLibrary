import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Node, OfVirtualTree, OfVirtualTreeComponent } from 'of-tree';

import { ServerTreeNode, createServerTree } from './server-tree-data';
import { matches } from './server-tree-backend';

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
    imports: [FormsModule, OfVirtualTreeComponent],
    templateUrl: './server-tree-demo.component.html',
    styleUrl: './server-tree-demo.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServerTreeDemoComponent {
    public readonly itemHeight = 28;

    private readonly backend = createServerTree();
    public readonly totalNodes = this.backend.totalNodes;
    public readonly hiddenNodes = this.backend.hiddenNodes;
    public readonly lazyServerCount = this.backend.lazyServers.length;

    public readonly selected = signal<ServerTreeNode | undefined>(undefined);
    private readonly loadingIds = signal(new Set<string>());
    private readonly checkedIds = signal(new Set<string>());

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

    public readonly model = new OfVirtualTree<ServerTreeNode>({
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

        const predicate = (item: ServerTreeNode) => matches(item, term);
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

    public isLoading(item: ServerTreeNode) {
        return this.loadingIds().has(item.id);
    }

    public isChecked(item: ServerTreeNode) {
        return this.checkedIds().has(item.id);
    }

    /** True when some, but not all, loaded descendants are checked. */
    public isIndeterminate(item: ServerTreeNode) {
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
    public async toggle(item: ServerTreeNode, event: MouseEvent) {
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

    public select(item: ServerTreeNode) {
        this.model.selectAndHighlight(item);
        this.selected.set(item);
    }

    /** Checking a node cascades to every descendant that is currently loaded. */
    public toggleCheck(item: ServerTreeNode, event: Event) {
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

    public trackLabel(node: Node<ServerTreeNode>) {
        return node.item.data.typeOfNode === 'VideoSource' ? node.item.data.ip : `${node.item.data.ip} · ${node.item.data.typeOfNode}`;
    }

    private needsLoad(item: ServerTreeNode) {
        return item.isParent && (item.children === null || item.children.length === 0);
    }

    private async loadChildren(server: ServerTreeNode) {
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

    private loadedDescendants(item: ServerTreeNode): ServerTreeNode[] {
        const result: ServerTreeNode[] = [];
        const walk = (nodes: ServerTreeNode[] | null) => {
            for (const child of nodes ?? []) {
                result.push(child);
                walk(child.children);
            }
        };
        walk(item.children);
        return result;
    }
}
