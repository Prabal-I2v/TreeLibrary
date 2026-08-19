import { Component } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { I2vTreeComponent } from './tree.component';
import { I2vTree } from './tree.model';

interface Item {
    name: string;
    children: Item[];
}

const ITEM_HEIGHT = 20;
const VIEWPORT_HEIGHT = 200;
const ITEM_COUNT = 100;

@Component({
    standalone: true,
    imports: [I2vTreeComponent],
    template: `
        <div [style.height.px]="viewportHeight">
            <i2v-tree [itemHeight]="itemHeight" [model]="model">
                <ng-template let-node let-index="index" let-first="first" let-last="last" let-count="count" let-even="even" let-odd="odd">
                    <div class="row" [style.height.px]="itemHeight">
                        {{ node.item.name }}|{{ index }}|{{ first }}|{{ last }}|{{ count }}|{{ even }}|{{ odd }}
                    </div>
                </ng-template>
            </i2v-tree>
        </div>
    `
})
class HostComponent {
    public readonly itemHeight = ITEM_HEIGHT;
    public readonly viewportHeight = VIEWPORT_HEIGHT;
    public model = new I2vTree<Item>({ childAccessor: item => item.children });

    constructor() {
        this.model.load(Array.from({ length: ITEM_COUNT }, (_, n) => ({ name: `item-${n}`, children: [] })));
    }
}

describe('I2vTreeComponent', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HTMLElement;

    const rows = () => Array.from(host.querySelectorAll('.i2v-container .row'));
    const rowText = (i: number) => (rows()[i].textContent || '').replace(/\s+/g, ' ').trim();

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        host = fixture.nativeElement;
    });

    it('renders only the rows that fit the viewport', () => {
        // Regression guard: the component is OnPush and invalidateSize() runs after the first
        // render, so without change detection there it would be stuck at a single row.
        expect(rows().length).toBeGreaterThan(1);
        expect(rows().length).toBeLessThan(ITEM_COUNT);
        expect(rows().length).toBe(Math.ceil(VIEWPORT_HEIGHT / ITEM_HEIGHT) + 1);
    });

    it('uses the projected template and never falls back to the built-in row', () => {
        // The built-in row lives in the component's own view. Content queries only see the
        // consumer's declaration, so @ContentChild(TemplateRef) must not match #defaultRow.
        expect(rows().length).toBeGreaterThan(1);
        expect(host.querySelector('.i2v-node')).toBeNull();
        expect(host.querySelector('i2v-tree')!.classList.contains('i2v-default-rows')).toBe(false);
    });

    it('renders rows as flat siblings rather than a nested hierarchy', () => {
        const container = host.querySelector('.i2v-container');
        expect(rows().every(r => r.parentElement === container)).toBe(true);
        expect(container!.querySelector('.row .row')).toBeNull();
    });

    it('passes the item to the consumer template as $implicit', () => {
        expect(rowText(0)).toContain('item-0');
        expect(rowText(1)).toContain('item-1');
    });

    it('keeps the NgForOf context properties available to the consumer template', () => {
        const count = rows().length;

        // name | index | first | last | count | even | odd
        expect(rowText(0)).toBe(`item-0|0|true|false|${count}|true|false`);
        expect(rowText(1)).toBe(`item-1|1|false|false|${count}|false|true`);
        expect(rowText(count - 1)).toBe(`item-${count - 1}|${count - 1}|false|true|${count}|${count % 2 === 1}|${count % 2 === 0}`);
    });

    it('swaps in new rows when scrolled', () => {
        const treeEl = host.querySelector('i2v-tree') as HTMLElement;
        treeEl.scrollTop = 40 * ITEM_HEIGHT;
        treeEl.dispatchEvent(new Event('scroll'));
        fixture.detectChanges();

        expect(rowText(0)).toContain('item-40');
        expect(rows().length).toBe(Math.ceil(VIEWPORT_HEIGHT / ITEM_HEIGHT) + 1);
    });
});
