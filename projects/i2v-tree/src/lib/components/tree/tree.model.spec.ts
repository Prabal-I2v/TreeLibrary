import { I2vTree } from './tree.model';
import { I2vTreeConfig } from './tree.config';

interface Item {
    id: number;
    children?: Item[];
}

describe('I2vTree', () => {
    const createVt = (data: Item[]) => {
            const result = new I2vTree<Item>({ childAccessor: (item: Item) => item.children });
            result.load(data);
            return result;
        },
        navigate = (vt: I2vTree<Item>, ...directions: string[]) => {
            const result: (number | undefined)[] = [];
            for (const dir of directions) {
                vt.navigate(dir);
                const highlighted = vt.getHighlightedItem();
                result.push(highlighted ? highlighted.id : undefined);
            }
            return result;
        },
        dummyData = [
            {
                id: 1,
                children: [
                    {
                        id: 2
                    }
                ]
            },
            {
                id: 3
            },
            {
                id: 4,
                children: [
                    {
                        id: 5,
                        children: [
                            {
                                id: 6
                            }
                        ]
                    }
                ]
            }
        ];

    it('can navigate up', () => {
        const vt = createVt(dummyData);

        expect(navigate(vt, 'Up', 'Up', 'Up', 'Up')).toEqual([4, 3, 1, undefined]);

        vt.expandAll();
        expect(navigate(vt, 'Up', 'Up', 'Up', 'Up', 'Up', 'Up', 'Up')).toEqual([6, 5, 4, 3, 2, 1, undefined]);
    });

    it('can navigate down', () => {
        const vt = createVt(dummyData);

        expect(navigate(vt, 'Down', 'Down', 'Down', 'Down')).toEqual([1, 3, 4, undefined]);

        vt.expandAll();
        expect(navigate(vt, 'Down', 'Down', 'Down', 'Down', 'Down', 'Down', 'Down')).toEqual([1, 2, 3, 4, 5, 6, undefined]);
    });

    it('can navigate right', () => {
        const vt = createVt(dummyData),
            commands = ['Down', 'Right', 'Right', 'Right', 'Right', 'Right', 'Right', 'Right', 'Right', 'Right'],
            highlightSequence = [1, 1, 2, 3, 4, 4, 5, 5, 6, undefined];

        expect(navigate(vt, ...commands)).toEqual(highlightSequence);
    });

    it('can navigate left', () => {
        const vt = createVt(dummyData),
            commands = ['Up', 'Left', 'Left', 'Left', 'Left', 'Up', 'Up', 'Left', 'Left', 'Left'],
            highlightSequence = [6, 5, 5, 4, 4, 3, 2, 1, 1, undefined];

        vt.expandAll();
        expect(navigate(vt, ...commands)).toEqual(highlightSequence);
    });
});

describe('I2vTree checks integration', () => {
    interface Row {
        id: string;
        children?: Row[];
    }

    const data = (): Row[] => [{ id: 'a', children: [{ id: 'a1' }, { id: 'a2' }] }, { id: 'b' }];

    function build(config: Partial<I2vTreeConfig<Row>> = {}) {
        const model = new I2vTree<Row>({ childAccessor: r => r.children, keyOf: r => r.id, ...config });
        model.load(data());
        return model;
    }

    it('exposes a check model attached to the tree', () => {
        const model = build(),
            a = model.items[0].item;

        model.checks.setChecked(a, true);

        expect(model.checks.getState(a)).toBe('checked');
        expect(model.checks.getCheckedItems().map(i => i.id).sort()).toEqual(['a', 'a1', 'a2']);
    });

    it('keeps check state across a reload of equal-but-new items', () => {
        const model = build();
        model.checks.setChecked(model.items[0].item, true);

        model.load(data());

        expect(model.checks.isChecked(model.items[0].item)).toBe(true);
    });

    it('promotes parents when eagerly loaded', () => {
        const model = build({ lazyLoad: false });
        model.expandAll();

        const a1 = model.items.find(n => n.item.id === 'a1')!.item,
            a2 = model.items.find(n => n.item.id === 'a2')!.item;

        model.checks.setChecked(a1, true);
        model.checks.setChecked(a2, true);

        expect(model.checks.getState(model.items[0].item)).toBe('checked');
    });
});
