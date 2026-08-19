import { TreeQuery } from './tree-query';

/**
 * Reads and writes the children array of an item. The editor needs both directions: the accessor to
 * find the array, and a setter for the case where a node has no array yet.
 */
export interface I2vEditorConfig<T> {
    childAccessor: (item: T) => T[] | undefined;
    /**
     * Attach a children array to an item that has none. Without it, inserting into a childless item
     * is a no-op, because the editor will not guess a property name on the consumer's data.
     */
    setChildren?: (item: T, children: T[]) => void;
}

/**
 * Structural edits to the data behind a tree: insert, remove, move.
 *
 * The tree is a view over the consumer's arrays and does not own the data shape, so the editor
 * mutates those arrays through the configured accessor and then reports which parents changed. The
 * caller invalidates them -- keeping this class free of any dependency on the tree component.
 *
 * Replaces the legacy `insertNodes` / `deleteNode` / `removeAllChildNodes` / `updateNode` service
 * methods, which reached into zTree's internal node objects instead.
 */
export class I2vTreeEditor<T> {
    constructor(private config: I2vEditorConfig<T>, private roots: () => T[]) {}

    /**
     * Insert items under a parent, or at the root when `parent` is undefined.
     * @returns true if the insert happened
     */
    public insert(parent: T | undefined, items: T[], index?: number): boolean {
        const target = this.childListFor(parent, true);
        if (!target) {
            return false;
        }

        const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
        target.splice(at, 0, ...items);
        return true;
    }

    /**
     * Remove an item from its parent.
     * @returns the parent the item was removed from, or undefined if it was not found. A root-level
     *          removal reports `undefined` as well, so callers should check the boolean-ish result
     *          against {@link indexOf} when they need to tell the two apart.
     */
    public remove(item: T, query: TreeQuery<T>): { removed: boolean; parent?: T } {
        const node = query.findNode(item);
        if (!node) {
            return { removed: false };
        }

        const parent = node.parent && !node.parent.isRoot ? node.parent.item : undefined,
            list = this.childListFor(parent, false);

        if (!list) {
            return { removed: false };
        }

        const at = list.indexOf(item);
        if (at < 0) {
            return { removed: false };
        }

        list.splice(at, 1);
        return { removed: true, parent };
    }

    /**
     * Drop every child of a parent.
     */
    public removeChildren(parent: T | undefined): boolean {
        const list = this.childListFor(parent, false);
        if (!list) {
            return false;
        }
        list.length = 0;
        return true;
    }

    /**
     * Move an item to a new parent and position.
     *
     * Removal happens before insertion, and the target index is corrected when both sides are the
     * same array -- without that, dragging an item downward within its own parent lands one slot
     * short, because removing it shifts everything after it.
     *
     * @returns the parents that need invalidating, or undefined if the move was rejected
     */
    public move(item: T, newParent: T | undefined, index: number | undefined, query: TreeQuery<T>): { from?: T; to?: T } | undefined {
        // Moving an item inside its own subtree would detach that subtree from the tree entirely.
        if (newParent !== undefined && this.isAncestorOf(item, newParent, query)) {
            return undefined;
        }

        const node = query.findNode(item);
        if (!node) {
            return undefined;
        }

        const from = node.parent && !node.parent.isRoot ? node.parent.item : undefined,
            source = this.childListFor(from, false),
            target = this.childListFor(newParent, true);

        if (!source || !target) {
            return undefined;
        }

        const at = source.indexOf(item);
        if (at < 0) {
            return undefined;
        }

        let insertAt = index === undefined ? target.length : index;
        if (source === target && at < insertAt) {
            insertAt--;
        }

        source.splice(at, 1);
        target.splice(Math.max(0, Math.min(insertAt, target.length)), 0, item);

        return { from, to: newParent };
    }

    /**
     * True if `ancestor` is at or above `item`. Used to reject moves that would orphan a subtree.
     */
    public isAncestorOf(ancestor: T, item: T, query: TreeQuery<T>): boolean {
        if (ancestor === item) {
            return true;
        }

        const node = query.findNode(item);
        if (!node) {
            return false;
        }

        for (const candidate of node.ancestors()) {
            if (candidate.isRoot) {
                break;
            }
            if (candidate.item === ancestor) {
                return true;
            }
        }

        return false;
    }

    /**
     * The children array for a parent, creating one when asked and the config allows it.
     */
    private childListFor(parent: T | undefined, create: boolean): T[] | undefined {
        if (parent === undefined) {
            return this.roots();
        }

        const existing = this.config.childAccessor(parent);
        if (existing) {
            return existing;
        }

        if (create && this.config.setChildren) {
            const created: T[] = [];
            this.config.setChildren(parent, created);
            return created;
        }

        return undefined;
    }
}
