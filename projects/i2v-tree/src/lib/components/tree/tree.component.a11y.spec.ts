import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { I2vTreeComponent } from './tree.component';
import { I2vTreeRowSuffixDirective } from './tree.templates';
import { I2vTree } from './tree.model';
import { I2vTreeConfig } from './tree.config';

interface Row {
    id: string;
    name: string;
    children?: Row[];
    locked?: boolean;
}

const DATA = (): Row[] => [
    {
        id: 'alpha',
        name: 'Alpha',
        children: [{ id: 'a1', name: 'Anchor' }, { id: 'a2', name: 'Beacon' }]
    },
    { id: 'bravo', name: 'Bravo', children: [{ id: 'b1', name: 'Compass', locked: true }] },
    { id: 'charlie', name: 'Charlie' }
];

// Height lives on a wrapper: the tree measures its own host, which only has a size once an ancestor
// gives it one.
@Component({
    standalone: true,
    imports: [I2vTreeComponent],
    template: `
        <div [style.height.px]="200">
            <i2v-tree [itemHeight]="20" [config]="config" [data]="data" ariaLabel="Devices"></i2v-tree>
        </div>
    `
})
class HostComponent {
    @ViewChild(I2vTreeComponent, { static: true }) public tree!: I2vTreeComponent;
    public actioned = '';
    public config: I2vTreeConfig<Row> = {};
    public data: Row[] = [];
}

/**
 * Separate host rather than an `@if` inside the tree: a control-flow block compiles to an
 * `<ng-template>`, which the tree's bare-template content query would match and render as the row.
 */
@Component({
    standalone: true,
    imports: [I2vTreeComponent, I2vTreeRowSuffixDirective],
    template: `
        <div [style.height.px]="200">
            <i2v-tree [itemHeight]="20" [config]="config" [data]="data">
                <ng-template i2vTreeRowSuffix let-node>
                    <button class="row-action" (click)="actioned = node.item.id">go</button>
                </ng-template>
            </i2v-tree>
        </div>
    `
})
class SuffixHostComponent extends HostComponent {}

