import { EventEmitter } from '@angular/core';
import { Node } from './node';
import { TreeQuery } from './tree-query';

/**
 * Tri-state of a checkbox. `indeterminate` means the subtree below the item holds a mix.
 */
export type I2vCheckState = 'checked' | 'unchecked' | 'indeterminate';

/**
 * A check selection expressed as roots minus exclusions, eg. "servers X and Y, except camera Z".
 *
 * This is the primary way to read and restore check state, because it is the only representation
 * that survives lazy loading: it describes items that have never been loaded. Contrast
 * {@link I2vCheckModel.getCheckedItems}, which can only enumerate what is currently in memory.
 */
export interface I2vCheckSelection<T> {
    /**
     * Items whose whole subtree is checked, minus anything in `excluded`
     */
    roots: T[];
    /**
     * Items explicitly unchecked beneath one of the roots
     */
    excluded: T[];
}

/**
 * What triggered a check change, so consumers can tell a user click from a programmatic write
 */
export type I2vCheckSource = 'user' | 'api' | 'cascade';

export interface I2vCheckChange<T> {
    item: T;
    checked: boolean;
    source: I2vCheckSource;
}

export interface I2vCheckConfig<T> {
    /**
     * Stable identity for an item. Without it, decisions are keyed by object reference and are lost
     * when the tree reloads. With it, check state survives `load()` and can be restored for items
     * that have not been loaded yet.
     */
    keyOf?: (item: T) => unknown;
    /**
     * Returns false for items that cannot carry a checkbox (zTree's `nocheck`). Such items are
     * excluded from {@link I2vCheckModel.getCheckedItems}, but they do not block cascade to their
     * children -- an uncheckable group still passes its state down.
     */
    canCheck?: (item: T) => boolean;
    /**
     * 'subtree' (default) checks descendants along with the item. 'none' checks items individually.
     */
    cascade?: 'subtree' | 'none';
    /**
     * When every child of a parent is checked, replace those child decisions with one decision on
     * the parent. This is zTree's upward `p` cascade. Only safe once a parent's children are fully
     * loaded, so it defaults to false under lazy loading.
     */
    promoteParents?: boolean;
    /**
     * State for items with no decision anywhere above them. Defaults to false.
     */
    defaultChecked?: boolean;
}

interface ResolvedCheckConfig<T> {
    keyOf: (item: T) => unknown;
    canCheck: (item: T) => boolean;
    cascade: 'subtree' | 'none';
    promoteParents: boolean;
    defaultChecked: boolean;
}

/**
 * Tri-state check state for a tree, held outside the data.
 *
 * State is stored as a sparse set of *decisions* rather than a flag per item, which is what lets it
 * describe subtrees that have not been loaded. Checking a lazily-loaded parent records one decision
 * and triggers no fetch; children that arrive later already read as checked.
 *
 * The model is deliberately independent of the tree so that it can outlive one: a dropdown can hold
 * check state, and therefore render chips, before its panel has ever been opened. Call
 * {@link attach} to give it a tree; unattached it still works, with flat semantics.
 *
 * ### Invariant
 * A decision is stored only where it *differs* from what the item would inherit. Consequences:
 * - `isChecked` reads the nearest ancestor-or-self decision -- O(depth).
 * - An item is indeterminate exactly when a decision exists strictly below it, which `subtreeCount`
 *   tracks, making {@link getState} O(depth) rather than O(subtree).
 * - `checkAll`/`uncheckAll` are O(1) regardless of tree size.
 */
export class I2vCheckModel<T> {
    private config: ResolvedCheckConfig<T>;
    private queryProvider?: () => TreeQuery<T> | undefined;

    /** Explicit decisions, keyed by `config.keyOf`. Normalized: never redundant with inheritance. */
    private decisions = new Map<unknown, boolean>();
    /** Items behind the keys in `decisions`, so `getSelection` can return them without a tree. */
    private decisionItems = new Map<unknown, T>();
    /** Count of decisions living strictly below a key. Non-zero means indeterminate. */
    private subtreeCount = new Map<unknown, number>();
    /** The state inherited by anything with no decision above it. */
    private rootDecision: boolean;

