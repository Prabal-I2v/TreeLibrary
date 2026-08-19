import { EventEmitter } from '@angular/core';
import { I2vCheckModel, I2vSelectionModel, Node, TreeQuery, TreeConfig } from '../../models';
import { I2vTreeConfig, TreeChildAccessor } from './tree.config';

export class I2vTree<ItemType> {
    private expandedItems = new Set<ItemType>();
    private highlighted?: ItemType;
    private selectedItem?: ItemType;
    private _query: TreeQuery<ItemType>;
    private filter?: (item: ItemType) => boolean;

    public onDataInvalidated = new EventEmitter();
    public onSelectionChanged = new EventEmitter<ItemType>();
    public onHighlightChanged = new EventEmitter<ItemType>();

    public items: Node<ItemType>[] = [];

    /**
     * Tri-state check state for this tree.
     *
     * Composed rather than inherited so it can be created before the tree and handed in: a
     * multiselect holds check state -- and therefore renders chips -- while its panel is closed and
     * the tree does not exist. Pass one via the constructor to share it, or use the one created here.
     */
    public readonly checks: I2vCheckModel<ItemType>;

    /**
     * Row selection. Separate from {@link checks}: selection follows the keyboard and is what the
     * user is looking at, checks are what they have picked. zTree conflated the two, which is why
     * its ctrl-click both multi-selected and suppressed every event it should have raised.
     */
    public readonly selection: I2vSelectionModel<ItemType>;

    public get query() {
        return this._query;
    }

    constructor(private config: I2vTreeConfig<ItemType>, query?: TreeQuery<ItemType>, checks?: I2vCheckModel<ItemType>) {
        if (query) {
            this._query = query;
        } else {
            this._query = new TreeConfig<ItemType>(this.syncChildAccessor(), !this.config.lazyLoad).query([]);
        }

        this.checks = checks ?? new I2vCheckModel<ItemType>(this.resolveCheckConfig());
        this.checks.attach(() => this._query);
        this.selection = new I2vSelectionModel<ItemType>(this.config.selectionMode ?? 'single');
    }

    public updateConfig(value: I2vTreeConfig<ItemType>) {
        this.config = value;
        this.checks.updateConfig(this.resolveCheckConfig());
        this.selection.setMode(value.selectionMode ?? 'single');
    }

    /**
     * Check options come from the tree config so consumers configure one object. `promoteParents`
     * defaults off under lazy loading, where a parent's children may not all be present yet.
     */
    private resolveCheckConfig() {
        return {
            promoteParents: !this.config.lazyLoad,
            keyOf: this.config.keyOf,
            ...this.config.check
        };
    }

    public isFiltered() {
        return this.filter !== undefined;
    }

    public isSelected(item: ItemType) {
        return this.selection.getMode() === 'multiple' ? this.selection.isSelected(item) : this.selectedItem === item;
    }

    /**
     * Every selected item. In single-select this is the one selected item, or empty.
     */
    public getSelectedItems(): ItemType[] {
        if (this.selection.getMode() === 'multiple') {
            return this.selection.getSelected();
        }
        return this.selectedItem === undefined ? [] : [this.selectedItem];
    }

    /**
     * Apply a selection gesture, honouring ctrl and shift in multi-select mode.
     *
     * The range for a shift gesture is computed here rather than in the selection model, because
     * only the tree knows the current flattened order -- and that visual order, not the data order,
     * is what a user means by "everything between these two rows".
     */
    public selectWithModifiers(item: ItemType, modifiers: { ctrl?: boolean; shift?: boolean } = {}) {
        if (this.selection.getMode() !== 'multiple') {
            this.selectAndHighlight(item);
            return;
        }

        let range: ItemType[] | undefined;
        const anchor = this.selection.getAnchor();

        if (modifiers.shift && anchor !== undefined) {
            const from = this.getItemIndex(anchor),
                to = this.getItemIndex(item);

            if (from >= 0 && to >= 0) {
                range = this.items.slice(Math.min(from, to), Math.max(from, to) + 1).map(n => n.item);
            }
        }

        this.selection.select(item, modifiers, range);
        // Keep the single-selection field in step so getSelectedItem, and anything reading it,
        // still reports the item the user last touched.
        this.selectedItem = item;
        this.highlight(item);
        this.onSelectionChanged.emit(item);
    }