describe('I2vTreeComponent accessibility and keyboard', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;

    /** The tree's own model, which the component creates from [config]. */
    let model: I2vTree<Row>;

    function build(config: Partial<I2vTreeConfig<Row>> = {}, withSuffix = false) {
        fixture = TestBed.createComponent(withSuffix ? SuffixHostComponent : HostComponent);
        host = fixture.componentInstance;
        // Render once empty so the view initializes and the tree measures a host that already has
        // its height; only then bind data.
        fixture.detectChanges();
        host.config = {
            childAccessor: r => r.children,
            canExpand: r => !!r.children,
            getName: r => r.name,
            keyOf: r => r.id,
            lazyLoad: false,
            ...config
        } as I2vTreeConfig<Row>;
        host.data = DATA();
        fixture.detectChanges();
        model = host.tree.model;
        return host.tree;
    }

    const rows = () => Array.from(fixture.nativeElement.querySelectorAll('.i2v-node')) as HTMLElement[];
    const press = (key: string, init: Partial<KeyboardEvent> = {}) => {
        // cancelable, or preventDefault is silently a no-op and defaultPrevented never becomes true.
        const evt = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
        fixture.nativeElement.querySelector('i2v-tree').dispatchEvent(evt);
        fixture.detectChanges();
        return evt;
    };

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({ imports: [HostComponent, SuffixHostComponent] }).compileComponents();
    }));

    describe('ARIA', () => {
        it('marks the container as a tree and names it', () => {
            build();
            const el = fixture.nativeElement.querySelector('i2v-tree');

            expect(el.getAttribute('role')).toBe('tree');
            expect(el.getAttribute('aria-label')).toBe('Devices');
        });

        it('gives every row treeitem semantics with level and position', () => {
            build();
            const first = rows()[0];

            expect(first.getAttribute('role')).toBe('treeitem');
            expect(first.getAttribute('aria-level')).toBe('1');
            expect(first.getAttribute('aria-posinset')).toBe('1');
            expect(first.getAttribute('aria-setsize')).toBe('3');
        });

        it('reports aria-expanded only for expandable rows', () => {
            build();
            const [alpha, , charlie] = rows();

            expect(alpha.getAttribute('aria-expanded')).toBe('false');
            // A leaf must omit the attribute entirely rather than report false.
            expect(charlie.hasAttribute('aria-expanded')).toBe(false);
        });

        it('updates aria-expanded and child levels after expanding', () => {
            const tree = build();
            tree.toggleExpand(model.items[0].item);
            fixture.detectChanges();

            expect(rows()[0].getAttribute('aria-expanded')).toBe('true');
            expect(rows()[1].getAttribute('aria-level')).toBe('2');
        });

        it('points aria-activedescendant at the highlighted row', () => {
            build();
            press('ArrowDown');

            const el = fixture.nativeElement.querySelector('i2v-tree'),
                active = el.getAttribute('aria-activedescendant');

            expect(active).toBeTruthy();
            expect(rows().some(r => r.id === active)).toBe(true);
        });

        it('only advertises multiselectable when configured', () => {
            build();
            expect(fixture.nativeElement.querySelector('i2v-tree').hasAttribute('aria-multiselectable')).toBe(false);

            build({ selectionMode: 'multiple' });
            expect(fixture.nativeElement.querySelector('i2v-tree').getAttribute('aria-multiselectable')).toBe('true');
        });
    });

    describe('keyboard', () => {
        it('Home and End jump to the first and last row', () => {
            build();
            press('End');
            expect(model.getHighlightedItem()!.id).toBe('charlie');

            press('Home');
            expect(model.getHighlightedItem()!.id).toBe('alpha');
        });

        it('Space toggles expansion when checkboxes are off', () => {
            build();
            press('Home');
            press(' ');

            expect(model.isExpanded(model.items[0].item)).toBe(true);
        });

        it('Space toggles the check when checkboxes are on', () => {
            build({ checkboxes: true });
            press('Home');
            press(' ');

            expect(model.checks.isChecked(model.items[0].item)).toBe(true);
            expect(model.isExpanded(model.items[0].item)).toBe(false);
        });

        it('Space is always prevented so the container does not scroll', () => {
            build();
            press('Home');
            expect(press(' ').defaultPrevented).toBe(true);
        });

        it('Escape raises an output rather than being swallowed', () => {
            const tree = build();
            let seen = false;
            tree.escape.subscribe(() => (seen = true));

            press('Escape');
            expect(seen).toBe(true);
        });

        it('Enter activates the highlighted row', () => {
            const tree = build();
            const activated: string[] = [];
            tree.itemActivate.subscribe(e => activated.push(e.item.id));

            press('Home');
            press('Enter');

            expect(activated).toEqual(['alpha']);
        });

        it('type-ahead jumps to the first row starting with the typed letters', () => {
            build();
            press('c');

            expect(model.getHighlightedItem()!.id).toBe('charlie');
        });

        it('type-ahead accumulates within the buffer window', () => {
            const tree = build();
            tree.toggleExpand(model.items[0].item);
            fixture.detectChanges();

            // "Anchor" and "Alpha" both start with A; "an" must pick Anchor.
            press('a');
            press('n');

            expect(model.getHighlightedItem()!.name).toBe('Anchor');
        });

        it('ignores keys held with a modifier, leaving shortcuts to the host', () => {
            build();
            press('a', { ctrlKey: true });

            expect(model.getHighlightedItem()).toBeUndefined();
        });

        it('ContextMenu key raises itemContextMenu for the highlighted row', () => {
            const tree = build();
            const seen: string[] = [];
            tree.itemContextMenu.subscribe(e => seen.push(e.item.id));

            press('Home');
            press('ContextMenu');

            expect(seen).toEqual(['alpha']);
        });
    });

    describe('checkboxes', () => {
        it('renders none by default', () => {
            build();
            expect(fixture.nativeElement.querySelectorAll('.i2v-checkbox').length).toBe(0);
        });

        it('renders one per row when enabled', () => {
            build({ checkboxes: true });
            expect(fixture.nativeElement.querySelectorAll('.i2v-checkbox').length).toBe(3);
        });

        it('omits the checkbox for items that cannot be checked', () => {
            const tree = build({ checkboxes: true, check: { canCheck: (r: Row) => !r.locked } });
            tree.toggleExpand(model.items[1].item);
            fixture.detectChanges();

            const locked = rows().find(r => r.textContent!.includes('Compass'))!;
            expect(locked.querySelector('.i2v-checkbox')).toBeNull();
        });

        it('reflects indeterminate as a property, since there is no such attribute', () => {
            const tree = build({ checkboxes: true });
            tree.toggleExpand(model.items[0].item);
            fixture.detectChanges();

            model.checks.setChecked(model.items[1].item, true);
            fixture.detectChanges();

            const parentBox = rows()[0].querySelector('.i2v-checkbox') as HTMLInputElement;
            expect(parentBox.indeterminate).toBe(true);
            expect(parentBox.checked).toBe(false);
        });

        it('clicking a checkbox checks without selecting the row', () => {
            build({ checkboxes: true });
            const box = rows()[0].querySelector('.i2v-checkbox') as HTMLInputElement;

            box.click();
            fixture.detectChanges();

            expect(model.checks.isChecked(model.items[0].item)).toBe(true);
            expect(model.getSelectedItem()).toBeUndefined();
        });

        it('emits checkChange', () => {
            const tree = build({ checkboxes: true });
            const seen: { id: string; checked: boolean }[] = [];
            tree.checkChange.subscribe(e => seen.push({ id: e.item.id, checked: e.checked }));

            (rows()[0].querySelector('.i2v-checkbox') as HTMLInputElement).click();

            expect(seen).toEqual([{ id: 'alpha', checked: true }]);
        });
    });

    describe('multi-select', () => {
        it('ctrl-click adds to the selection', () => {
            build({ selectionMode: 'multiple' });
            (rows()[0].querySelector('.i2v-node-title') as HTMLElement).click();
            rows()[2]
                .querySelector('.i2v-node-title')!
                .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
            fixture.detectChanges();

            expect(model.getSelectedItems().map(r => r.id).sort()).toEqual(['alpha', 'charlie']);
        });

        it('shift-click selects the visible range', () => {
            build({ selectionMode: 'multiple' });
            (rows()[0].querySelector('.i2v-node-title') as HTMLElement).click();
            rows()[2]
                .querySelector('.i2v-node-title')!
                .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
            fixture.detectChanges();

            expect(model.getSelectedItems().map(r => r.id)).toEqual(['alpha', 'bravo', 'charlie']);
        });

        it('plain click still replaces the selection', () => {
            build({ selectionMode: 'multiple' });
            (rows()[0].querySelector('.i2v-node-title') as HTMLElement).click();
            (rows()[2].querySelector('.i2v-node-title') as HTMLElement).click();
            fixture.detectChanges();

            expect(model.getSelectedItems().map(r => r.id)).toEqual(['charlie']);
        });
    });

    describe('row slots', () => {
        it('renders projected suffix content on every row without becoming the row itself', () => {
            build({}, true);

            expect(fixture.nativeElement.querySelectorAll('.row-action').length).toBe(3);
            // The row's own label must survive alongside the slot.
            expect(rows()[0].textContent).toContain('Alpha');
        });

        it('suffix content receives the row node', () => {
            build({}, true);
            (rows()[1].querySelector('.row-action') as HTMLElement).click();

            expect(host.actioned).toBe('bravo');
        });
    });

    describe('disabled rows', () => {
        it('marks them and refuses selection', () => {
            build({ isDisabled: (r: Row) => r.id === 'bravo' });
            const bravo = rows()[1];

            expect(bravo.getAttribute('aria-disabled')).toBe('true');

            (bravo.querySelector('.i2v-node-title') as HTMLElement).click();
            fixture.detectChanges();

            expect(model.getSelectedItem()).toBeUndefined();
        });
    });

    describe('match highlighting', () => {
        it('wraps matching spans without using innerHTML', () => {
            const tree = build();
            tree.filterText = 'brav';
            fixture.detectChanges();

            const marks = Array.from(fixture.nativeElement.querySelectorAll('.i2v-match')) as HTMLElement[];
            expect(marks.length).toBeGreaterThan(0);
            expect(marks[0].textContent).toBe('Brav');
        });

        it('renders a term containing markup as text', () => {
            const tree = build();
            tree.filterText = '<img src=x onerror=alert(1)>';
            fixture.detectChanges();

            expect(fixture.nativeElement.querySelector('img')).toBeNull();
        });
    });
});