    /**
     * Fallback lookup from key to node, for resolving items that are equal by `keyOf` but not by
     * reference -- the case after a reload. Built on demand and dropped whenever the tree changes.
     */
    private keyIndex?: Map<unknown, Node<T>>;

    /**
     * Keys whose ancestor counters could not be applied because the item was not loaded when the
     * decision was made -- an item can only be placed in the hierarchy once its node exists.
     * {@link reconcilePending} drains this as the nodes arrive.
     */
    private pendingCounts = new Map<unknown, T>();

    public readonly onCheckChanged = new EventEmitter<I2vCheckChange<T>>();
    public readonly onCheckStateChanged = new EventEmitter<void>();

    constructor(config: I2vCheckConfig<T> = {}) {
        this.config = this.resolveConfig(config);
        this.rootDecision = this.config.defaultChecked;
    }

    /**
     * Give the model access to the tree it describes. Without this the model still records
     * decisions, but cannot cascade to or enumerate descendants.
     * @param queryProvider returns the current query; read lazily so it survives `load()`
     */
    public attach(queryProvider: () => TreeQuery<T> | undefined) {
        this.queryProvider = queryProvider;
        this.invalidateKeyIndex();
    }

    public updateConfig(config: I2vCheckConfig<T>) {
        this.config = this.resolveConfig(config);
    }

    /**
     * True if the item reads as checked, whether by its own decision or one inherited from an
     * ancestor. An indeterminate item reports false.
     */
    public isChecked(item: T): boolean {
        return this.getInherited(item);
    }

    /**
     * Full tri-state for the item.
     */
    public getState(item: T): I2vCheckState {
        this.reconcilePending();
        const key = this.config.keyOf(item);
        if ((this.subtreeCount.get(key) ?? 0) > 0) {
            return 'indeterminate';
        }
        return this.getInherited(item) ? 'checked' : 'unchecked';
    }

    /**
     * Set the check state of an item, cascading to its subtree unless `cascade` is 'none'.
     * Records a decision without loading anything, so this is safe for lazily-loaded parents.
     */
    public setChecked(item: T, checked: boolean, source: I2vCheckSource = 'api') {
        if (this.applyDecision(item, checked)) {
            this.onCheckChanged.emit({ item, checked, source });
            this.onCheckStateChanged.emit();
        }
    }

    public toggle(item: T, source: I2vCheckSource = 'user') {
        this.setChecked(item, this.getState(item) !== 'checked', source);
    }

    /**
     * Apply the same state to many items, emitting once rather than per item.
     */
    public setCheckedMany(items: Iterable<T>, checked: boolean, source: I2vCheckSource = 'api') {
        let changed = false;
        for (const item of items) {
            if (this.applyDecision(item, checked)) {
                this.onCheckChanged.emit({ item, checked, source });
                changed = true;
            }
        }
        if (changed) {
            this.onCheckStateChanged.emit();
        }
    }

    /**
     * Check everything, including subtrees that have never been loaded. O(1).
     */
    public checkAll(source: I2vCheckSource = 'api') {
        this.setRoot(true, source);
    }

    /**
     * Uncheck everything, including subtrees that have never been loaded. O(1).
     */
    public uncheckAll(source: I2vCheckSource = 'api') {
        this.setRoot(false, source);
    }

    /**
     * Tri-state across the whole tree, for a "select all" control.
     */
    public getRootState(): I2vCheckState {
        this.reconcilePending();
        if (this.decisions.size > 0) {
            return 'indeterminate';
        }
        return this.rootDecision ? 'checked' : 'unchecked';
    }

    /**
     * The current selection as roots minus exclusions. Survives lazy loading, unlike
     * {@link getCheckedItems}, and is what {@link setSelection} consumes.
     */
    public getSelection(): I2vCheckSelection<T> {
        const roots: T[] = [],
            excluded: T[] = [];

        for (const [key, checked] of this.decisions) {
            const item = this.decisionItems.get(key);
            if (item !== undefined) {
                (checked ? roots : excluded).push(item);
            }
        }

        return { roots, excluded };
    }

