/**
 * A matched span within a label, as [start, end) offsets into the original string.
 */
export type I2vMatchRange = [number, number];

/**
 * Text matching helpers for tree filtering and match highlighting.
 *
 * Deliberately string-in, data-out: zTree's search wrote `oldname` and `searchParam` onto the
 * caller's node objects and rendered matches through `innerHTML` with `nameIsHTML`, which both
 * mutated consumer data and opened an injection hole. Nothing here touches the items, and match
 * output is offsets the template renders as separate text nodes.
 */
export class I2vTreeSearch {
    /**
     * Build a case-insensitive "contains" predicate over one or more fields.
     * @param term the search text
     * @param getFields returns the strings to test for an item
     */
    public static buildPredicate<T>(term: string, getFields: (item: T) => (string | undefined)[]): (item: T) => boolean {
        const needle = term.trim().toLowerCase();

        if (!needle) {
            return () => true;
        }

        return (item: T) => getFields(item).some(field => !!field && field.toLowerCase().indexOf(needle) >= 0);
    }

    /**
     * Locate every occurrence of `term` within `text`.
     *
     * Returns offsets rather than marked-up text so the caller can render matches as elements. An
     * empty term yields no ranges, so a blank search highlights nothing rather than everything.
     */
    public static getMatchRanges(text: string, term: string): I2vMatchRange[] {
        const needle = term.trim().toLowerCase();

        if (!needle || !text) {
            return [];
        }

        const haystack = text.toLowerCase(),
            ranges: I2vMatchRange[] = [];

        let from = 0,
            at = haystack.indexOf(needle, from);

        while (at >= 0) {
            ranges.push([at, at + needle.length]);
            from = at + needle.length;
            at = haystack.indexOf(needle, from);
        }

        return ranges;
    }

    /**
     * Split a label into alternating unmatched and matched segments, ready to render.
     *
     * Always covers the whole string, so joining every `text` reproduces the input exactly -- which
     * is what keeps highlighting from silently dropping characters.
     */
    public static getSegments(text: string, term: string): { text: string; match: boolean }[] {
        const ranges = I2vTreeSearch.getMatchRanges(text, term);

        if (!ranges.length) {
            return text ? [{ text, match: false }] : [];
        }

        const segments: { text: string; match: boolean }[] = [];
        let cursor = 0;

        for (const [start, end] of ranges) {
            if (start > cursor) {
                segments.push({ text: text.slice(cursor, start), match: false });
            }
            segments.push({ text: text.slice(start, end), match: true });
            cursor = end;
        }

        if (cursor < text.length) {
            segments.push({ text: text.slice(cursor), match: false });
        }

        return segments;
    }
}
