import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';
import { I2vTreeViewComponent } from './tree-view.component';
import { I2vTreeConfig } from '../tree/tree.config';

interface Row {
    id: string;
    name: string;
    kind?: string;
    children?: Row[];
}

const DATA = (): Row[] => [
    {
        id: 'alpha',
        name: 'Alpha',
        kind: 'Group',
        children: [{ id: 'a1', name: 'Anchor', kind: 'Camera' }, { id: 'a2', name: 'Beacon', kind: 'Camera' }]
    },
    { id: 'bravo', name: 'Bravo', kind: 'Group', children: [{ id: 'b1', name: 'Compass', kind: 'Camera' }] }
];

@Component({
    standalone: true,
    imports: [I2vTreeViewComponent],
    template: `
        <div [style.height.px]="300">
            <i2v-tree-view
                [config]="config"
                [data]="data"
                [itemHeight]="20"
                [title]="title"
                [loading]="loading"
                [showRefresh]="true"
                [showExpandToggle]="true"
                [showCount]="showCount"
                [countBy]="countBy"
                [searchDebounce]="0"
                [searchFields]="searchFields"
                [searchField]="searchField"
            ></i2v-tree-view>
        </div>
    `
})
class HostComponent {
    @ViewChild(I2vTreeViewComponent, { static: true }) public view!: I2vTreeViewComponent;
    public config: I2vTreeConfig<Row> = {};
    public data: Row[] = [];
    public title = 'Devices';
    public loading = false;
    public showCount = false;
    public countBy?: (item: Row) => string | undefined;
    public searchFields: { key: string; label: string }[] = [];
    public searchField?: string;
}

