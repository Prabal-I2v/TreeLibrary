import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';

import { I2vVirtualTreeComponent } from './virtual-tree.component';
import { I2vVirtualTree } from './virtual-tree.model';
import { I2vTreeConfig } from './virtual-tree.config';

interface Item {
    name: string;
    type?: string;
    icon?: string;
    children?: Item[];
}

const ITEM_HEIGHT = 20;
const VIEWPORT_HEIGHT = 200;

@Component({
    standalone: true,
    imports: [I2vVirtualTreeComponent],
    template: `
        <div [style.height.px]="viewportHeight">
            <i2v-virtual-tree [itemHeight]="itemHeight" [config]="config" [data]="data"></i2v-virtual-tree>
        </div>
    `
})
class HostComponent {
    public readonly itemHeight = ITEM_HEIGHT;
    public readonly viewportHeight = VIEWPORT_HEIGHT;
    public config: I2vTreeConfig<any> = {};
    public data: Item[] = [];

    @ViewChild(I2vVirtualTreeComponent, { static: true })
    public tree!: I2vVirtualTreeComponent;
}

describe('I2vVirtualTreeComponent built-in row', () => {
    // Functions, not literals, so every test gets a fresh mutable copy.
    const treeData = (): Item[] => [
            { name: 'folder-0', type: 'Folder', children: [{ name: 'child-0' }, { name: 'child-1' }] },
            { name: 'file-0' },
            { name: 'file-1' }
        ],
        flatData = (count: number): Item[] => Array.from({ length: count }, (_, n) => ({ name: `item-${n}` }));

    let fixture: ComponentFixture<HostComponent>;
    let component: HostComponent;
    let host: HTMLElement;

    const nodes = () => Array.from(host.querySelectorAll<HTMLElement>('.i2v-node'));
    const labels = () => Array.from(host.querySelectorAll<HTMLElement>('.i2v-label'));
    const labelText = (i: number) => (labels()[i].textContent || '').trim();
    const iconClass = (i: number) => nodes()[i].querySelector('.i2v-icon')!.className;
    const expander = (i: number) => nodes()[i].querySelector<HTMLElement>('.i2v-expander');

    const render = (data: Item[], config: I2vTreeConfig<any> = {}) => {
        component.config = config;
        component.data = data;
        fixture.detectChanges();
    };

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(HostComponent);
        component = fixture.componentInstance;
        host = fixture.nativeElement;
        fixture.detectChanges();
    });

    it('renders the built-in row when no template is projected', () => {
        render(treeData());

        expect(nodes().length).toBe(3);
        expect(host.querySelector('i2v-virtual-tree')!.classList.contains('i2v-default-rows')).toBe(true);
    });

    it('labels rows from item.name by default and from config.getName when given', () => {
        render(treeData());
        expect(labelText(0)).toBe('folder-0');

        render(treeData(), { getName: (item: Item) => item.name.toUpperCase() });
        expect(labelText(0)).toBe('FOLDER-0');
    });

    it('picks folder and file icons from the item type', () => {
        render(treeData());

        expect(iconClass(0)).toContain('i2v-folder');
        expect(iconClass(1)).toContain('i2v-file-text');
    });

    it('swaps the folder icon and the expander direction on expand', () => {
        render(treeData());
        expect(iconClass(0)).toContain('i2v-folder');
        expect(expander(0)!.className).toContain('i2v-expander-right');

        expander(0)!.click();
        fixture.detectChanges();

        expect(iconClass(0)).toContain('i2v-folder-open');
        expect(expander(0)!.className).toContain('i2v-expander-down');
        expect(labelText(1)).toBe('child-0');
    });

    it('indents rows by depth and draws no expander on leaves', () => {
        render(treeData());
        expander(0)!.click();
        fixture.detectChanges();

        expect(nodes()[0].style.paddingLeft).toBe('1.5rem');
        expect(nodes()[1].style.paddingLeft).toBe('3rem');
        expect(expander(1)).toBeNull();
    });

    it('applies config.getDomNodeAttr, and drops stale attributes when a row is recycled', () => {
        // Rows are reused as the window slides, so an attribute stamped for the item that
        // previously occupied a slot has to be removed, not just left behind.
        render(flatData(100), {
            getDomNodeAttr: (item: Item) => (item.name === 'item-0' ? { 'data-first': 'yes' } : undefined)
        });
        expect(nodes()[0].getAttribute('data-first')).toBe('yes');

        const treeEl = host.querySelector('i2v-virtual-tree') as HTMLElement;
        treeEl.scrollTop = 40 * ITEM_HEIGHT;
        treeEl.dispatchEvent(new Event('scroll'));
        fixture.detectChanges();

        expect(labelText(0)).toBe('item-40');
        expect(nodes()[0].getAttribute('data-first')).toBeNull();
    });

    it('repaints the selection on a row click under OnPush', () => {
        render(treeData());

        labels()[1].click();
        fixture.detectChanges();

        expect(labels()[1].classList.contains('i2v-selected')).toBe(true);
        expect(labels()[0].classList.contains('i2v-selected')).toBe(false);
    });

    it('repaints when the model is selected from outside a listener', () => {
        // Nothing marks an OnPush view dirty when a caller drives the model directly, and
        // selection does not rebuild the row list, so onSelectionChanged has to do it.
        const data = treeData();
        render(data);

        component.tree.model.select(data[2]);
        fixture.detectChanges();

        expect(labels()[2].classList.contains('i2v-selected')).toBe(true);
    });

    it('repaints when the model is highlighted from outside a listener', () => {
        const data = treeData();
        render(data);

        component.tree.model.highlight(data[1]);
        fixture.detectChanges();

        expect(labels()[1].classList.contains('i2v-highlight')).toBe(true);
    });

    it('emits selectionChange once per change of selection', () => {
        const data = treeData(),
            seen: string[] = [];
        render(data);
        component.tree.selectionChange.subscribe((item: Item) => seen.push(item.name));

        labels()[1].click();
        labels()[1].click();
        labels()[2].click();

        expect(seen).toEqual(['file-0', 'file-1']);
    });

    it('applies filterText after the throttle and restores the tree when cleared', fakeAsync(() => {
        render(flatData(30), { filterThrottle: 500, filterTextMinLength: 2 });
        const tree = component.tree;

        tree.filterText = 'item-1';
        expect(tree.isFiltered).toBe(false); // still throttled

        tick(500);
        fixture.detectChanges();
        expect(tree.isFiltered).toBe(true);
        // item-1 plus item-10..item-19
        expect(tree.model.items.length).toBe(11);

        tree.filterText = '';
        fixture.detectChanges();
        expect(tree.isFiltered).toBe(false);
        expect(tree.model.items.length).toBe(30);
    }));

    it('treats filterTextMinLength as the minimum length that filters', fakeAsync(() => {
        render(flatData(30), { filterThrottle: 0, filterTextMinLength: 2 });
        const tree = component.tree;

        tree.filterText = 'i';
        tick(0);
        expect(tree.isFiltered).toBe(false);

        tree.filterText = 'it';
        tick(0);
        expect(tree.isFiltered).toBe(true);
    }));

    it('reports an item as loading while its children are in flight, then clears and repaints', fakeAsync(() => {
        // Mirrors the real contract: the accessor answers with the promise while the children are
        // unloaded and with the array once they have arrived. An accessor that keeps handing back a
        // promise would be re-loaded forever, because settling re-reads the children.
        const lazy: Item = { name: 'lazy' };
        let resolveChildren: () => void = () => undefined;
        const pending = new Promise<Item[]>(resolve => {
            resolveChildren = () => {
                lazy.children = [{ name: 'arrived' }];
                resolve(lazy.children);
            };
        });

        render([lazy], {
            canExpand: () => true,
            childAccessor: (item: Item) => item.children ?? (item === lazy ? pending : undefined),
            getDomNodeAttr: (item: Item, _node, state) => (state.isLoading(item) ? { 'data-loading': 'yes' } : undefined)
        });

        expander(0)!.click();
        fixture.detectChanges();
        expect(nodes()[0].getAttribute('data-loading')).toBe('yes');

        resolveChildren();
        tick();
        fixture.detectChanges();

        expect(nodes()[0].getAttribute('data-loading')).toBeNull();
        expect(labelText(1)).toBe('arrived');
    }));

    it('does not throw when a throttled filter settles after the tree is destroyed', fakeAsync(() => {
        render(flatData(30), { filterThrottle: 500 });

        component.tree.filterText = 'item-1';
        fixture.destroy();

        expect(() => tick(500)).not.toThrow();
    }));

    it('navigateToItem expands the ancestry so the item is actually reachable', () => {
        const data = treeData();
        render(data);
        const child = data[0].children![1];

        expect(component.tree.model.getItemIndex(child)).toBe(-1);
        component.tree.navigateToItem(child);
        fixture.detectChanges();

        // expandToItem only mutates the expanded set; without the invalidate the row list would
        // still not contain the child and the scroll would silently do nothing.
        expect(component.tree.model.getItemIndex(child)).toBe(2);
        expect(labelText(2)).toBe('child-1');
    });

    it('detaches the previous model when a new one is bound', () => {
        render(treeData());
        const replaced = component.tree.model,
            fresh = new I2vVirtualTree<Item>({ childAccessor: (item: Item) => item.children });

        fresh.load([{ name: 'only' }]);
        component.tree.model = fresh;
        fixture.detectChanges();
        expect(labelText(0)).toBe('only');

        replaced.load(flatData(50));
        fixture.detectChanges();
        expect(nodes().length).toBe(1);
        expect(labelText(0)).toBe('only');
    });
});

