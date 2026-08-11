import { Component, input, output } from '@angular/core';
import { Node, I2vVirtualTree } from 'i2v-tree';

import { TreeDataModel, isPartiallyChecked } from './tree-data';

/**
 * A single tree row, pulled out of the tree's <ng-template> into its own component so the
 * markup, styling and row-level actions can be owned independently of the tree.
 *
 * Row state is derived, never passed in. Expand and selection state belong to the tree,
 * checked and loading belong to the node's NodeUIState, indeterminate is a function of the subtree -
 * so the row reads all five rather than making every caller restate what the model already
 * decided, and keep it in sync. Only interactions leave, as outputs. Everything derived is
 * protected or private: the row's state is nobody else's to read.
 *
 * Change detection is deliberately Default rather than OnPush. The derived state above lives
 * in plain sets and mutable fields, not signals, so an OnPush row would keep a stale
 * highlight after `select()`, which does not rebuild the item list. Virtualisation means only
 * the visible rows exist, so checking them per cycle costs nothing at any data set size.
 *
 * Row actions are projected, not built in - pass buttons, toggles or entire components:
 *
 * ```html
 * <app-tree-node [node]="node" [treeModel]="model" (rowClicked)="select(node.item)">
 *     <button (click)="rename(node.item); $event.stopPropagation()">Rename</button>
 *     <app-node-toggle [on]="isOn(node.item)" (toggled)="setOn(node.item, $event)" />
 * </app-tree-node>
 * ```
 */
@Component({
    selector: 'app-tree-node',
    standalone: true,
    templateUrl: './tree-node.component.html',
    styleUrl: './tree-node.component.scss'
})
export class TreeNodeComponent {
    /** The node this row renders. */
    public readonly node = input.required<Node<TreeDataModel>>();
    /**
     * The tree model the node belongs to, and the authority on its expand and selection
     * state, so the row asks it rather than taking [expanded] and [selected] the caller
     * would have to keep honest.
     */
    public readonly treeModel = input.required<I2vVirtualTree<TreeDataModel>>();

    /**
     * Fixed height of the row, in px. Must equal the tree's [itemHeight]: the scroller
     * positions rows by arithmetic, so a row that renders taller than it claims makes the
     * whole viewport drift.
     */
    public readonly rowHeight = input(28);
    /** Left padding added per depth level, in rem. */
    public readonly indentPerLevelRem = input(1.15);

    /**
     * The three outputs report the gesture, not its outcome, because the row genuinely does
     * not know the outcome: clicking an expander may expand, collapse, or trigger a lazy
     * fetch, and only the page knows which. Each carries the DOM event so the handler can
     * stop it reaching the row beneath.
     */
    public readonly expanderClicked = output<MouseEvent>();
    public readonly checkboxClicked = output<Event>();
    public readonly rowClicked = output<void>();

    /** `protected` rather than `private` throughout: Angular templates may read protected. */
    protected get item() {
        return this.node().item;
    }

    protected selected() {
        return this.treeModel().isSelected(this.item);
    }

    protected checked() {
        return this.item.NodeUIState.checked;
    }

    protected indeterminate() {
        return isPartiallyChecked(this.item);
    }

    protected expanderClass() {
        if (!this.expandable()) {
            return 'expander expander-empty';
        }
        if (this.loading()) {
            return 'expander expander-busy';
        }
        return this.expanded() ? 'expander expander-open' : 'expander';
    }

    private expanded() {
        return this.treeModel().isExpanded(this.item);
    }

    /** The node carries its own fetch state, so a row knows when its children are inbound. */
    private loading() {
        return this.item.NodeUIState.loading;
    }

    /**
     * `isParent` is a structural field of TreeDataModel, so the row already knows - passing
     * it in would just restate the model.
     *
     * Deliberately not I2vVirtualTree.isExpandable(), which falls back to "has loaded
     * children" while a filter is active. That would hide the expander on a matched but
     * unloaded node, exactly when it is needed.
     */
    private expandable() {
        return this.item.isParent;
    }

    protected meta() {
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
