import { I2vSelectionModel } from './selection-model';

describe('I2vSelectionModel', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'];

    /** The tree supplies ranges, since only it knows the current visual order. */
    const rangeBetween = (from: string, to: string) => {
        const start = rows.indexOf(from),
            end = rows.indexOf(to);
        return rows.slice(Math.min(start, end), Math.max(start, end) + 1);
    };

    describe('single mode', () => {
        it('keeps at most one item, ignoring modifiers', () => {
            const model = new I2vSelectionModel<string>('single');
            model.select('a');
            model.select('b', { ctrl: true });

            expect(model.getSelected()).toEqual(['b']);
        });
    });

    describe('multiple mode', () => {
        it('plain click replaces the selection', () => {
            const model = new I2vSelectionModel<string>('multiple');
            model.select('a');
            model.select('b', { ctrl: true });
            model.select('c');

            expect(model.getSelected()).toEqual(['c']);
        });

        it('ctrl toggles individual items', () => {
            const model = new I2vSelectionModel<string>('multiple');
            model.select('a');
            model.select('c', { ctrl: true });
            expect(model.getSelected().sort()).toEqual(['a', 'c']);

            model.select('a', { ctrl: true });
            expect(model.getSelected()).toEqual(['c']);
        });

        it('shift selects the range from the anchor', () => {
            const model = new I2vSelectionModel<string>('multiple');
            model.select('b');
            model.select('d', { shift: true }, rangeBetween('b', 'd'));

            expect(model.getSelected()).toEqual(['b', 'c', 'd']);
        });

        it('shift extends backwards from the anchor', () => {
            const model = new I2vSelectionModel<string>('multiple');
            model.select('d');
            model.select('b', { shift: true }, rangeBetween('d', 'b'));

            expect(model.getSelected()).toEqual(['b', 'c', 'd']);
        });

        it('successive shift clicks resize one range rather than accumulating', () => {
            const model = new I2vSelectionModel<string>('multiple');
            model.select('a');
            model.select('d', { shift: true }, rangeBetween('a', 'd'));
            model.select('b', { shift: true }, rangeBetween('a', 'b'));

            expect(model.getSelected()).toEqual(['a', 'b']);
            expect(model.getAnchor()).toBe('a');
        });
    });

    describe('none mode', () => {
        it('refuses selection and clears what was there', () => {
            const model = new I2vSelectionModel<string>('multiple');
            model.select('a');
            model.setMode('none');

            expect(model.getSelected()).toEqual([]);
            model.select('b');
            expect(model.getSelected()).toEqual([]);
        });
    });

    describe('mode changes', () => {
        it('collapses a multi-selection to the anchor when narrowing to single', () => {
            const model = new I2vSelectionModel<string>('multiple');
            model.select('a');
            model.select('c', { ctrl: true });
            model.setMode('single');

            expect(model.getSelected()).toEqual(['c']);
        });
    });

    describe('events', () => {
        it('emits the full selection on change', () => {
            const model = new I2vSelectionModel<string>('multiple');
            const emissions: string[][] = [];
            model.onSelectionChanged.subscribe(s => emissions.push(s));

            model.select('a');
            model.select('b', { ctrl: true });

            expect(emissions).toEqual([['a'], ['a', 'b']]);
        });

        it('does not emit when the selection is unchanged', () => {
            const model = new I2vSelectionModel<string>('multiple');
            model.select('a');

            let events = 0;
            model.onSelectionChanged.subscribe(() => events++);
            model.select('a');

            expect(events).toBe(0);
        });
    });
});
