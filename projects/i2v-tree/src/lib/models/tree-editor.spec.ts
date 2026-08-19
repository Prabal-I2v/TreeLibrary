import { I2vTreeEditor } from './tree-editor';
import { TreeQuery } from './tree-query';

interface Row {
    id: string;
    children?: Row[];
}

function setup() {
    const roots: Row[] = [
        { id: 'a', children: [{ id: 'a1' }, { id: 'a2' }] },
        { id: 'b', children: [{ id: 'b1' }] },
        { id: 'c' }
    ];
    const editor = new I2vTreeEditor<Row>(
        { childAccessor: r => r.children, setChildren: (r, c) => (r.children = c) },
        () => roots
    );
    // Rebuilt on demand: the query caches nodes, so edits need a fresh walk to be visible.
    const query = () => TreeQuery.init(roots, r => r.children, true);
    const find = (id: string): Row => {
        const hit = (list: Row[]): Row | undefined =>
            list.reduce<Row | undefined>((acc, r) => acc ?? (r.id === id ? r : r.children && hit(r.children)), undefined);
        return hit(roots)!;
    };
    return { roots, editor, query, find };
}

describe('I2vTreeEditor', () => {
    describe('insert', () => {
        it('appends to a parent', () => {
            const { editor, find } = setup();
            editor.insert(find('a'), [{ id: 'a3' }]);
            expect(find('a').children!.map(r => r.id)).toEqual(['a1', 'a2', 'a3']);
        });

        it('inserts at an index', () => {
            const { editor, find } = setup();
            editor.insert(find('a'), [{ id: 'a0' }], 0);
            expect(find('a').children!.map(r => r.id)).toEqual(['a0', 'a1', 'a2']);
        });

        it('inserts at the root when no parent is given', () => {
            const { editor, roots } = setup();
            editor.insert(undefined, [{ id: 'd' }]);
            expect(roots.map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
        });

        it('creates a children array for a childless parent', () => {
            const { editor, find } = setup();
            expect(editor.insert(find('c'), [{ id: 'c1' }])).toBe(true);
            expect(find('c').children!.map(r => r.id)).toEqual(['c1']);
        });

        it('clamps an out-of-range index rather than leaving holes', () => {
            const { editor, find } = setup();
            editor.insert(find('a'), [{ id: 'zz' }], 99);
            expect(find('a').children!.map(r => r.id)).toEqual(['a1', 'a2', 'zz']);
        });
    });

    describe('remove', () => {
        it('removes a child and reports its parent', () => {
            const { editor, query, find } = setup();
            const result = editor.remove(find('a1'), query());

            expect(result.removed).toBe(true);
            expect(result.parent!.id).toBe('a');
            expect(find('a').children!.map(r => r.id)).toEqual(['a2']);
        });

        it('removes a root item', () => {
            const { editor, query, roots, find } = setup();
            const result = editor.remove(find('c'), query());

            expect(result.removed).toBe(true);
            expect(result.parent).toBeUndefined();
            expect(roots.map(r => r.id)).toEqual(['a', 'b']);
        });

        it('reports failure for an item that is not in the tree', () => {
            const { editor, query } = setup();
            expect(editor.remove({ id: 'ghost' }, query()).removed).toBe(false);
        });
    });

    describe('removeChildren', () => {
        it('empties a parent without detaching the array', () => {
            const { editor, find } = setup();
            const before = find('a').children;
            editor.removeChildren(find('a'));

            expect(find('a').children).toBe(before);
            expect(find('a').children!.length).toBe(0);
        });
    });

    describe('move', () => {
        it('reparents an item and reports both parents', () => {
            const { editor, query, find } = setup();
            const result = editor.move(find('a1'), find('b'), undefined, query());

            expect(result!.from!.id).toBe('a');
            expect(result!.to!.id).toBe('b');
            expect(find('b').children!.map(r => r.id)).toEqual(['b1', 'a1']);
            expect(find('a').children!.map(r => r.id)).toEqual(['a2']);
        });

        it('moves to the root', () => {
            const { editor, query, roots, find } = setup();
            editor.move(find('a1'), undefined, 0, query());

            expect(roots.map(r => r.id)).toEqual(['a1', 'a', 'b', 'c']);
        });

        it('corrects the index when reordering downward inside one parent', () => {
            const { editor, query, find } = setup();
            // Move a1 to sit after a2. Without index correction the removal shifts a2 left and a1
            // lands back where it started.
            editor.move(find('a1'), find('a'), 2, query());

            expect(find('a').children!.map(r => r.id)).toEqual(['a2', 'a1']);
        });

        it('reorders upward inside one parent', () => {
            const { editor, query, find } = setup();
            editor.move(find('a2'), find('a'), 0, query());

            expect(find('a').children!.map(r => r.id)).toEqual(['a2', 'a1']);
        });

        it('refuses to move an item into its own subtree', () => {
            const { editor, query, find } = setup();
            expect(editor.move(find('a'), find('a1'), undefined, query())).toBeUndefined();
            expect(find('a').children!.map(r => r.id)).toEqual(['a1', 'a2']);
        });

        it('refuses to move an item onto itself', () => {
            const { editor, query, find } = setup();
            expect(editor.move(find('a'), find('a'), undefined, query())).toBeUndefined();
        });
    });
});