@Component({
    standalone: true,
    imports: [I2vVirtualTreeComponent],
    template: `
        <div [style.height.px]="viewportHeight">
            <i2v-virtual-tree [itemHeight]="itemHeight" [config]="config" [data]="data">
                <ng-template let-node>
                    <div class="row" [style.height.px]="itemHeight">{{ node.item.name }}</div>
                </ng-template>
            </i2v-virtual-tree>
        </div>
    `
})
class ProjectedHostComponent {
    public readonly itemHeight = ITEM_HEIGHT;
    public readonly viewportHeight = VIEWPORT_HEIGHT;
    public iconCalls = 0;
    public config: I2vTreeConfig<any> = {
        getIcon: () => {
            this.iconCalls++;
            return 'i2v-file-text';
        }
    };
    public data: Item[] = [{ name: 'projected-0' }, { name: 'projected-1' }];
}

describe('I2vVirtualTreeComponent row template selection', () => {
    it('never renders a frame of built-in rows before the projected template resolves', waitForAsync(async () => {
        await TestBed.configureTestingModule({ imports: [ProjectedHostComponent] }).compileComponents();

        const fixture = TestBed.createComponent(ProjectedHostComponent),
            host: HTMLElement = fixture.nativeElement;
        fixture.detectChanges();

        expect(host.querySelectorAll('.row').length).toBe(2);
        expect(host.querySelector('.i2v-node')).toBeNull();
        // getIcon only runs from the built-in row, so a single call means one was rendered.
        expect(fixture.componentInstance.iconCalls).toBe(0);
    }));
});