    public isExpanded(item: ItemType) {
        return this.expandedItems.has(item);
    }

    public isHighlighted(item: ItemType) {
        return this.highlighted === item;
    }

    public highlightByIndex(index: number | undefined) {
        const item = index === undefined || this.items[index] === undefined ? undefined : this.items[index].item;
        this.highlight(item);
    }

    public getSelectedIndex() {
        const selectedNode = this.selectedItem ? this.query.findNode(this.selectedItem) : undefined,
            result = selectedNode ? this.items.indexOf(selectedNode) : undefined;
        return result;
    }

    public getItemIndex(item: ItemType) {
        const node = this.query.findNode(item);
        return node ? this.items.indexOf(node) : -1;
    }

    /**
     * Get the TreeQuery's node for the passed item
     * @param item item for which to get the node
     */
    public getTreeNode(item: ItemType) {
        return this.query.findNode(item);
    }

    /**
     * Set the currently highlighted item
     * @param item item to select
     */
    public select(item: ItemType) {
        if (this.selectedItem !== item) {
            this.selectedItem = item;
            this.onSelectionChanged.emit(item);
        }
    }

    /**
     * Set the currently highlighted item
     * @param item item to highlight, undefined to unset the highlighted item
     */
    public highlight(item: ItemType | undefined) {
        if (this.highlighted !== item) {
            this.highlighted = item;
            this.onHighlightChanged.emit(item);
        }
    }

    /**
     * Set the passed item as the currently selected and highlighted item
     * @param item item to select & highlight
     */
    public selectAndHighlight(item: ItemType) {
        this.select(item);
        this.highlight(item);
    }

    /**
     * Get the item that is currently selected
     */
    public getSelectedItem() {
        return this.selectedItem;
    }

    /**
     * Get the item that is currently highlighted
     */
    public getHighlightedItem() {
        return this.highlighted;
    }

    /**
     * Selects the highlighted node, and toggles its expand state
     */
    public selectHighlightedItem() {
        let didChange = false;
        if (this.highlighted) {
            this.toggle(this.highlighted);
            didChange = this.selectedItem !== this.highlighted;
            this.select(this.highlighted);
        }

        return didChange;
    }

    /**
     * Expand all ancestry of the currently selected item
     */
    public expandToSelectedItem() {
        if (this.selectedItem) {
            this.expandToItem(this.selectedItem);
            this.invalidateData();
        }
    }

    /**
     * Expand all ancestry of the passed item
     * @param item item to expand to
     */
    public expandToItem(item: ItemType) {
        const node = this.query.findNode(item);
        if (node) {
            for (const parent of node.ancestors()) {
                if (!parent.isRoot) {
                    this.expandedItems.add(parent.item);
                }
            }
        }
    }

    /**
     * Toggle the expanded state of the passed item
     * @param item item to toggle
     */
    public toggle(item: ItemType) {
        if (this.isExpandable(item)) {
            if (this.isExpanded(item)) {
                this.expandedItems.delete(item);
            } else {
                this.expandedItems.add(item);
                if (this.config.expandMode === 'accordion') {
                    this.collapseSiblings(item);
                }
            }
            this.invalidateData();
        }
    }

    /**
     * Collapse everything alongside the item so only its branch stays open -- zTree's `singlePath`.
     *
     * Collapses siblings and their subtrees, leaving the item's own ancestors untouched, so
     * expanding deep in a branch does not close the path that leads to it.
     */
    private collapseSiblings(item: ItemType) {
        const node = this.query.findNode(item);
        if (!node || !node.parent) {
            return;
        }

        for (const sibling of node.parent.children) {
            if (sibling.item !== item) {
                sibling.visitSubtree(n => this.expandedItems.delete(n.item));
            }
        }
    }

    /**
     * Set the expanded state of an item. This does nothing if the item is not expandable or already in the desired state
     * This does not update the UI. Expect to call invalidateData/invalidateItem to see the effect.
     * @param item item to expanded or collapse
     * @param expanded true to expand, false to collapse
     */
    public setExpanded(item: ItemType, expanded: boolean) {
        if (this.isExpandable(item)) {
            const isExpanded = this.isExpanded(item);
            if (isExpanded && !expanded) {
                this.expandedItems.delete(item);
            } else if (!isExpanded && expanded) {
                this.expandedItems.add(item);
            }
        }
    }