    /**
     * Restore a selection previously produced by {@link getSelection}. Items need not be loaded.
     */
    public setSelection(selection: I2vCheckSelection<T>) {
        this.clear(false);
        // The incoming items typically come from another tree instance, so resolve them by key.
        this.invalidateKeyIndex();
        for (const item of selection.roots) {
            this.applyDecision(item, true);
        }
        for (const item of selection.excluded) {
            this.applyDecision(item, false);
        }
        this.onCheckStateChanged.emit();
    }

    /**
     * Items carrying an explicit checked decision -- the shallowest checked items, not their
     * descendants. This is the natural source for chips: one chip per checked server rather than
     * one per camera beneath it.
     */
    public getCheckedRoots(): T[] {
        return this.getSelection().roots;
    }

    /**
     * Every *loaded* item that reads as checked.
     *
     * Only loaded items can be enumerated, so under lazy loading this is a partial answer: a checked
     * parent whose children have not been fetched contributes only itself. Use {@link getSelection}
     * when the answer has to cover the whole tree.
     */
    public getCheckedItems(): T[] {
        const result: T[] = [];
        this.visitLoaded(node => {
            if (this.config.canCheck(node.item) && this.getInherited(node.item)) {
                result.push(node.item);
            }
        });
        return result;
    }

    /**
     * Every *loaded* checked item that has no loaded children. See {@link getCheckedItems} for the
     * lazy-loading caveat.
     */
    public getCheckedLeaves(): T[] {
        const result: T[] = [];
        this.visitLoaded(node => {
            if (!node.hasChildren && this.config.canCheck(node.item) && this.getInherited(node.item)) {
                result.push(node.item);
            }
        });
        return result;
    }

    /**
     * Number of explicit checked decisions. Cheap; does not walk the tree.
     */
    public get checkedRootCount() {
        let count = 0;
        for (const checked of this.decisions.values()) {
            if (checked) {
                count++;
            }
        }
        return count;
    }

    /**
     * Drop all state and return to the configured default.
     */
    public clear(emit = true) {
        this.decisions.clear();
        this.decisionItems.clear();
        this.subtreeCount.clear();
        this.rootDecision = this.config.defaultChecked;
        if (emit) {
            this.onCheckStateChanged.emit();
        }
    }

    /**
     * Recompute derived counters against the current tree. Call after the tree reloads with items
     * that are equal by `keyOf` but not by reference.
     */
    public rebuild() {
        this.invalidateKeyIndex();
        this.subtreeCount.clear();

        for (const [key, item] of [...this.decisionItems]) {
            const node = this.findNode(item);
            // Re-point at the live item so getSelection hands back objects from the current tree.
            if (node) {
                this.decisionItems.set(key, node.item);
            }
            this.adjustAncestorCounts(node ? node.item : item, 1);
        }

        this.onCheckStateChanged.emit();
    }

    private resolveConfig(config: I2vCheckConfig<T>): ResolvedCheckConfig<T> {
        return {
            keyOf: config.keyOf ?? (item => item),
            canCheck: config.canCheck ?? (() => true),
            cascade: config.cascade ?? 'subtree',
            promoteParents: config.promoteParents ?? false,
            defaultChecked: config.defaultChecked ?? false
        };
    }

    private setRoot(checked: boolean, source: I2vCheckSource) {
        this.decisions.clear();
        this.decisionItems.clear();
        this.subtreeCount.clear();
        this.rootDecision = checked;
        this.onCheckStateChanged.emit();
        this.onCheckChanged.emit({ item: undefined as unknown as T, checked, source });
    }

