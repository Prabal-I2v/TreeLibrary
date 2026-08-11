import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';

import { I2vVirtualTreeComponent } from './virtual-tree.component';
import { DragArgs, I2vTreeConfig, TREE_ITEM_MIME } from './virtual-tree.config';

interface Item {
    name: string;
    type?: string;
    children?: Item[];
}

const ITEM_HEIGHT = 20;
const VIEWPORT_HEIGHT = 200;
/** Distance from the top of the viewport to the top of the tree, forced by the rect stub. */
const HOST_TOP = 50;

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
    public readonly moves: DragArgs<Item>[] = [];
    public allowDrop = true;
    public config: I2vTreeConfig<any> = {
        canDrag: () => true,
        canDrop: () => this.allowDrop,
        move: (args: DragArgs<Item>) => {
            this.moves.push(args);
            return Promise.resolve();
        },
        getDragData: (item: Item) => JSON.stringify({ name: item.name })
    };
    public data: Item[] = [
        { name: 'folder-0', type: 'Folder', children: [{ name: 'child-0' }] },
        { name: 'file-0' },
        { name: 'file-1' }
    ];

    @ViewChild(I2vVirtualTreeComponent, { static: true })
    public tree!: I2vVirtualTreeComponent;
}

describe('I2vVirtualTreeComponent drag and drop', () => {
    let fixture: ComponentFixture<HostComponent>;
    let component: HostComponent;
    let host: HTMLElement;
    let treeEl: HTMLElement;

    const overlay = () => host.querySelector<HTMLElement>('.i2v-dragoverlay')!;
    const nodes = () => Array.from(host.querySelectorAll<HTMLElement>('.i2v-node'));

    const treeTransfer = (payload = '{"name":"file-0"}') => {
        const dt = new DataTransfer();
        dt.setData(TREE_ITEM_MIME, payload);
        return dt;
    };

    /** clientY for a point `rows` down the tree, in viewport coordinates. */
    const atRow = (rows: number) => HOST_TOP + rows * ITEM_HEIGHT;

    const dispatch = (type: string, dataTransfer: DataTransfer | null, clientY = atRow(1.5), target: HTMLElement = treeEl) =>
        target.dispatchEvent(new DragEvent(type, { dataTransfer, clientY, bubbles: true, cancelable: true }));

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(HostComponent);
        component = fixture.componentInstance;
        host = fixture.nativeElement;
        fixture.detectChanges();
        treeEl = host.querySelector('i2v-virtual-tree') as HTMLElement;

        // Pin the tree's viewport position so the drop geometry is deterministic. Height stays
        // truthful so invalidateSize keeps computing the same row window.
        spyOn(treeEl, 'getBoundingClientRect').and.returnValue({
            top: HOST_TOP,
            left: 0,
            bottom: HOST_TOP + VIEWPORT_HEIGHT,
            right: 0,
            width: 0,
            height: VIEWPORT_HEIGHT,
            x: 0,
            y: HOST_TOP,
            toJSON: () => ({})
        } as DOMRect);
    });

    it('writes the tree mime type on dragstart', () => {
        const dt = new DataTransfer();
        dispatch('dragstart', dt, atRow(1), nodes()[1].querySelector('.i2v-node-title') as HTMLElement);

        expect(dt.types).toContain(TREE_ITEM_MIME);
        expect(JSON.parse(dt.getData(TREE_ITEM_MIME))).toEqual({ name: 'file-0' });
    });

    it('reads back on drop the same mime type dragstart writes', () => {
        // Guards a key mismatch between the two sides, which would make getData return '' and
        // JSON.parse throw on every cross-window drop.
        dispatch('drop', treeTransfer(), atRow(1.5));

        expect(component.moves.length).toBe(1);
        expect(component.moves[0].item).toEqual({ name: 'file-0' });
        expect((component.moves[0].parent as Item).name).toBe('file-0');
    });

    it('does not throw when a foreign payload arrives under the tree mime type', () => {
        expect(() => dispatch('drop', treeTransfer('this is not json'), atRow(1.5))).not.toThrow();
    });

    it('resolves the drop row from viewport coordinates, not page coordinates', () => {
        // clientY and getBoundingClientRect().top are both viewport relative; pageY is not.
        // Mixing them would offset the drop by the page scroll.
        dispatch('dragover', treeTransfer(), atRow(3.5));

        expect(overlay().style.top).toBe(3 * ITEM_HEIGHT + 'px');
    });

    it('keeps the overlay in content coordinates after the tree is scrolled', () => {
        // Needs more rows than fit, or scrollTop clamps to zero and the test proves nothing.
        component.data = Array.from({ length: 100 }, (_, n) => ({ name: `row-${n}` }));
        fixture.detectChanges();

        treeEl.scrollTop = 5 * ITEM_HEIGHT;
        treeEl.dispatchEvent(new Event('scroll'));
        fixture.detectChanges();

        dispatch('dragover', treeTransfer(), atRow(1.5));

        // Row under the cursor is 5 + 1 = 6, and the overlay shares the scrolled content box.
        expect(overlay().style.top).toBe(6 * ITEM_HEIGHT + 'px');
    });

    it('distinguishes dropping before, on and after a row', () => {
        const buffer = ITEM_HEIGHT / 4;

        dispatch('dragover', treeTransfer(), atRow(1.05));
        expect(overlay().style.top).toBe(ITEM_HEIGHT - buffer + 'px');
        expect(overlay().style.height).toBe(buffer * 2 + 'px');
        expect(overlay().classList.contains('i2v-dragoverlay-between')).toBe(true);

        dispatch('dragover', treeTransfer(), atRow(1.5));
        expect(overlay().style.top).toBe(ITEM_HEIGHT + 'px');
        expect(overlay().style.height).toBe(ITEM_HEIGHT + 'px');
        expect(overlay().classList.contains('i2v-dragoverlay-between')).toBe(false);

        dispatch('dragover', treeTransfer(), atRow(1.95));
        expect(overlay().style.top).toBe(2 * ITEM_HEIGHT - buffer + 'px');
        expect(overlay().style.height).toBe(buffer * 2 + 'px');
        expect(overlay().classList.contains('i2v-dragoverlay-between')).toBe(true);
    });

    it('paints the overlay behind the rows', () => {
        const container = host.querySelector('.vt-container')!;
        // Both are absolutely positioned with no z-index, so DOM order is paint order.
        expect(overlay().compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows the overlay while dragging over and hides it on drop', () => {
        expect(overlay().style.display).toBe('none');

        dispatch('dragover', treeTransfer(), atRow(1.5));
        fixture.detectChanges();
        expect(overlay().style.display).toBe('block');

        dispatch('drop', treeTransfer(), atRow(1.5));
        fixture.detectChanges();
        expect(overlay().style.display).toBe('none');
    });

    it('keeps the overlay up when dragleave only moves between rows', () => {
        dispatch('dragover', treeTransfer(), atRow(1.5));
        fixture.detectChanges();

        // dragleave bubbles from each row, so a move within the tree must not hide the overlay.
        nodes()[1].dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: nodes()[2] }));
        fixture.detectChanges();
        expect(overlay().style.display).toBe('block');

        treeEl.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body }));
        fixture.detectChanges();
        expect(overlay().style.display).toBe('none');
    });

    it('ignores drags that do not carry a tree item', () => {
        const foreign = new DataTransfer();
        foreign.setData('text/plain', 'hello');

        dispatch('dragover', foreign, atRow(1.5));
        fixture.detectChanges();

        expect(overlay().style.display).toBe('none');
    });

    it('expands a collapsed folder after hovering over it', fakeAsync(() => {
        expect(nodes().length).toBe(3);

        dispatch('dragover', treeTransfer(), atRow(0.5));
        tick(600);
        fixture.detectChanges();

        expect(component.tree.model.isExpanded(component.data[0])).toBe(true);
        expect(nodes().length).toBe(4);
    }));

    it('does not move anything when canDrop refuses', () => {
        component.allowDrop = false;

        dispatch('drop', treeTransfer(), atRow(1.5));

        expect(component.moves.length).toBe(0);
    });
});
