import { Directive, TemplateRef, inject } from '@angular/core';
import { Node } from '../../models';
import { I2vItemState } from './tree.config';

/**
 * Context handed to a row template. The NgForOf-shaped keys are kept so templates written against
 * the older bare `<ng-template>` form keep working unchanged.
 */
export interface I2vTreeRowContext<T> {
    $implicit: Node<T>;
    /** Index within the rendered window, not the tree. Use `absoluteIndex` for the row's real position. */
    index: number;
    /** Index within the whole flattened tree. */
    absoluteIndex: number;
    count: number;
    first: boolean;
    last: boolean;
    even: boolean;
    odd: boolean;
    /** Expanded / selected / highlighted / loading accessors for this item. */
    state: I2vItemState<T>;
}

/**
 * Marks the template used for each row.
 *
 * Exists mainly for the context guard: under `strictTemplates` a bare `<ng-template let-node>`
 * gives `node` the type `any`, and there is no way to type it without a directive to hang
 * `ngTemplateContextGuard` on.
 *
 * @example
 * <i2v-tree [model]="model">
 *   <ng-template i2vTreeRow let-node let-state="state">{{ node.item.name }}</ng-template>
 * </i2v-tree>
 */
@Directive({
    selector: '[i2vTreeRow]',
    standalone: true
})
export class I2vTreeRowDirective<T = any> {
    public readonly template = inject<TemplateRef<I2vTreeRowContext<T>>>(TemplateRef);

    /**
     * Tells the template type checker what `let-` bindings resolve to.
     * @ignore
     */
    public static ngTemplateContextGuard<T>(_dir: I2vTreeRowDirective<T>, _ctx: unknown): _ctx is I2vTreeRowContext<T> {
        return true;
    }
}

/**
 * Content rendered at the start of every built-in row, before the expander.
 */
@Directive({
    selector: '[i2vTreeRowPrefix]',
    standalone: true
})
export class I2vTreeRowPrefixDirective<T = any> {
    public readonly template = inject<TemplateRef<I2vTreeRowContext<T>>>(TemplateRef);

    /** @ignore */
    public static ngTemplateContextGuard<T>(_dir: I2vTreeRowPrefixDirective<T>, _ctx: unknown): _ctx is I2vTreeRowContext<T> {
        return true;
    }
}

/**
 * Content rendered at the end of every built-in row, after the label.
 *
 * This is where per-row actions belong -- a toggle switch, a delete button. zTree had to inject that
 * markup by hand in `addDiyDom`; here it costs no library surface at all.
 */
@Directive({
    selector: '[i2vTreeRowSuffix]',
    standalone: true
})
export class I2vTreeRowSuffixDirective<T = any> {
    public readonly template = inject<TemplateRef<I2vTreeRowContext<T>>>(TemplateRef);

    /** @ignore */
    public static ngTemplateContextGuard<T>(_dir: I2vTreeRowSuffixDirective<T>, _ctx: unknown): _ctx is I2vTreeRowContext<T> {
        return true;
    }
}
