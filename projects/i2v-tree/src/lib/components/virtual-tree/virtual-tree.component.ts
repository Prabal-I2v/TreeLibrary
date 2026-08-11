import {
    Component,
    TemplateRef,
    Input,
    Output,
    EventEmitter,
    ContentChild,
    ViewChild,
    ChangeDetectionStrategy,
    AfterContentInit,
    AfterViewInit,
    OnDestroy,
    ChangeDetectorRef,
    HostListener,
    HostBinding,
    ElementRef,
    inject
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { I2vVirtualTree } from './virtual-tree.model';
import {
    AsyncTreeChildAccessor,
    DefaultIcons,
    DragPos,
    I2vTreeConfig,
    ResolvedTreeConfig,
    TREE_ITEM_MIME,
    VtItemState
} from './virtual-tree.config';
import { SetAttrsDirective } from '../set-attrs.directive';
import { Node, VirtualRenderArea } from '../../models';

/** How long to hover over a collapsed node during a drag before it opens */
const DRAG_EXPAND_DELAY = 600;

@Component({
    selector: 'i2v-virtual-tree',
    standalone: true,
    imports: [NgTemplateOutlet, SetAttrsDirective],
    templateUrl: './virtual-tree.component.html',
    styleUrl: './virtual-tree.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class I2vVirtualTreeComponent implements AfterContentInit, AfterViewInit, OnDestroy {
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

    private disposers: (() => void)[] = [];
    private renderArea = new VirtualRenderArea();
    private destroyed = false;
    private viewInitialized = false;
    private initTimeout?: any;

    private _model: I2vVirtualTree<any>;
    private _config: ResolvedTreeConfig<any>;
    private childAccessor: AsyncTreeChildAccessor<any> = (item: any) => item.children;

    /**
     * Stable indirection handed to the model. It always dispatches to the *current* childAccessor,
     * so [config] and [data] can be bound in either order.
     */
    private readonly childAccessorWrapper = (item: any) => this.getChildren(item);

    private loadingItems = new Set<any>();
    private stateProvider: VtItemState<any> = Object.seal({
        isExpanded: (item: any) => this.model.isExpanded(item),
        isSelected: (item: any) => this.model.isSelected(item),
        isHighlighted: (item: any) => this.model.isHighlighted(item),
        isLoading: (item: any) => this.isItemLoading(item)
    });

    private _filterText: string | undefined = '';
    private filterTextThrottle?: any;

    private ownId = Math.random().toString();
    private ownDragItem?: Node<any>;
    private dragExpand: { item?: Node<any>; timeout?: any } = {};

    /**
     * @ignore
     */
    @HostBinding('tabIndex')
    public tabIndex = 0;

    /**
     * @ignore
     */
    public visibleItems: Node<any>[] = [];

    /**
     * @ignore
     */
    public isDraggingOver = false;

    /**
     * The consumer's row template. When absent the tree renders its built-in row.
     * @ignore
     */
    @ContentChild(TemplateRef)
    public template?: TemplateRef<any>;

    /**
     * @ignore
     */
    @ViewChild('dragOverlay', { static: true })
    public dragOverlay?: ElementRef<HTMLDivElement>;

    /**
     * Fires on change of the selected item, [selection]
     */
    @Output()
    public selectionChange = new EventEmitter<any>();

    /**
     * ContextMenu event on tree rows, allows custom right-click menus
     */
    @Output()
    public itemContextMenu = new EventEmitter<{ event: MouseEvent; item: any }>();

    /**
     * Click event that fires on click of the icon portion of a tree row
     */
    @Output()
    public iconClick = new EventEmitter<{ event: MouseEvent; item: any }>();

    /**
     * Click event that fires on click of the label portion of a tree row
     */
    @Output()
    public labelClick = new EventEmitter<{ event: MouseEvent; item: any }>();

    /**
     * Click event that fires on click of any part of a tree row
     */
    @Output()
    public rowClick = new EventEmitter<{ event: MouseEvent; item: any }>();

    /**
     * An instance of an I2vVirtualTree<T> configured to your dataset
     */
    @Input()
    public set model(value: I2vVirtualTree<any>) {
        this._model = value;
        this.listenToModel(value);
        // A model bound after it was loaded has already emitted onDataInvalidated, so read its
        // current rows now instead of showing the previous model's until something else changes.
        this.handleDataChange();
    }
    public get model() {
        return this._model;
    }

    /**
     * Height each item in the tree
     */
    @Input()
    public set itemHeight(value: number) {
        this.renderArea.itemHeight = value;
    }
    public get itemHeight() {
        return this.renderArea.itemHeight;
    }

    /**
     * The config for the tree
     */
    @Input()
    public set config(value: I2vTreeConfig<any>) {
        this.childAccessor = value.childAccessor || this.childAccessor;
        this._config = { ...this._config, ...value, childAccessor: this.childAccessorWrapper };
        this.model.updateConfig(this._config);
    }
    // Explicit return type: with no annotation a getter inherits its paired setter's parameter
    // type, which would hand every internal caller the all-optional I2vTreeConfig back.
    public get config(): ResolvedTreeConfig<any> {
        return this._config;
    }

    /**
     * Input for loading data into the tree
     */
    @Input()
    public set data(items: any[]) {
        this.model.load(items);
    }

    /**
     * Input for the selected item
     */
    @Input()
    public set selection(value: any) {
        if (!this.model.isSelected(value)) {
            this.model.select(value);
            this.navigateToSelection();
        }
    }

    /**
     * Allows applying an arbitrary filter to the tree. This overrides filterText
     */
    @Input()
    public set filter(value: ((item: any) => boolean) | undefined) {
        this.model.setFilter(value);
    }

    /**
     * Filter the tree with default text filter, case insenstive contains on item names
     */
    @Input()
    public set filterText(value: string | undefined) {
        this.handleFilterTextChange(value);
    }

    /**
     * returns true if filterText or a filter function is applied
     */
    public get isFiltered() {
        return this.model.isFiltered();
    }

    /**
     * @ignore
     */
    public get topBuffer() {
        return this.renderArea.topBuffer;
    }

    /**
     * @ignore
     */
    public get totalHeight() {
        return this.renderArea.totalHeight;
    }

    constructor() {
        this._config = {
            childAccessor: this.childAccessorWrapper,
            getIcon: (item: any) =>
                item.type !== 'd' && item.type !== 'Folder'
                    ? item.icon || this.config.itemIcon
                    : this.model.isExpanded(item)
                    ? DefaultIcons.folderOpen
                    : DefaultIcons.folder,
            getName: (item: any) => item.name,
            getDomNodeAttr: () => undefined,
            itemIcon: DefaultIcons.file,
            filterThrottle: 500,
            filterTextMinLength: 2,
            lazyLoad: true,
            canDrag: () => false,
            canDrop: () => false,
            move: () => Promise.resolve(),
            getDragData: () => '{}'
        };
        this._model = new I2vVirtualTree<any>(this._config);
        this.listenToModel(this._model);
        // Without a height the render area divides by zero and every row is "visible".
        this.renderArea.itemHeight = 1.5 * parseFloat(window.getComputedStyle(document.body).fontSize || '16');
    }

    /**
     * @ignore
     */
    public ngAfterContentInit() {
        // Set imperatively rather than via @HostBinding: `template` only resolves at content init,
        // and a host binding read in the same pass trips ExpressionChangedAfterItHasBeenChecked.
        if (!this.template) {
            this.element.nativeElement.classList.add('i2v-default-rows');
        }
    }

    /**
     * @ignore
     */
    public ngAfterViewInit() {
        this.viewInitialized = true;
        this.handleDataChange();
        this.invalidateSize();
        this.syncScrollPos();
        // Containers that settle late (flex, fonts, a parent that sizes after paint) report the
        // wrong height on the first pass.
        this.initTimeout = setTimeout(() => this.invalidateSize(), 1);
    }

    /**
     * @ignore
     */
    public ngOnDestroy() {
        this.destroyed = true;
        this.dispose();
        clearTimeout(this.initTimeout);
        clearTimeout(this.filterTextThrottle);
        clearTimeout(this.dragExpand.timeout);
    }

    /**
     * @ignore
     */
    @HostListener('keydown', ['$event'])
    public handleKeydown(evt: KeyboardEvent) {
        if (evt.key === 'Enter') {
            this.model.selectHighlightedItem();
        } else if (evt.key.startsWith('Arrow')) {
            const direction = evt.key.replace('Arrow', ''),
                nextHighlightedIndex = this.model.navigate(direction);

            if (nextHighlightedIndex !== undefined) {
                this.scrollToIndex(nextHighlightedIndex);
            }
            evt.preventDefault();
        }
    }

    /**
     * @ignore
     */
    @HostListener('scroll')
    public handleScrollChange() {
        if (this.element.nativeElement) {
            this.renderArea.scrollPos = this.element.nativeElement.scrollTop;
            this.updateVisibleItems();
        }
    }

    /**
     * @ignore
     */
    @HostListener('window:resize')
    public handleWindowResize() {
        this.invalidateSize();
    }

    /**
     * Fix issues occurring from tree container's height has changed
     */
    public invalidateSize() {
        if (this.element.nativeElement) {
            const bounds = this.element.nativeElement.getBoundingClientRect();
            this.renderArea.viewerHeight = bounds.height;
            if (this.renderArea.itemCount !== this.visibleItems.length) {
                this.updateVisibleItems();
                // This component is OnPush and invalidateSize is called imperatively, so nothing
                // else marks it dirty. Without this the newly computed rows are never rendered.
                this.refresh();
            }
        }
    }

    /**
     * Scroll the container until the selected item is in view. If the selected item is already in view, do nothing.
     */
    public scrollToSelected() {
        const selectedIndex = this.model.getSelectedIndex();
        if (typeof selectedIndex === 'number') {
            this.scrollToIndex(selectedIndex);
        }
    }

    /**
     * Scroll to a certain position
     * @param offset In pixels, the scroll position to jump to
     */
    public scrollTo(offset: number) {
        const { nativeElement } = this.element;
        if (nativeElement) {
            nativeElement.scrollTop = offset;
        }
    }

    /**
     * Scroll the container until the item is in view. If the item is already in view, do nothing.
     */
    public scrollToItem(item: any) {
        const selectedIndex = this.model.getItemIndex(item);
        if (typeof selectedIndex === 'number' && selectedIndex > -1) {
            this.scrollToIndex(selectedIndex);
        }
    }

    /**
     * Scroll the container until the item at the index is in view. If the item at the index is already in view, do nothing.
     */
    public scrollToIndex(index: number) {
        const { nativeElement } = this.element;
        if (nativeElement) {
            const { viewerHeight, itemHeight } = this.renderArea,
                itemTop = index * itemHeight,
                itemBottom = itemTop + itemHeight;

            if (itemTop < nativeElement.scrollTop) {
                nativeElement.scrollTop = itemTop;
            } else if (itemBottom > nativeElement.scrollTop + viewerHeight) {
                nativeElement.scrollTop = itemBottom - viewerHeight;
            }
        }
    }

    /**
     * Get the current scroll offset, pixels
     */
    public getScrollPos() {
        return this.renderArea.scrollPos;
    }

    /**
     * Adjust the DOM scroll position to match the VirtualRenderArea scroll postion, and vice versa.
     * This can fix some issues that occur after DOM height changes
     */
    public syncScrollPos() {
        const { nativeElement } = this.element;
        if (nativeElement) {
            if (nativeElement.scrollTop !== this.renderArea.scrollPos) {
                nativeElement.scrollTop = this.renderArea.scrollPos;
                this.renderArea.scrollPos = nativeElement.scrollTop;
            }
        }
    }

    /**
     * Scrolls and expands nodes so that the selected item is visible in the tree
     */
    public navigateToSelection() {
        this.model.expandToSelectedItem();
        return this.scrollToSelected();
    }

    /**
     * Scrolls and expands nodes so that the passed item is visible in the tree
     */
    public navigateToItem(item: any) {
        this.model.expandToItem(item);
        // expandToItem only mutates the expanded set. Without this the item is still absent from
        // the flattened rows and the scroll below silently no-ops.
        this.model.invalidateData();
        return this.scrollToItem(item);
    }

    /**
     * True while the passed item is waiting on its children to load
     */
    public isItemLoading(item: any) {
        return this.loadingItems.has(item);
    }

    /** @ignore */
    public handleContextMenu(evt: MouseEvent, item: any) {
        this.itemContextMenu.emit({ event: evt, item });
    }

    /** @ignore */
    public handleRowClick(evt: MouseEvent, item: any) {
        this.model.selectAndHighlight(item);
        this.rowClick.emit({ event: evt, item });
    }

    /** @ignore */
    public getIcon(node: Node<any>) {
        return `i2v-icon ${this.config.getIcon(node.item, node, this.stateProvider)}`;
    }

    /** @ignore */
    public getDomNodeAttr(node: Node<any>) {
        return this.config.getDomNodeAttr(node.item, node, this.stateProvider);
    }

    /** @ignore */
    public getName(item: any) {
        return this.config.getName(item, this.stateProvider) || '';
    }

    /** @ignore */
    public getExpanderIcon(item: any) {
        const iconType = this.model.isExpanded(item) ? 'down' : 'right';
        return `i2v-expander i2v-expander-${iconType}`;
    }

    /**
     * True if the passed item may be dragged. Public so a consumer template can opt into the
     * built-in drag and drop.
     */
    public canDrag(item: any) {
        return this.config.canDrag(item);
    }

    /**
     * Begin a drag of the passed node. Public so a consumer template can opt into the built-in
     * drag and drop by wiring its own row's (dragstart).
     */
    public handleDragstart(evt: DragEvent, node: Node<any>) {
        this.ownDragItem = node;
        if (this.canDrag(node.item)) {
            if (evt.dataTransfer) {
                evt.dataTransfer.dropEffect = 'move';
                evt.dataTransfer.setData(TREE_ITEM_MIME, this.getDragData(node.item));
                evt.dataTransfer.setData(`text/plain.${this.ownId}`, '{}');
            }
        }
    }

    /** @ignore */
    @HostListener('dragover', ['$event'])
    public handleDragover(evt: DragEvent) {
        // Ignore drags that are not ours -- a file dragged in from the desktop should not light up
        // the overlay, and under OnPush every one of these costs a change detection pass.
        if (!evt.dataTransfer || !evt.dataTransfer.types.includes(TREE_ITEM_MIME)) {
            return;
        }
        this.isDraggingOver = true;
        const dropInfo = this.getDropInfo(evt, false);
        if (dropInfo.canDrop()) {
            this.adjustDragOverlay(dropInfo);
            evt.preventDefault();
        }
        if (dropInfo.draggedItem !== dropInfo.parent) {
            this.tryDragExpand(dropInfo);
        }
    }

    /** @ignore */
    @HostListener('dragleave', ['$event'])
    public handleDragleave(evt: DragEvent) {
        // dragleave bubbles from every row, so moving between rows would otherwise flicker the
        // overlay. Only a pointer that has actually left the tree counts.
        const movedTo = evt.relatedTarget as HTMLElement | null;
        if (movedTo && this.element.nativeElement.contains(movedTo)) {
            return;
        }
        this.isDraggingOver = false;
    }

    /** @ignore */
    @HostListener('dragend')
    public handleDragend() {
        this.ownDragItem = undefined;
        this.isDraggingOver = false;
    }

    /** @ignore */
    @HostListener('drop', ['$event'])
    public handleDrop(evt: DragEvent) {
        this.isDraggingOver = false;
        if (evt.dataTransfer && evt.dataTransfer.types.includes(TREE_ITEM_MIME)) {
            const dropInfo = this.getDropInfo(evt, true);
            if (dropInfo.canDrop()) {
                this.move(dropInfo.draggedItem, dropInfo.parent!, dropInfo.index);
            }
        }
    }

    private tryDragExpand(dropInfo: { parent?: Node<any>; area: DragPos }) {
        if (dropInfo.area !== 'on' || this.dragExpand.item !== dropInfo.parent) {
            clearTimeout(this.dragExpand.timeout);
        }
        if (this.dragExpand.item !== dropInfo.parent && dropInfo.parent && dropInfo.area === 'on') {
            this.dragExpand.item = dropInfo.parent;
            this.dragExpand.timeout = setTimeout(() => {
                this.model.setExpanded(dropInfo.parent!.item, true);
                this.model.invalidateData();
            }, DRAG_EXPAND_DELAY);
        }
    }

    private async move(item: any, parent: Node<any>, index: number | undefined) {
        const itemNode = item instanceof Node ? item : undefined,
            itemData = itemNode ? itemNode.item : item,
            parentItem = parent ? parent.item : undefined,
            fromParent = itemNode && itemNode.parent ? itemNode.parent.item : undefined;

        await this.config.move({
            itemNode,
            parentNode: parent,
            item: itemData,
            parent: parentItem,
            index
        });

        if (this.destroyed) {
            return;
        }
        this.model.invalidateItem(fromParent);
        this.model.invalidateItem(parent.item);
    }

    private getDropInfo(evt: DragEvent, readExternalData: boolean) {
        // clientY and getBoundingClientRect().top are both viewport relative. pageY is not --
        // mixing them offsets every drop by the page scroll.
        const box = this.element.nativeElement.getBoundingClientRect(),
            yPos = evt.clientY - box.top,
            target = this.getItemPosition(yPos),
            draggedItem = evt.dataTransfer!.types.includes(`text/plain.${this.ownId}`)
                ? this.ownDragItem
                : readExternalData
                ? this.readExternalDragData(evt)
                : undefined;

        return {
            draggedItem,
            index: target.itemIndex,
            parent: target.item,
            flatIndex: target.flatIndex,
            area: target.area,
            canDrop: () => {
                const item = draggedItem instanceof Node ? draggedItem.item : draggedItem,
                    itemNode = this.model.getTreeNode(item),
                    parentNode = target.item!,
                    parent = target.item ? target.item.item : undefined,
                    index = target.itemIndex;

                return this.canDrop(itemNode, parentNode, item, parent, index);
            }
        };
    }

    private readExternalDragData(evt: DragEvent) {
        try {
            return JSON.parse(evt.dataTransfer!.getData(TREE_ITEM_MIME));
        } catch {
            // A foreign payload under our key must not throw out of a drop handler.
            return undefined;
        }
    }

    private getItemPosition(yPos: number) {
        const scroll = this.getScrollPos(),
            flatIndex = Math.floor((yPos + scroll) / this.itemHeight),
            itemPos = flatIndex * this.itemHeight - scroll,
            buffer = this.itemHeight / 4,
            area: DragPos = itemPos + buffer > yPos ? 'before' : itemPos + this.itemHeight - buffer < yPos ? 'after' : 'on',
            itemAtIndex = this.model.items[flatIndex],
            itemIndex =
                !itemAtIndex || !itemAtIndex.parent
                    ? undefined
                    : area === 'before'
                    ? itemAtIndex.index
                    : area === 'after'
                    ? itemAtIndex.index + 1
                    : undefined,
            item = !itemAtIndex ? undefined : area === 'on' ? itemAtIndex : itemAtIndex.parent;

        return { flatIndex, itemIndex, item, area };
    }

    private getDragData(item: any) {
        return this.config.getDragData(item);
    }

    private canDrop(itemNode: Node<any> | undefined, parentNode: Node<any>, item: any, parent: any, index: number | undefined) {
        return this.config.canDrop({ itemNode, parentNode, item, parent, index });
    }

    private adjustDragOverlay(dropInfo: { flatIndex: number; index: number | undefined; area: DragPos } | undefined) {
        if (this.dragOverlay && this.dragOverlay.nativeElement) {
            const el = this.dragOverlay.nativeElement;
            if (dropInfo) {
                const buffer = this.itemHeight / 4,
                    baseY = dropInfo.flatIndex * this.itemHeight,
                    y = dropInfo.area === 'before' ? baseY - buffer : dropInfo.area === 'after' ? baseY + this.itemHeight - buffer : baseY,
                    h = dropInfo.area === 'on' ? this.itemHeight : buffer * 2;

                el.style.top = y + 'px';
                el.style.height = h + 'px';
                if (dropInfo.area === 'on') {
                    el.classList.remove('i2v-dragoverlay-between');
                } else {
                    el.classList.add('i2v-dragoverlay-between');
                }
            } else {
                el.style.height = '0px';
            }
        }
    }

    private getChildren(item: any) {
        const result = this.childAccessor(item);
        if (result instanceof Promise) {
            this.loadChildren(item, result);
            return undefined;
        }
        return result;
    }

    private async loadChildren(item: any, childrenPromise: Promise<any>) {
        this.loadingItems.add(item);
        try {
            await childrenPromise;
        } finally {
            // Clear before invalidating: invalidateItem is what repaints, so doing it the other way
            // round leaves the row painted as still loading. The finally covers the failure path too.
            this.loadingItems.delete(item);
            if (!this.destroyed) {
                this.model.invalidateItem(item);
            }
        }
    }

    private handleFilterTextChange(value: string | undefined) {
        if (value && value.length >= this.config.filterTextMinLength) {
            this.setTextFilter(value);
        } else {
            this.clearTextFilter();
        }
        this._filterText = value;
    }

    private setTextFilter(value: string) {
        const text = value.toLowerCase();

        clearTimeout(this.filterTextThrottle);
        this.filterTextThrottle = setTimeout(() => {
            if (this.destroyed) {
                return;
            }
            this.model.setFilter(item =>
                this.getName(item)
                    .toLowerCase()
                    .indexOf(text) >= 0
            );
        }, this.config.filterThrottle);
    }

    private clearTextFilter() {
        if (this._filterText && this._filterText.length >= this.config.filterTextMinLength) {
            clearTimeout(this.filterTextThrottle);
            this.model.setFilter(undefined);
            this.model.expandToSelectedItem();
            this.scrollToSelected();
        }
    }

    private listenToModel(model: I2vVirtualTree<any>) {
        this.dispose();
        const subscriptions = [
            model.onDataInvalidated.subscribe(() => this.handleDataChange()),
            // Selection and highlight do not rebuild the item list, so when a caller drives the
            // model directly nothing else would mark this OnPush view dirty.
            model.onSelectionChanged.subscribe((item: any) => {
                this.cdr.markForCheck();
                this.selectionChange.emit(item);
            }),
            model.onHighlightChanged.subscribe(() => this.cdr.markForCheck())
        ];
        this.disposers.push(() => subscriptions.forEach(s => s.unsubscribe()));
    }

    private dispose() {
        for (const disposer of this.disposers) {
            disposer();
        }
        this.disposers.length = 0;
    }

    private handleDataChange() {
        if (this.destroyed) {
            return;
        }
        this.renderArea.itemCount = this.model.items.length;
        this.updateVisibleItems();
        this.refresh();
    }

    private refresh() {
        if (this.destroyed) {
            return;
        }
        if (this.viewInitialized) {
            this.cdr.detectChanges();
        } else {
            // Before the view exists the content query has not resolved, so forcing a pass here
            // would render one throwaway frame of built-in rows and then swap to the real template.
            this.cdr.markForCheck();
        }
    }

    private updateVisibleItems() {
        this.visibleItems = this.model.items.slice(
            this.renderArea.visibleStart,
            this.renderArea.visibleStart + this.renderArea.visibleCount
        );
    }
}