    public expandAll() {
        for (const node of this.query) {
            if (this.isExpandable(node.item)) {
                this.expandedItems.add(node.item);
            }
        }
        this.invalidateData();
    }

    public collapseAll() {
        this.expandedItems.clear();
        this.invalidateData();
    }

    /**
     * Apply a filter that ignore expand state and makes visible all nodes that either
     * match the predicate or contain a child that matches the predicate
     * @param filter predicate, true to make a node visible
     */
    public setFilter(filter: undefined | ((item: ItemType) => boolean)) {
        this.filter = filter;
        this.invalidateData();
    }

    /**
     * Returns true if the passed item is expandable
     * @param item item to check
     */
    public isExpandable(item: ItemType) {
        let result = false;

        if (!this.filter && this.config.canExpand) {
            result = this.config.canExpand(item);
        } else {
            const node = this.query.findNode(item);
            result = !!node && node.hasChildren;
        }

        return result;
    }

    /**
     * Update data from the root
     * @param items Data to load
     */
    public load(items: ItemType[]) {
        this._query = new TreeConfig<ItemType>(this.syncChildAccessor(), !this.config.lazyLoad).query(items);
        // Re-resolve check decisions against the new items, so state keyed by `keyOf` survives a
        // reload into structurally equal but non-identical objects.
        this.checks.rebuild();
        this.invalidateData();
    }

    /**
     * Expand every item down to the given depth, leaving deeper levels closed. Depth 0 expands the
     * roots only. Cheaper than {@link expandAll} on a large tree, and the usual "open the first two
     * levels" gesture.
     */
    public expandToDepth(depth: number) {
        this.expandedItems.clear();

        for (const node of this.query) {
            if (node.depth <= depth && this.isExpandable(node.item)) {
                this.expandedItems.add(node.item);
            }
        }

        this.invalidateData();
    }

    /**
     * Find a loaded item by its `keyOf` value. Replaces the legacy `getTreeNodeById`.
     *
     * Requires `config.keyOf`; without it there is no notion of a key and this always returns
     * undefined rather than guessing at an `id` property.
     */
    public findByKey(key: unknown): ItemType | undefined {
        const keyOf = this.config.keyOf;
        if (!keyOf) {
            return undefined;
        }

        for (const node of this.query) {
            if (keyOf(node.item) === key) {
                return node.item;
            }
        }

        return undefined;
    }

    /**
     * Every loaded item matching a predicate. Replaces the legacy `getAllTreeNodesByParam`, which
     * called a zTree function that does not exist and so always returned an empty array.
     */
    public findItems(predicate: (item: ItemType) => boolean): ItemType[] {
        const result: ItemType[] = [];

        for (const node of this.query) {
            if (predicate(node.item)) {
                result.push(node.item);
            }
        }

        return result;
    }

    /**
     * Every loaded item whose named property equals a value. Replaces the legacy
     * `getTreeNodeByParam` / `getTreeNodeByName` lookups.
     */
    public findByField(field: string, value: unknown): ItemType[] {
        return this.findItems(item => (item as any)?.[field] === value);
    }

