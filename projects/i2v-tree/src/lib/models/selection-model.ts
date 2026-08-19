import { EventEmitter } from '@angular/core';

/**
 * 'none' disables selection, 'single' keeps at most one item, 'multiple' enables ctrl and shift
 * gestures. zTree's equivalent is `view.selectedMulti`.
 */
export type I2vSelectionMode = 'none' | 'single' | 'multiple';

/**
 * Modifier keys accompanying a selection gesture. Taken from the originating MouseEvent or
 * KeyboardEvent so the model never touches the DOM itself.
 */
export interface I2vSelectionModifiers {
    ctrl?: boolean;
    shift?: boolean;
}

/**
 * Selection state for a tree, held outside the data.
 *
 * Kept separate from {@link I2vCheckModel}: selection is "what the user is looking at" and follows
 * the keyboard, while checks are "what the user has picked" and persist. zTree conflated them, which
 * is why its ctrl-click both multi-selected and suppressed every event.
 */
export class I2vSelectionModel<T> {
    private selected = new Set<T>();
    /**
     * The item a shift-range extends from. Set by every non-shift selection, so ranges behave the
     * way they do in a file explorer.
     */
    private anchor?: T;
    private mode: I2vSelectionMode = 'single';

    public readonly onSelectionChanged = new EventEmitter<T[]>();

    constructor(mode: I2vSelectionMode = 'single') {
        this.mode = mode;
    }

    public setMode(mode: I2vSelectionMode) {
        this.mode = mode;
        if (mode === 'none') {
            this.clear();
        } else if (mode === 'single' && this.selected.size > 1) {
            // Collapse to the anchor so switching modes cannot leave an illegal multi-selection.
            const keep = this.anchor ?? [...this.selected][0];
            this.selected = new Set([keep]);
            this.onSelectionChanged.emit(this.getSelected());
        }
    }

    public getMode() {
        return this.mode;
    }

    public isSelected(item: T) {
        return this.selected.has(item);
    }

    public getSelected(): T[] {
        return [...this.selected];
    }

    /**
     * The most recent single selection. Retained because a tree usually needs "the current item"
     * even when several are selected -- this is what drives detail panes.
     */
    public getAnchor() {
        return this.anchor;
    }

    public get count() {
        return this.selected.size;
    }

    /**
     * Apply a selection gesture.
     * @param item the item clicked or navigated to
     * @param modifiers ctrl toggles, shift extends from the anchor
     * @param range ordered items between anchor and item, supplied by the tree because only it
     *              knows the current visual order. Ignored unless shift is held.
     */
    public select(item: T, modifiers: I2vSelectionModifiers = {}, range?: T[]) {
        if (this.mode === 'none') {
            return;
        }

        if (this.mode === 'single' || (!modifiers.ctrl && !modifiers.shift)) {
            this.replaceWith([item], item);
            return;
        }

        if (modifiers.shift && range && range.length) {
            // Shift extends from the anchor without moving it, so successive shift-clicks grow and
            // shrink one range rather than chaining new ones.
            this.replaceWith(range, this.anchor ?? item);
            return;
        }

        if (modifiers.ctrl) {
            if (this.selected.has(item)) {
                this.selected.delete(item);
            } else {
                this.selected.add(item);
            }
            this.anchor = item;
            this.onSelectionChanged.emit(this.getSelected());
        }
    }

    /**
     * Select exactly these items, bypassing gesture handling.
     */
    public setSelected(items: T[]) {
        const next = this.mode === 'single' ? items.slice(0, 1) : items;
        this.replaceWith(next, next[next.length - 1]);
    }

    public add(item: T) {
        if (this.mode === 'none' || this.selected.has(item)) {
            return;
        }
        if (this.mode === 'single') {
            this.replaceWith([item], item);
            return;
        }
        this.selected.add(item);
        this.anchor = item;
        this.onSelectionChanged.emit(this.getSelected());
    }

    public remove(item: T) {
        if (this.selected.delete(item)) {
            if (this.anchor === item) {
                this.anchor = undefined;
            }
            this.onSelectionChanged.emit(this.getSelected());
        }
    }

    public clear() {
        if (this.selected.size === 0) {
            return;
        }
        this.selected.clear();
        this.anchor = undefined;
        this.onSelectionChanged.emit([]);
    }

    private replaceWith(items: T[], anchor: T | undefined) {
        const changed = items.length !== this.selected.size || items.some(i => !this.selected.has(i));
        this.selected = new Set(items);
        this.anchor = anchor;
        if (changed) {
            this.onSelectionChanged.emit(this.getSelected());
        }
    }
}