    /**
     * The state an item reads, from the nearest ancestor-or-self decision. O(depth).
     */
    private getInherited(item: T): boolean {
        const own = this.decisions.get(this.config.keyOf(item));
        if (own !== undefined) {
            return own;
        }

        const node = this.findNode(item);
        if (node) {
            for (const ancestor of node.ancestors()) {
                if (ancestor.isRoot) {
                    break;
                }
                const decision = this.decisions.get(this.config.keyOf(ancestor.item));
                if (decision !== undefined) {
                    return decision;
                }
            }
        }

        return this.rootDecision;
    }

    /**
     * Write a decision for an item, keeping the "no redundant decisions" invariant.
     * @returns true if anything actually changed
     */
    private applyDecision(item: T, checked: boolean): boolean {
        // Only trust "already in that state" when the item's place in the tree is actually known.
        // An unloaded item reads as the root default regardless of what it will inherit once loaded,
        // so skipping here would silently drop a decision the user really made.
        const resolvable = !!this.findNode(item);

        if (resolvable && this.getState(item) === (checked ? 'checked' : 'unchecked')) {
            return false;
        }

        const key = this.config.keyOf(item);

        // Anything decided below this item is now overridden by it.
        if (this.config.cascade === 'subtree') {
            this.purgeSubtreeDecisions(item);
        }

        // Store only when the decision differs from what would be inherited from above. What an
        // unloaded item inherits is unknowable -- it may sit under a checked parent -- so it is
        // stored unconditionally and normalized later, once its ancestry is known.
        const inherited = resolvable ? this.getInheritedFromAncestors(item) : undefined;
        const hadOwn = this.decisions.has(key);

        if (inherited === checked) {
            if (hadOwn) {
                this.removeDecision(key, item);
            }
        } else if (!hadOwn) {
            this.addDecision(key, item, checked);
        } else {
            this.decisions.set(key, checked);
        }

        if (this.config.promoteParents) {
            this.promote(item);
        }

        return true;
    }

    /**
     * What the item would read if it had no decision of its own.
     */
    private getInheritedFromAncestors(item: T): boolean {
        const node = this.findNode(item);
        if (node) {
            for (const ancestor of node.ancestors()) {
                if (ancestor.isRoot) {
                    break;
                }
                const decision = this.decisions.get(this.config.keyOf(ancestor.item));
                if (decision !== undefined) {
                    return decision;
                }
            }
        }
        return this.rootDecision;
    }

    /**
     * Remove decisions strictly below the item, since it now decides for its whole subtree.
     *
     * Iterates the decision map rather than the subtree: the map is small by construction, whereas
     * a subtree can be enormous, and only loaded parts of it could be walked anyway.
     */
    private purgeSubtreeDecisions(item: T) {
        const key = this.config.keyOf(item);
        if ((this.subtreeCount.get(key) ?? 0) === 0) {
            return;
        }

        for (const [otherKey, otherItem] of [...this.decisionItems]) {
            if (otherKey !== key && this.isAncestorOf(item, otherItem)) {
                this.removeDecision(otherKey, otherItem);
            }
        }
    }

    /**
     * Replace a complete set of identical child decisions with one decision on the parent, which is
     * zTree's upward `p` cascade. Only applied when the parent's children are fully loaded, since a
     * partial view of the children cannot justify a claim about all of them.
     */
    private promote(item: T) {
        let node = this.findNode(item)?.parent;

        while (node && !node.isRoot) {
            if (!node.childrenLoaded || !node.hasChildren) {
                return;
            }

            const children = node.children,
                first = this.getInherited(children[0].item),
                uniform = children.every(child => this.getInherited(child.item) === first);

            if (!uniform || this.getInherited(node.item) === first) {
                return;
            }

            for (const child of children) {
                const childKey = this.config.keyOf(child.item);
                if (this.decisions.has(childKey)) {
                    this.removeDecision(childKey, child.item);
                }
            }

            const parentKey = this.config.keyOf(node.item);
            if (this.getInheritedFromAncestors(node.item) === first) {
                if (this.decisions.has(parentKey)) {
                    this.removeDecision(parentKey, node.item);
                }
            } else if (!this.decisions.has(parentKey)) {
                this.addDecision(parentKey, node.item, first);
            }

            node = node.parent;
        }
    }

