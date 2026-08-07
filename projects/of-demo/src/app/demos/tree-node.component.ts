import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Node } from 'of-tree';

import { TreeDataModel } from './tree-data';

/**
 * A single tree row, pulled out of the tree's <ng-template> into its own component so the
 * markup, styling and row-level actions can be owned independently of the tree.
 *
 * It is deliberately presentational: every piece of state arrives as an input and every
 * interaction leaves as an output, so it has no idea an OfVirtualTree exists.
 *
 * Row actions are projected, not built in - pass buttons, toggles or entire components:
 *
 * ```html
 * <app-tree-node [node]="node" [checked]="isChecked(node.item)" (picked)="select(node.item)">
 *     <button (click)="rename(node.item); $event.stopPropagation()">Rename</button>
 *     <app-node-toggle [on]="isOn(node.item)" (toggled)="setOn(node.item, $event)" />
 * </app-tree-node>
 * ```
 */
@Component({
    selector: 'app-tree-node',
    standalone: true,
    templateUrl: './tree-node.component.html',
    styleUrl: './tree-node.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class TreeNodeComponent {
    public readonly node = input.required<Node<TreeDataModel>>();

    /** Must match the tree's [itemHeight]; the scroller positions rows by arithmetic. */
    public readonly height = input(28);
    /** Indent per depth level, in rem. */
    public readonly indent = input(1.15);

    public readonly expanded = input(false);
    public readonly loading = input(false);
    public readonly selected = input(false);
    public readonly checked = input(false);
    public readonly indeterminate = input(false);

    public readonly toggled = output<MouseEvent>();
    public readonly checkToggled = output<Event>();
    public readonly picked = output<void>();

    public get item() {
        return this.node().item;
    }

    /**
     * `isParent` is a structural field of TreeDataModel, so the row already knows - passing
     * it in would just restate the model.
     *
     * Deliberately not OfVirtualTree.isExpandable(), which falls back to "has loaded
     * children" while a filter is active. That would hide the expander on a matched but
     * unloaded node, exactly when it is needed.
     */
    public expandable() {
        return this.item.isParent;
    }

    public expanderClass() {
        if (!this.expandable()) {
            return 'expander expander-empty';
        }
        if (this.loading()) {
            return 'expander expander-busy';
        }
        return this.expanded() ? 'expander expander-open' : 'expander';
    }

    public meta() {
        const { typeOfNode, ip } = this.item.data;

        if (typeOfNode === 'VideoSource') {
            return ip;
        }
        if (typeOfNode === 'Pipeline') {
            const sources = this.item.children?.length ?? 0;
            return `${sources} source${sources === 1 ? '' : 's'} · Pipeline`;
        }
        return `${ip} · ${typeOfNode}`;
    }
}