describe('I2vTreeViewComponent', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;
    let el: HTMLElement;

    const rows = () => Array.from(el.querySelectorAll('.i2v-node')) as HTMLElement[];
    const q = (sel: string) => el.querySelector(sel) as HTMLElement | null;
    const search = (text: string) => {
        const input = q('.i2v-tv-search-input') as HTMLInputElement;
        input.value = text;
        input.dispatchEvent(new Event('input'));
        tick(1);
        fixture.detectChanges();
    };

    function build(overrides: Partial<HostComponent> = {}) {
        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        el = fixture.nativeElement;
        fixture.detectChanges();

        Object.assign(host, overrides);
        host.config = { childAccessor: r => r.children, canExpand: r => !!r.children, getName: r => r.name, keyOf: r => r.id };
        host.data = DATA();
        fixture.detectChanges();
    }

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    }));

    describe('header', () => {
        it('renders the title and the toolbar buttons', () => {
            build();
            expect(q('.i2v-tv-title')!.textContent!.trim()).toBe('Devices');
            expect(q('.i2v-tv-refresh')).not.toBeNull();
            expect(q('.i2v-tv-expand')).not.toBeNull();
        });

        it('refresh clears the search and raises an event, leaving the reload to the host', fakeAsync(() => {
            build();
            let refreshed = 0;
            host.view.refresh.subscribe(() => refreshed++);

            search('alp');
            expect(host.view.searchText).toBe('alp');

            q('.i2v-tv-refresh')!.click();
            fixture.detectChanges();

            expect(refreshed).toBe(1);
            expect(host.view.searchText).toBe('');
        }));

        it('expand toggle expands and collapses, and reports its state', () => {
            build();
            const states: boolean[] = [];
            host.view.expandAllChange.subscribe(s => states.push(s));

            q('.i2v-tv-expand')!.click();
            fixture.detectChanges();
            expect(rows().length).toBe(5);

            q('.i2v-tv-expand')!.click();
            fixture.detectChanges();
            expect(rows().length).toBe(2);

            expect(states).toEqual([true, false]);
        });

        it('keeps expand state per instance', () => {
            build();
            const second = TestBed.createComponent(HostComponent);
            second.detectChanges();

            q('.i2v-tv-expand')!.click();
            fixture.detectChanges();

            expect(host.view.isExpanded).toBe(true);
            // The legacy tree kept this on a root singleton, so one tree flipped every other one.
            expect(second.componentInstance.view.isExpanded).toBe(false);
        });
    });

    describe('states', () => {
        it('shows the empty state when there is no data', () => {
            build();
            host.data = [];
            fixture.detectChanges();

            expect(q('.i2v-tv-empty')).not.toBeNull();
            expect(q('.i2v-tv-empty')!.textContent).toContain('No data.');
        });

        it('shows the no-result state when a search matches nothing', fakeAsync(() => {
            build();
            search('zzzz');

            expect(q('.i2v-tv-noresult')).not.toBeNull();
            expect(q('.i2v-tv-empty')).toBeNull();
        }));

        it('loading beats every other state', () => {
            build();
            host.data = [];
            host.loading = true;
            fixture.detectChanges();

            expect(q('.i2v-tv-loading')).not.toBeNull();
            expect(q('.i2v-tv-empty')).toBeNull();
        });

        it('keeps the tree mounted, so its state survives a search that matches nothing', fakeAsync(() => {
            build();
            q('.i2v-tv-expand')!.click();
            fixture.detectChanges();

            search('zzzz');
            expect(q('i2v-tree')).not.toBeNull();

            search('');
            // Still expanded: the tree was never torn down.
            expect(rows().length).toBe(5);
        }));

        it('raises noResult only when the state changes', fakeAsync(() => {
            build();
            const seen: boolean[] = [];
            host.view.noResult.subscribe(v => seen.push(v));

            search('zzzz');
            search('zzzzz');
            search('alp');

            expect(seen).toEqual([true, false]);
        }));
    });

    describe('search', () => {
        it('filters to matches and their ancestors', fakeAsync(() => {
            build();
            search('compass');

            const text = rows().map(r => r.textContent!.trim());
            expect(text.some(t => t.includes('Compass'))).toBe(true);
            expect(text.some(t => t.includes('Bravo'))).toBe(true);
            expect(text.some(t => t.includes('Alpha'))).toBe(false);
        }));

        it('ignores terms below the minimum length', fakeAsync(() => {
            build();
            search('a');

            expect(rows().length).toBe(2);
        }));

        it('restores the tree when cleared', fakeAsync(() => {
            build();
            search('compass');
            search('');

            expect(rows().length).toBe(2);
        }));

        it('searches the configured field when one is chosen', fakeAsync(() => {
            build();
            host.searchFields = [{ key: 'name', label: 'Name' }, { key: 'id', label: 'Id' }];
            host.searchField = 'id';
            fixture.detectChanges();

            search('bravo');
            expect(rows().some(r => r.textContent!.includes('Bravo'))).toBe(true);
        }));

        it('emits the search text', fakeAsync(() => {
            build();
            const seen: string[] = [];
            host.view.searchTextChange.subscribe(t => seen.push(t));

            search('alp');
            expect(seen).toEqual(['alp']);
        }));
    });

    describe('counts', () => {
        it('summarizes loaded rows by group', () => {
            build();
            host.showCount = true;
            host.countBy = (r: Row) => r.kind;
            fixture.detectChanges();

            q('.i2v-tv-expand')!.click();
            fixture.detectChanges();

            const counts = host.view.getCounts();
            expect(counts.get('Group')).toBe(2);
            expect(counts.get('Camera')).toBe(3);
            // Formatting is offered, but the raw map is what the host binds for translation.
            expect(host.view.getCountSummary()).toContain('Total: 5');
        });
    });

    describe('menus', () => {
        it('raises search-by rather than rendering a menu itself', () => {
            build();
            host.searchFields = [{ key: 'name', label: 'Name' }, { key: 'id', label: 'Id' }];
            fixture.detectChanges();

            let raised = 0;
            host.view.searchByMenu.subscribe(() => raised++);
            q('.i2v-tv-searchby')!.click();

            expect(raised).toBe(1);
        });

        it('hides the search-by affordance when there is only one field', () => {
            build();
            expect(q('.i2v-tv-searchby')).toBeNull();
        });
    });

    describe('two instances', () => {
        it('are independent', fakeAsync(() => {
            build();
            const second = TestBed.createComponent(HostComponent);
            second.detectChanges();
            second.componentInstance.config = host.config;
            second.componentInstance.data = DATA();
            second.detectChanges();

            search('compass');

            const secondRows = Array.from(second.nativeElement.querySelectorAll('.i2v-node'));
            // Regression for the legacy hardcoded id="ztree", where a second tree stole the first's
            // DOM node and the two shared state.
            expect(secondRows.length).toBe(2);
        }));
    });
});