    private addDecision(key: unknown, item: T, checked: boolean) {
        this.decisions.set(key, checked);
        this.decisionItems.set(key, item);

        // An unloaded item has no known ancestry yet, so its contribution to the counters has to
        // wait until its node appears.
        if (this.findNode(item)) {
            this.adjustAncestorCounts(item, 1);
        } else {
            this.pendingCounts.set(key, item);
        }
    }

    private removeDecision(key: unknown, item: T) {
        this.decisions.delete(key);
        this.decisionItems.delete(key);

        if (this.pendingCounts.has(key)) {
            this.pendingCounts.delete(key);
        } else {
            this.adjustAncestorCounts(item, -1);
        }
    }

    /**
     * Apply counters for decisions made against items that were not loaded at the time. Uses the
     * tree's reference lookup rather than the key index: the pending item is the very object the
     * caller passed, and that object is what the tree registers once its node is built.
     */
    private reconcilePending() {
        if (this.pendingCounts.size === 0) {
            return;
        }

        const query = this.queryProvider?.();
        if (!query) {
            return;
        }

        for (const [key, item] of [...this.pendingCounts]) {
            if (query.findNode(item)) {
                this.pendingCounts.delete(key);
                this.adjustAncestorCounts(item, 1);
            }
        }
    }

    /**
     * Maintain `subtreeCount` for every ancestor, which is what makes indeterminate an O(1) read.
     */
    private adjustAncestorCounts(item: T, delta: number) {
        const node = this.findNode(item);
        if (!node) {
            return;
        }

        for (const ancestor of node.ancestors()) {
            if (ancestor.isRoot) {
                break;
            }
            const key = this.config.keyOf(ancestor.item),
                next = (this.subtreeCount.get(key) ?? 0) + delta;

            if (next > 0) {
                this.subtreeCount.set(key, next);
            } else {
                this.subtreeCount.delete(key);
            }
        }
    }

    private isAncestorOf(ancestor: T, item: T): boolean {
        const node = this.findNode(item);
        if (!node) {
            return false;
        }

        const ancestorKey = this.config.keyOf(ancestor);
        for (const candidate of node.ancestors()) {
            if (candidate.isRoot) {
                break;
            }
            if (this.config.keyOf(candidate.item) === ancestorKey) {
                return true;
            }
        }
        return false;
    }

    /**
     * Resolve an item to its node.
     *
     * The tree's own lookup is keyed by object reference, which is not enough here: decisions are
     * keyed by `keyOf` precisely so they can outlive a reload, so an item handed back from
     * {@link getSelection} may be equal by key but a different object. Reference first because it is
     * O(1) and covers the common path; the key index is the fallback.
     */
    private findNode(item: T): Node<T> | undefined {
        const query = this.queryProvider?.();
        if (!query) {
            return undefined;
        }

        return query.findNode(item) ?? this.getKeyIndex().get(this.config.keyOf(item));
    }

    /**
     * Build (and cache) the key to node index over the loaded tree. Dropped by
     * {@link invalidateKeyIndex} whenever the tree it describes may have changed.
     */
    private getKeyIndex(): Map<unknown, Node<T>> {
        if (!this.keyIndex) {
            const index = new Map<unknown, Node<T>>();
            this.visitLoaded(node => index.set(this.config.keyOf(node.item), node));
            this.keyIndex = index;
        }
        return this.keyIndex;
    }

    private invalidateKeyIndex() {
        this.keyIndex = undefined;
    }

    /**
     * Walk the loaded part of the tree. `visitSubtree` stops at unloaded children, so this never
     * triggers a fetch.
     */
    private visitLoaded(visitor: (node: Node<T>) => void) {
        const root = this.queryProvider?.()?.getRootNode();
        if (!root) {
            return;
        }
        for (const child of root.children) {
            child.visitSubtree(visitor);
        }
    }
}