    /**
     * Count loaded items grouped by a selector, for "3 cameras, 2 groups" style summaries.
     *
     * Returns the counts rather than a formatted string, because the formatting is the consumer's --
     * it is where translation and pluralization belong. The legacy service built the string itself
     * and so could never be localized.
     */
    public countBy(selector: (item: ItemType) => string | undefined): Map<string, number> {
        const counts = new Map<string, number>();

        for (const node of this.query) {
            const key = selector(node.item);
            if (key !== undefined) {
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }

        return counts;
    }

    /**
     * Signal children to be reloaded for a particular node.
     * Has no effect if the passed parent has not been loaded
     * @param parent item to reload
     */
    public reloadChildren(parent: ItemType) {
        const node = parent ? this.query.findNode(parent) : this.query.getRootNode();
        if (node) {
            node.invalidateChildren(!this.config.lazyLoad);
            this.invalidateData();
        }
    }

    /**
     * Signal the tree to reload all data
     */
    public reloadTree() {
        const root = this.query.getRootNode();
        root.invalidateChildren(!this.config.lazyLoad);
        this.invalidateData();
    }

    /**
     * Change the highlighted node by the given direction.
     * 'Left' will collapse before navigation.
     * 'Right' will expand before navigation.
     * @param direction 'Left' | 'Up' | 'Down' | 'Right'
     */
    public navigate(direction: string | 'Left' | 'Right' | 'Up' | 'Down' | 'Home' | 'End') {
        const selectedNode = this.highlighted ? this.query.findNode(this.highlighted) : undefined,
            index = selectedNode ? this.items.indexOf(selectedNode) : undefined;
        let nextSelectedIndex;

        if (direction === 'Home') {
            nextSelectedIndex = this.items.length ? 0 : undefined;
        } else if (direction === 'End') {
            nextSelectedIndex = this.items.length ? this.items.length - 1 : undefined;
        } else if (direction === 'Up') {
            nextSelectedIndex = index === undefined ? this.items.length - 1 : index === 0 ? undefined : index - 1;
        } else if (
            direction === 'Down' ||
            (direction === 'Right' && this.highlighted && (!this.isExpandable(this.highlighted) || this.isExpanded(this.highlighted)))
        ) {
            nextSelectedIndex = index === undefined ? 0 : index === this.items.length - 1 ? undefined : index + 1;
        } else if (direction === 'Left' && selectedNode) {
            if (this.highlighted && this.isExpanded(this.highlighted)) {
                this.toggle(this.highlighted);
                nextSelectedIndex = index;
            } else if (selectedNode.parent) {
                nextSelectedIndex = this.items.indexOf(selectedNode.parent);
            }
        } else if (direction === 'Right') {
            if (this.highlighted && !this.isExpanded(this.highlighted)) {
                this.toggle(this.highlighted);
                nextSelectedIndex = index;
            }
        }

        this.highlightByIndex(nextSelectedIndex);
        return nextSelectedIndex;
    }

    /**
     * Move the highlight to the next visible row whose name starts with `prefix`.
     *
     * Searches forward from the current highlight and wraps, so repeatedly typing the same letter
     * cycles through the matches. Reads the name through the config rather than a DOM attribute --
     * zTree required an `accesskey` property on every node for this.
     *
     * @returns the index highlighted, or undefined if nothing matched
     */
    public typeahead(prefix: string, getName: (item: ItemType) => string): number | undefined {
        const needle = prefix.toLowerCase();
        if (!needle || !this.items.length) {
            return undefined;
        }

        const current = this.highlighted ? this.items.findIndex(n => n.item === this.highlighted) : -1;

        for (let offset = 1; offset <= this.items.length; offset++) {
            const at = (current + offset + this.items.length) % this.items.length;
            if ((getName(this.items[at].item) || '').toLowerCase().startsWith(needle)) {
                this.highlightByIndex(at);
                return at;
            }
        }

        return undefined;
    }

    /**
     * Signal that the state has changed and the tree needs to be revisited
     */
    public invalidateData() {
        if (this.filter) {
            this.items = this.query
                .descend()
                .hasDescendant(this.filter)
                .toArray();
        } else {
            this.items = this.query
                .forwardOverride((curr, fallback) =>
                    !curr.isRoot && !this.isExpanded(curr.item) ? curr.next || curr.ancestorForward() : fallback()
                )
                .whereNode(n => this.isExpanded(n.parent!.item) || n.parent!.isRoot)
                .toArray();
        }

        this.onDataInvalidated.emit();
    }

    /**
     * Signal that the children of a node have changed and the node needs to have the children reloaded
     * @param item item whose children should be reloaded
     * @param reloadImmediately true to update children immediate, not on-demand
     */
    public invalidateItem(item: ItemType, reloadImmediately = true) {
        if (item) {
            const node = this.getTreeNode(item);
            if (node) {
                node.invalidateChildren(reloadImmediately);
                this.invalidateData();
            }
        }
    }

    /**
     * The tree walk is synchronous, so a promise-returning accessor contributes no children yet.
     * Whoever started the load calls invalidateItem when it settles, and the walk picks them up then.
     */
    private syncChildAccessor(): TreeChildAccessor<ItemType> | undefined {
        const accessor = this.config.childAccessor;
        if (!accessor) {
            return undefined;
        }
        return item => {
            const children = accessor(item);
            return children instanceof Promise ? undefined : children;
        };
    }
}
