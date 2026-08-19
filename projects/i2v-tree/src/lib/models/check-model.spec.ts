import { I2vCheckConfig, I2vCheckModel } from './check-model';
import { TreeQuery } from './tree-query';

interface Item {
    id: string;
    children?: Item[];
    nocheck?: boolean;
}

const tree = (): Item[] => [
    {
        id: 'a',
        children: [
            { id: 'a1', children: [{ id: 'a1x' }, { id: 'a1y' }] },
            { id: 'a2' }
        ]
    },
    { id: 'b', children: [{ id: 'b1' }] },
    { id: 'c' }
];

/** Index a tree by id so specs can name items without threading references around. */
function index(items: Item[]) {
    const map = new Map<string, Item>();
    const walk = (list: Item[]) => list.forEach(i => (map.set(i.id, i), i.children && walk(i.children)));
    walk(items);
    return map;
}

function setup(items: Item[] = tree(), config: I2vCheckConfig<Item> = {}) {
    const query = TreeQuery.init(items, i => i.children, true),
        model = new I2vCheckModel<Item>({ keyOf: i => i.id, ...config });
    model.attach(() => query);
    return { model, query, items, byId: index(items) };
}

describe('I2vCheckModel', () => {
    describe('basic tri-state', () => {
        it('starts unchecked', () => {
            const { model, byId } = setup();
            expect(model.getState(byId.get('a')!)).toBe('unchecked');
            expect(model.getRootState()).toBe('unchecked');
        });

        it('checking a leaf makes its ancestors indeterminate', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a1x')!, true);

            expect(model.getState(byId.get('a1x')!)).toBe('checked');
            expect(model.getState(byId.get('a1')!)).toBe('indeterminate');
            expect(model.getState(byId.get('a')!)).toBe('indeterminate');
            expect(model.getRootState()).toBe('indeterminate');
            expect(model.getState(byId.get('a1y')!)).toBe('unchecked');
        });

        it('checking a parent checks every descendant', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a')!, true);

            for (const id of ['a', 'a1', 'a2', 'a1x', 'a1y']) {
                expect(model.isChecked(byId.get(id)!)).withContext(id).toBe(true);
            }
            expect(model.getState(byId.get('a')!)).toBe('checked');
            expect(model.isChecked(byId.get('b')!)).toBe(false);
        });

        it('unchecking one child of a checked parent leaves the parent indeterminate', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a')!, true);
            model.setChecked(byId.get('a2')!, false);

            expect(model.getState(byId.get('a')!)).toBe('indeterminate');
            expect(model.getState(byId.get('a2')!)).toBe('unchecked');
            expect(model.isChecked(byId.get('a1')!)).toBe(true);
            expect(model.isChecked(byId.get('a1x')!)).toBe(true);
        });

        it('re-checking the excluded child collapses back to a clean checked parent', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a')!, true);
            model.setChecked(byId.get('a2')!, false);
            model.setChecked(byId.get('a2')!, true);

            expect(model.getState(byId.get('a')!)).toBe('checked');
            expect(model.getSelection().excluded).toEqual([]);
        });

        it('toggle flips state', () => {
            const { model, byId } = setup();
            model.toggle(byId.get('c')!);
            expect(model.isChecked(byId.get('c')!)).toBe(true);
            model.toggle(byId.get('c')!);
            expect(model.isChecked(byId.get('c')!)).toBe(false);
        });
    });

    describe('checkAll / uncheckAll', () => {
        it('checkAll checks everything and reports a clean root state', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a1x')!, true);
            model.checkAll();

            expect(model.getRootState()).toBe('checked');
            for (const id of ['a', 'b', 'c', 'a1', 'a1x', 'b1']) {
                expect(model.isChecked(byId.get(id)!)).withContext(id).toBe(true);
            }
        });

        it('uncheckAll discards prior decisions', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a')!, true);
            model.uncheckAll();

            expect(model.getRootState()).toBe('unchecked');
            expect(model.isChecked(byId.get('a')!)).toBe(false);
            expect(model.getSelection()).toEqual({ roots: [], excluded: [] });
        });

        it('unchecking one item after checkAll leaves the rest checked', () => {
            const { model, byId } = setup();
            model.checkAll();
            model.setChecked(byId.get('b1')!, false);

            expect(model.isChecked(byId.get('b1')!)).toBe(false);
            expect(model.isChecked(byId.get('c')!)).toBe(true);
            expect(model.getState(byId.get('b')!)).toBe('indeterminate');
            expect(model.getRootState()).toBe('indeterminate');
        });
    });

    describe('lazy loading', () => {
        /**
         * The decisive case: children are not materialized until the accessor is called, and the
         * accessor records that it ran. Checking the parent must not trigger it.
         */
        function lazySetup() {
            const loaded: string[] = [],
                kids: Item[] = [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
                items: Item[] = [{ id: 'server' }, { id: 'other' }],
                query = TreeQuery.init(
                    items,
                    i => {
                        if (i.id !== 'server') {
                            return undefined;
                        }
                        loaded.push(i.id);
                        return kids;
                    },
                    /* eagerLoad */ false
                ),
                model = new I2vCheckModel<Item>({ keyOf: i => i.id });

            model.attach(() => query);

            // Materialize the top level, as the tree's own invalidateData does on load. Without
            // this nothing but the synthetic root exists yet, so even the servers are unresolvable.
            query.getRootNode().children;

            return { model, query, items, kids, loaded };
        }

        it('checking a parent with unloaded children loads nothing', () => {
            const { model, items, loaded } = lazySetup();
            model.setChecked(items[0], true);
            expect(loaded).toEqual([]);
        });

        it('children that load later already read as checked', () => {
            const { model, query, items, kids } = lazySetup();
            model.setChecked(items[0], true);

            // Force the children to materialize, as expanding the node would.
            query.findNode(items[0])!.children;

            for (const kid of kids) {
                expect(model.isChecked(kid)).withContext(kid.id).toBe(true);
            }
            expect(model.getState(items[0])).toBe('checked');
        });

        it('a descendant unchecked before its parent loaded stays unchecked afterwards', () => {
            const { model, query, items, kids } = lazySetup();
            model.setChecked(items[0], true);
            model.setChecked(kids[1], false);

            query.findNode(items[0])!.children;

            expect(model.isChecked(kids[0])).toBe(true);
            expect(model.isChecked(kids[1])).toBe(false);
            expect(model.isChecked(kids[2])).toBe(true);
            expect(model.getState(items[0])).toBe('indeterminate');
        });

        it('getCheckedItems reports only loaded items, getSelection covers the rest', () => {
            const { model, items } = lazySetup();
            model.setChecked(items[0], true);

            expect(model.getCheckedItems()).toEqual([items[0]]);
            expect(model.getSelection().roots).toEqual([items[0]]);
        });
    });

    describe('promoteParents', () => {
        it('collapses a complete set of child decisions into one parent decision', () => {
            const { model, byId } = setup(tree(), { promoteParents: true });
            model.setChecked(byId.get('a1x')!, true);
            model.setChecked(byId.get('a1y')!, true);

            expect(model.getState(byId.get('a1')!)).toBe('checked');
            expect(model.getSelection().roots.map(i => i.id)).toEqual(['a1']);
        });

        it('does not promote a partially checked parent', () => {
            const { model, byId } = setup(tree(), { promoteParents: true });
            model.setChecked(byId.get('a1x')!, true);

            expect(model.getState(byId.get('a1')!)).toBe('indeterminate');
            expect(model.getSelection().roots.map(i => i.id)).toEqual(['a1x']);
        });

        it('promotes transitively up to the highest fully checked ancestor', () => {
            const { model, byId } = setup(tree(), { promoteParents: true });
            model.setChecked(byId.get('a1x')!, true);
            model.setChecked(byId.get('a1y')!, true);
            model.setChecked(byId.get('a2')!, true);

            expect(model.getState(byId.get('a')!)).toBe('checked');
            expect(model.getSelection().roots.map(i => i.id)).toEqual(['a']);
        });
    });

    describe('canCheck (zTree nocheck)', () => {
        it('excludes uncheckable items from getCheckedItems but still cascades through them', () => {
            const items = tree();
            const { model, byId } = setup(items, { canCheck: (i: Item) => i.id !== "a1" });
            model.setChecked(byId.get('a')!, true);

            const ids = model.getCheckedItems().map(i => i.id);
            expect(ids).not.toContain('a1');
            expect(ids).toContain('a1x');
            expect(ids).toContain('a1y');
        });
    });

    describe('getSelection / setSelection', () => {
        it('round-trips roots and exclusions', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a')!, true);
            model.setChecked(byId.get('a2')!, false);
            model.setChecked(byId.get('c')!, true);

            const selection = model.getSelection();
            expect(selection.roots.map(i => i.id).sort()).toEqual(['a', 'c']);
            expect(selection.excluded.map(i => i.id)).toEqual(['a2']);

            const restored = setup();
            restored.model.setSelection(selection);

            for (const id of ['a', 'a1', 'a1x', 'c']) {
                expect(restored.model.isChecked(restored.byId.get(id)!)).withContext(id).toBe(true);
            }
            expect(restored.model.isChecked(restored.byId.get('a2')!)).toBe(false);
            expect(restored.model.getState(restored.byId.get('a')!)).toBe('indeterminate');
        });
    });

    describe('keyOf identity', () => {
        it('check state survives a reload into structurally equal items', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a')!, true);
            model.setChecked(byId.get('a2')!, false);

            // A fresh payload: equal by id, different by reference.
            const reloaded = tree(),
                freshQuery = TreeQuery.init(reloaded, i => i.children, true),
                freshById = index(reloaded);

            model.attach(() => freshQuery);
            model.rebuild();

            expect(model.isChecked(freshById.get('a1x')!)).toBe(true);
            expect(model.isChecked(freshById.get('a2')!)).toBe(false);
            expect(model.getState(freshById.get('a')!)).toBe('indeterminate');
        });
    });

    describe('events', () => {
        it('emits onCheckChanged with the source and onCheckStateChanged once', () => {
            const { model, byId } = setup();
            const changes: string[] = [];
            let stateEvents = 0;

            model.onCheckChanged.subscribe(c => changes.push(`${c.item?.id}:${c.checked}:${c.source}`));
            model.onCheckStateChanged.subscribe(() => stateEvents++);

            model.setChecked(byId.get('c')!, true, 'user');

            expect(changes).toEqual(['c:true:user']);
            expect(stateEvents).toBe(1);
        });

        it('does not emit when the state is already what was asked for', () => {
            const { model, byId } = setup();
            let events = 0;
            model.setChecked(byId.get('c')!, true);
            model.onCheckStateChanged.subscribe(() => events++);

            model.setChecked(byId.get('c')!, true);
            expect(events).toBe(0);
        });

        it('setCheckedMany emits one state event for the batch', () => {
            const { model, byId } = setup();
            let events = 0;
            model.onCheckStateChanged.subscribe(() => events++);

            model.setCheckedMany([byId.get('a2')!, byId.get('b1')!, byId.get('c')!], true);
            expect(events).toBe(1);
        });
    });

    describe('bookkeeping', () => {
        it('clear leaves no counter drift', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a1x')!, true);
            model.setChecked(byId.get('b1')!, true);
            model.clear();

            expect(model.getRootState()).toBe('unchecked');
            for (const id of ['a', 'a1', 'b']) {
                expect(model.getState(byId.get(id)!)).withContext(id).toBe('unchecked');
            }
        });

        it('never stores a decision that duplicates what would be inherited', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a')!, true);
            model.setChecked(byId.get('a1')!, true); // already inherited -- must not add a decision

            expect(model.getSelection().roots.map(i => i.id)).toEqual(['a']);
        });

        it('checking a parent discards decisions beneath it', () => {
            const { model, byId } = setup();
            model.setChecked(byId.get('a1x')!, true);
            model.setChecked(byId.get('a2')!, true);
            model.setChecked(byId.get('a')!, true);

            expect(model.getSelection().roots.map(i => i.id)).toEqual(['a']);
            expect(model.getState(byId.get('a')!)).toBe('checked');
        });
    });

    describe('correctness against a naive implementation', () => {
        /** Ground truth: read state by walking up to the nearest decision, with no counters. */
        function naiveState(decisions: Map<string, boolean>, byId: Map<string, Item>, parentOf: Map<string, string>, id: string) {
            const descendants = (root: string): string[] => {
                const kids = byId.get(root)!.children ?? [];
                return kids.flatMap(k => [k.id, ...descendants(k.id)]);
            };
            const inherited = (from: string): boolean => {
                let cur: string | undefined = from;
                while (cur) {
                    const d = decisions.get(cur);
                    if (d !== undefined) {
                        return d;
                    }
                    cur = parentOf.get(cur);
                }
                return false;
            };

            const below = descendants(id);
            const self = inherited(id);
            return below.some(d => inherited(d) !== self) ? 'indeterminate' : self ? 'checked' : 'unchecked';
        }

        it('agrees with a full recompute over 500 random operations', () => {
            const items = tree(),
                { model, byId } = setup(items),
                ids = [...byId.keys()],
                parentOf = new Map<string, string>();

            const linkParents = (list: Item[], parent?: string) =>
                list.forEach(i => (parent && parentOf.set(i.id, parent), i.children && linkParents(i.children, i.id)));
            linkParents(items);

            // Mirror of the model's decisions, maintained by the same normalization rules.
            const expected = new Map<string, boolean>();

            // Deterministic PRNG so a failure is reproducible.
            let seed = 12345;
            const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

            for (let n = 0; n < 500; n++) {
                const id = ids[Math.floor(rand() * ids.length)],
                    checked = rand() > 0.5;

                model.setChecked(byId.get(id)!, checked);

                // Apply the same semantics to the mirror: decide for the subtree, then normalize.
                const descendants = (root: string): string[] => {
                    const kids = byId.get(root)!.children ?? [];
                    return kids.flatMap(k => [k.id, ...descendants(k.id)]);
                };
                descendants(id).forEach(d => expected.delete(d));
                expected.set(id, checked);

                for (const check of ids) {
                    expect(model.getState(byId.get(check)!))
                        .withContext(`op ${n}: set ${id}=${checked}, reading ${check}`)
                        .toBe(naiveState(expected, byId, parentOf, check) as any);
                }
            }
        });
    });

    describe('performance', () => {
        it('checkAll is O(1) on a large tree', () => {
            const wide: Item[] = Array.from({ length: 200 }, (_, s) => ({
                id: `s${s}`,
                children: Array.from({ length: 500 }, (_, c) => ({ id: `s${s}c${c}` }))
            }));
            const { model } = setup(wide);

            const start = performance.now();
            model.checkAll();
            const elapsed = performance.now() - start;

            expect(elapsed).toBeLessThan(5);
            expect(model.isChecked(wide[199].children![499])).toBe(true);
        });
    });
});
