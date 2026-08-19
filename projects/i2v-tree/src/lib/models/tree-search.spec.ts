import { I2vTreeSearch } from './tree-search';

describe('I2vTreeSearch', () => {
    describe('buildPredicate', () => {
        interface Row {
            name: string;
            ip?: string;
        }
        const rows: Row[] = [{ name: 'Lobby Camera', ip: '10.0.0.1' }, { name: 'Gate', ip: '10.0.0.2' }];
        const fields = (r: Row) => [r.name, r.ip];

        it('matches case-insensitively across fields', () => {
            const match = I2vTreeSearch.buildPredicate<Row>('lobby', fields);
            expect(match(rows[0])).toBe(true);
            expect(match(rows[1])).toBe(false);
        });

        it('matches a secondary field', () => {
            const match = I2vTreeSearch.buildPredicate<Row>('0.0.2', fields);
            expect(match(rows[1])).toBe(true);
        });

        it('matches everything for a blank or whitespace term', () => {
            for (const term of ['', '   ']) {
                const match = I2vTreeSearch.buildPredicate<Row>(term, fields);
                expect(rows.every(match)).withContext(JSON.stringify(term)).toBe(true);
            }
        });

        it('tolerates undefined fields', () => {
            const match = I2vTreeSearch.buildPredicate<Row>('gate', r => [r.name, undefined]);
            expect(match(rows[1])).toBe(true);
        });
    });

    describe('getMatchRanges', () => {
        it('finds every occurrence', () => {
            expect(I2vTreeSearch.getMatchRanges('aXaXa', 'a')).toEqual([[0, 1], [2, 3], [4, 5]]);
        });

        it('is case insensitive but reports offsets into the original', () => {
            expect(I2vTreeSearch.getMatchRanges('Lobby Camera', 'CAM')).toEqual([[6, 9]]);
        });

        it('returns nothing for a blank term, so a cleared box highlights nothing', () => {
            expect(I2vTreeSearch.getMatchRanges('anything', '')).toEqual([]);
        });

        it('does not loop forever on overlapping candidates', () => {
            expect(I2vTreeSearch.getMatchRanges('aaaa', 'aa')).toEqual([[0, 2], [2, 4]]);
        });
    });

    describe('getSegments', () => {
        it('splits into alternating unmatched and matched parts', () => {
            expect(I2vTreeSearch.getSegments('Lobby Camera', 'cam')).toEqual([
                { text: 'Lobby ', match: false },
                { text: 'Cam', match: true },
                { text: 'era', match: false }
            ]);
        });

        it('handles a match at the very start and end', () => {
            expect(I2vTreeSearch.getSegments('abc', 'abc')).toEqual([{ text: 'abc', match: true }]);
        });

        it('always reproduces the original text when joined', () => {
            const text = 'Camera 12 / Camera 13';
            for (const term of ['camera', '1', 'zzz', '']) {
                const joined = I2vTreeSearch.getSegments(text, term)
                    .map(s => s.text)
                    .join('');
                expect(joined).withContext(term).toBe(text);
            }
        });

        it('returns a single unmatched segment when nothing matches', () => {
            expect(I2vTreeSearch.getSegments('Gate', 'zzz')).toEqual([{ text: 'Gate', match: false }]);
        });
    });
});
