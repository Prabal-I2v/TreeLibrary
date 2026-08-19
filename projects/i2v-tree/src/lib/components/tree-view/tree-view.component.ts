import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ContentChild,
    EventEmitter,
    Input,
    Output,
    TemplateRef,
    ViewChild,
    inject
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { I2vTreeComponent } from '../tree/tree.component';
import { I2vTreeConfig } from '../tree/tree.config';
import { I2vTree } from '../tree/tree.model';
import { I2vTreeRowDirective, I2vTreeRowPrefixDirective, I2vTreeRowSuffixDirective } from '../tree/tree.templates';
import { I2vTreeSearch } from '../../models';

/**
 * A named field the search box can be pointed at, eg. { key: 'name', label: 'Name' }.
 */
export interface I2vSearchField {
    key: string;
    label: string;
}

/**
 * Batteries-included tree: an {@link I2vTreeComponent} plus a header, a search box, and the empty,
 * no-result and loading states.
 *
 * Every user-visible string is an input with an English default rather than a translation key, so
 * the library carries no i18n dependency -- bind `[emptyText]="'No data' | translate"` to localize.
 * Menus are raised as events rather than rendered, so the host supplies its own menu component.
 */
@Component({
    selector: 'i2v-tree-view',
    standalone: true,
    // The row directives are queried from projected content, not used in this template -- the
    // templates they carry are handed to the tree as inputs.
    imports: [I2vTreeComponent, NgTemplateOutlet],
    templateUrl: './tree-view.component.html',
    styleUrl: './tree-view.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class I2vTreeViewComponent {
    private readonly cdr = inject(ChangeDetectorRef);

    /** @ignore */
    @ViewChild(I2vTreeComponent)
    public tree?: I2vTreeComponent;

    /** @ignore Row and slot templates are forwarded to the inner tree. */
    @ContentChild(I2vTreeRowDirective)
    public rowTemplate?: I2vTreeRowDirective;

    /** @ignore */
    @ContentChild(I2vTreeRowPrefixDirective)
    public rowPrefix?: I2vTreeRowPrefixDirective;

    /** @ignore */
    @ContentChild(I2vTreeRowSuffixDirective)
    public rowSuffix?: I2vTreeRowSuffixDirective;

    /** Replaces the built-in empty state. */
    @ContentChild('i2vTreeEmpty', { read: TemplateRef })
    public emptyTemplate?: TemplateRef<any>;

    /** Replaces the built-in no-result state. */
    @ContentChild('i2vTreeNoResult', { read: TemplateRef })
    public noResultTemplate?: TemplateRef<any>;

    /** Replaces the built-in loading state. */
    @ContentChild('i2vTreeLoading', { read: TemplateRef })
    public loadingTemplate?: TemplateRef<any>;

    @Input() public model?: I2vTree<any>;
    @Input() public config: I2vTreeConfig<any> = {};
    @Input() public data: any[] = [];
    @Input() public itemHeight?: number;
    @Input() public selection: any;

    /** Accessible name forwarded to the tree. */
    @Input() public ariaLabel: string | null = null;

    @Input() public showHeader = true;
    @Input() public title = '';
    @Input() public showRefresh = false;
    @Input() public showExpandToggle = false;
    @Input() public showSearch = true;
    @Input() public searchPlaceholder = 'Search';

    /**
     * Fields the search box may target. With more than one, a "search by" affordance is shown and
     * raises {@link searchByMenu} for the host to render.
     */
    @Input() public searchFields: I2vSearchField[] = [];
    @Input() public searchField?: string;
    @Input() public searchDebounce = 300;
    @Input() public searchMinLength = 2;

    /** Named tree configurations, for the legacy config switcher. */
    @Input() public configNames: string[] = [];
    @Input() public selectedConfigName?: string;

    @Input() public showCount = false;
    /** Groups the count summary, eg. `item => item.typeOfNode`. */
    @Input() public countBy?: (item: any) => string | undefined;

    @Input() public loading = false;
    @Input() public emptyText = 'No data.';
    @Input() public noResultText = 'No result found!';
    @Input() public loadingText = 'Loading…';

    @Output() public refresh = new EventEmitter<void>();
    @Output() public searchTextChange = new EventEmitter<string>();
    @Output() public searchByMenu = new EventEmitter<{ event: MouseEvent }>();
    @Output() public configMenu = new EventEmitter<{ event: MouseEvent }>();
    @Output() public expandAllChange = new EventEmitter<boolean>();
    @Output() public noResult = new EventEmitter<boolean>();
    @Output() public countsChanged = new EventEmitter<Map<string, number>>();

    @Output() public selectionChange = new EventEmitter<any>();
    @Output() public itemContextMenu = new EventEmitter<{ event: MouseEvent; item: any }>();
    @Output() public itemDblClick = new EventEmitter<{ event: MouseEvent; item: any }>();
    @Output() public rowClick = new EventEmitter<{ event: MouseEvent; item: any }>();
    @Output() public checkChange = new EventEmitter<{ item: any; checked: boolean }>();

    /**
     * Expanded state of the expand-all toggle.
     *
     * Held per instance. The legacy tree kept this on a root-provided singleton, so expanding one
     * tree flipped the button on every other tree on the page.
     */
    public isExpanded = false;

    private _searchText = '';
    private searchTimeout?: any;
    private lastNoResult = false;

    public get searchText() {
        return this._searchText;
    }

    /**
     * True when the tree holds no rows and no search is narrowing it -- "there is nothing here",
     * as opposed to "nothing matched".
     */
    public get isEmpty() {
        return !this.loading && !this.hasRows && !this.hasActiveSearch;
    }

    /**
     * True when a search is active and matched nothing.
     *
     * A derived getter, replacing the legacy `document.dispatchEvent(new CustomEvent(treeID))`
     * channel that pushed this state out through the DOM.
     */
    public get isNoResult() {
        return !this.loading && !this.hasRows && this.hasActiveSearch;
    }

    /** @ignore True when the tree has rows to show. */
    public get showTree() {
        return !this.loading && this.hasRows;
    }

    /** @ignore */
    public get expandToggleLabel() {
        return this.isExpanded ? 'Collapse all' : 'Expand all';
    }

    /** @ignore */
    public handleSearchInput(value: string) {
        this._searchText = value;
        clearTimeout(this.searchTimeout);

        this.searchTimeout = setTimeout(() => {
            this.applySearch(value);
            this.cdr.markForCheck();
        }, this.searchDebounce);
    }

    /**
     * Clear the search box and restore the unfiltered tree.
     */
    public clearSearch() {
        clearTimeout(this.searchTimeout);
        this._searchText = '';
        this.applySearch('');
    }

    /** @ignore */
    public handleRefresh() {
        this.clearSearch();
        this.refresh.emit();
    }

    /**
     * Expand or collapse the whole tree, flipping the toggle.
     */
    public toggleExpandAll() {
        this.isExpanded = !this.isExpanded;

        if (this.isExpanded) {
            this.treeModel?.expandAll();
        } else {
            this.treeModel?.collapseAll();
        }

        this.expandAllChange.emit(this.isExpanded);
    }

    /** @ignore */
    public selectSearchField(key: string) {
        this.searchField = key;
        this.applySearch(this._searchText);
    }

    /**
     * Counts grouped by {@link countBy}, for the summary tooltip.
     *
     * Returns the map rather than a formatted string: pluralization and translation belong to the
     * host. The legacy service built the string itself and so could never be localized.
     */
    public getCounts(): Map<string, number> {
        return this.countBy && this.treeModel ? this.treeModel.countBy(this.countBy) : new Map();
    }

    /** @ignore */
    public getCountSummary() {
        const counts = this.getCounts(),
            parts = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => `${key}: ${n}`),
            total = [...counts.values()].reduce((sum, n) => sum + n, 0);

        return parts.length ? `${parts.join(', ')}\nTotal: ${total}` : '';
    }

    /** @ignore Re-emitted so the host binds one component, not two. */
    public forwardNoResult() {
        const current = this.isNoResult;
        if (current !== this.lastNoResult) {
            this.lastNoResult = current;
            this.noResult.emit(current);
        }
    }

    private get treeModel() {
        return this.tree?.model ?? this.model;
    }

    private get hasRows() {
        return (this.treeModel?.items.length ?? 0) > 0;
    }

    private get hasActiveSearch() {
        return this._searchText.length >= this.searchMinLength;
    }

    /**
     * Push the term into the tree as a predicate.
     *
     * Built here rather than delegating to the tree's own `filterText` so the field selector can
     * choose which properties are searched, and so the debounce is the one the header owns.
     */
    private applySearch(value: string) {
        const tree = this.tree;
        if (!tree) {
            return;
        }

        if (value.length < this.searchMinLength) {
            tree.filter = undefined;
        } else {
            const field = this.searchField,
                getName = (item: any) => tree.getName(item);

            tree.filter = I2vTreeSearch.buildPredicate<any>(value, item => [
                field ? item?.[field] : undefined,
                field ? undefined : getName(item)
            ]);
        }

        // Highlight only. Setting filterText here would schedule the tree's own throttled filter,
        // which would then race the predicate just applied above and win.
        tree.highlightTerm = value;
        this.searchTextChange.emit(value);
        this.forwardNoResult();
        this.countsChanged.emit(this.getCounts());
    }
}
