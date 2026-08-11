import { Node } from '../../models';

/**
 * The dataTransfer key carrying a dragged tree item. Written on dragstart and read back on
 * drop, including across windows, so it must be identical on both sides.
 */
export const TREE_ITEM_MIME = 'application/json.i2v-tree-item';

/**
 * State accessor providing behavior state given a data item
 */
export interface VtItemState<T> {
    /**
     * True if the passed item is expanded
     */
    isExpanded: (item: T) => boolean;
    /**
     * True if the passed item is selected
     */
    isSelected: (item: T) => boolean;
    /**
     * True if the passed item is highlighted
     */
    isHighlighted: (item: T) => boolean;
    /**
     * True if the passed item is loading its children
     */
    isLoading: (item: T) => boolean;
}

/**
 * Where a dragged item would land relative to the row under the cursor
 */
export type DragPos = 'before' | 'on' | 'after';

/**
 * Parameters of the drag handlers (canDrop, move)
 */
export interface DragArgs<T> {
    /**
     * The node being dragged
     */
    itemNode?: Node<T>;
    /**
     * The node being dragged over or dropped on
     */
    parentNode: Node<T>;
    /**
     * The data item being dragged
     */
    item: T | any;
    /**
     * The data item being dragged over or dropped on
     */
    parent?: T;
    /**
     * The index within the parent node where the item should be dropped
     */
    index?: number;
}

/**
 * Children accessor the tree walk consumes. The walk is synchronous, so this never sees a promise.
 */
export type TreeChildAccessor<T> = (item: T) => T[] | undefined;

/**
 * Children accessor a consumer may supply. Returning a promise opts the item into lazy loading:
 * the tree reports it via {@link VtItemState.isLoading} and re-reads the children once it settles.
 *
 * Because settling re-reads the children, the accessor must answer with the loaded array from then
 * on -- typically by storing them on the item. One that keeps returning a promise reloads forever.
 */
export type AsyncTreeChildAccessor<T> = (item: T) => T[] | Promise<T[] | undefined> | undefined;

export enum DefaultIcons {
    file = 'i2v-file-text',
    folder = 'i2v-folder',
    folderOpen = 'i2v-folder-open'
}

/**
 * Configuration options for the I2vVirtualTree
 */
export interface I2vTreeConfig<ItemType> {
    /**
     * Returns true if the passed item can be expanded. Lets the tree draw an expander without
     * loading children first. Ignored while a filter is applied.
     */
    canExpand?: (item: ItemType) => boolean;
    /**
     * Returns the children of the passed item, or a promise of them to load lazily
     */
    childAccessor?: AsyncTreeChildAccessor<ItemType>;
    /**
     * True to load children on demand rather than walking the whole tree up front
     */
    lazyLoad?: boolean;
    /**
     * Number of milliseconds to wait before applying the after change of input [filterText] or [filter] handler
     */
    filterThrottle?: number;
    /**
     * Minimum number of characters permitted for applying [filterText] filter
     */
    filterTextMinLength?: number;
    /**
     * Icon to use for non-folder nodes. This is overidden by the getIcon option
     */
    itemIcon?: string;
    /**
     * Handler for customizing the item icon. The returned string will be applied as a class on the template's i tag
     * For example, if your project uses font awesome you might return 'fa fa-file-o'
     * @param item The data item which the icon should represent
     * @param node The node for the data item
     * @param state State accessor for the item, used to customize icon based on expanded, loading, selected, or highlighted state
     */
    getIcon?(item: ItemType, node: Node<ItemType>, state: VtItemState<ItemType>): string;
    /**
     * Handler for customizing the label for tree nodes. The returned string will be used as the node text for the passed item
     * @param item The data item which the text should represent
     * @param state State accessor for the item, exposing the item's expanded, loading, selected, or highlighted state
     */
    getName?(item: ItemType, state: VtItemState<ItemType>): string;
    /**
     * @ignore
     */
    getDomNodeAttr?(item: ItemType, node: Node<ItemType>, state: VtItemState<ItemType>): { [attr: string]: any } | undefined;
    /**
     * Determines whether the passed item should be draggable. Return true if the item is draggable
     * @param item The data item for which draggability should be returned
     */
    canDrag?(item: ItemType): boolean;
    /**
     * Determines whether the a drop should be allowed. Return true to allow drop
     * @param args Parameters of the drag event
     */
    canDrop?(args: DragArgs<ItemType>): boolean;
    /**
     * Handler for executing a move event. Perform update to your data based on the passed drag event data.
     * Return a promise that is resolved when your data is updated
     * @param args Parameters of the drag event
     */
    move?(args: DragArgs<ItemType>): Promise<void>;
    /**
     * For cross-window drag handling, provide data accessible to the drop target
     * @param item
     */
    getDragData?(item: ItemType): string;
}

/**
 * A config with every default filled in. `canExpand` stays optional because the tree branches on
 * its *presence* — defaulting it would silently change what counts as expandable.
 * @ignore
 */
export type ResolvedTreeConfig<ItemType> = Required<Omit<I2vTreeConfig<ItemType>, 'canExpand'>> &
    Pick<I2vTreeConfig<ItemType>, 'canExpand'>;
