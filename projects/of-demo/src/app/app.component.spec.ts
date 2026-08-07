import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppComponent } from './app.component';
import { ServerTreeDemoComponent } from './demos/server-tree-demo.component';

/** Waits for a debounced + awaited search to settle. */
async function settle(fixture: ComponentFixture<AppComponent>, demo: ServerTreeDemoComponent, timeoutMs = 15000) {
    const started = Date.now();
    while (demo.searching() && Date.now() - started < timeoutMs) {
        await new Promise(r => setTimeout(r, 50));
    }
    fixture.detectChanges();
}

describe('of-tree demo', () => {
    let fixture: ComponentFixture<AppComponent>;
    let demo: ServerTreeDemoComponent;

    const rows = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.vt-container .row'));
    const rowText = () => rows().map(r => (r.textContent || '').replace(/\s+/g, ' ').trim());

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(AppComponent);
        fixture.detectChanges();
        demo = fixture.debugElement.query(el => el.name === 'app-server-tree-demo').componentInstance;
    });

    it('renders the tree without rendering the whole data set', () => {
        expect(demo.totalNodes).toBeGreaterThanOrEqual(100000);
        expect(rows().length).toBeGreaterThan(0);
        expect(rows().length).toBeLessThan(demo.model.items.length);
    });

    it('keeps the original sample rows verbatim at the top, with no checkbox', () => {
        const first = rowText().slice(0, 2);
        expect(first[0]).toContain('cpu');
        expect(first[1]).toContain('gpu');

        expect(rows()[0].querySelector('input[type=checkbox]')).toBeNull();
        expect(rows()[1].querySelector('input[type=checkbox]')).toBeNull();
    });

    it('renders a checkbox for generated nodes, which use nocheck: false', () => {
        const generated = rows().find(r => (r.textContent || '').includes('cpu-00001'));
        expect(generated!.querySelector('input[type=checkbox]')).not.toBeNull();
    });

    it('holds some nodes back on the server so the two search modes differ', () => {
        expect(demo.lazyServerCount).toBeGreaterThan(0);
        expect(demo.hiddenNodes).toBeGreaterThan(0);
    });

    it('expandAll leaves lazy servers collapsed rather than expanded-but-empty', () => {
        demo.expandAll();

        const stillLazy = demo.model.items.filter(n => n.item.isParent && n.item.children?.length === 0);
        expect(stillLazy.length).toBeGreaterThan(0);
        stillLazy.forEach(n => expect(demo.model.isExpanded(n.item)).toBe(false));

        demo.collapseAll();
    });

    it('loads a lazy server in a single click even when already marked expanded', async () => {
        const server = demo.model.items.find(n => n.item.isParent && n.item.children?.length === 0)!.item;

        // reproduce the post-expandAll state: flagged expanded but with no children
        demo.model.setExpanded(server, true);
        expect(demo.model.isExpanded(server)).toBe(true);
        expect(server.children!.length).toBe(0);

        await demo.toggle(server, new MouseEvent('click'));

        expect(server.children!.length).toBeGreaterThan(0);
        expect(demo.model.isExpanded(server)).toBe(true);
    });

    it('client-side search finds a node that was never loaded, by loading everything', async () => {
        const server = demo.model.items.find(n => n.item.isParent && n.item.children?.length === 0)!.item;

        demo.setMode('client');
        demo.onSearch(server.name);
        await settle(fixture, demo);

        expect(demo.matchCount()).toBeGreaterThan(0);
        expect(demo.lastSearch()!.requests).toBe(demo.lazyServerCount);

        demo.clearSearch();
    });

    it('server-side search finds the same node while loading only what it needs', async () => {
        const server = demo.model.items.find(n => n.item.isParent && n.item.children?.length === 0)!.item;

        demo.setMode('server');
        demo.onSearch(server.name);
        await settle(fixture, demo);

        expect(demo.matchCount()).toBeGreaterThan(0);
        // one search request plus at most one fetch, versus one fetch per lazy server
        expect(demo.lastSearch()!.requests).toBeLessThan(demo.lazyServerCount);

        demo.clearSearch();
    });

    it('restores the full tree when the search is cleared', async () => {
        const before = demo.model.items.length;

        demo.setMode('server');
        demo.onSearch('AnalyticServerGPU');
        await settle(fixture, demo);
        expect(demo.isFiltered).toBe(true);

        demo.clearSearch();
        fixture.detectChanges();

        expect(demo.isFiltered).toBe(false);
        expect(demo.matchCount()).toBe(0);
        expect(demo.model.items.length).toBe(before);
    });

    it('cascades a check to loaded descendants', () => {
        const server = demo.model.items.find(n => n.item.name === 'cpu-00001')!.item;
        expect(server.children?.length).toBeGreaterThan(0);

        demo.toggleCheck(server, new MouseEvent('click'));

        expect(demo.isChecked(server)).toBe(true);
        expect(server.children!.every(child => demo.isChecked(child))).toBe(true);
        expect(demo.checkedCount()).toBe(1 + server.children!.length);
    });
});
