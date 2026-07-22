/**
 * Find-in-diff matching helpers #3).
 *
 * Pulled out of diff-view.tsx so the matcher can be unit tested independently
 * of the React rendering layer.
 */

/** Case-insensitive occurrences of `query` in `text` as [start, end) ranges. */
export function findRanges(text: string, query: string): Array<[number, number]> {
  if (!query) return [];
  const ranges: Array<[number, number]> = [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    ranges.push([from, from + needle.length]);
    from = haystack.indexOf(needle, from + needle.length);
  }
  return ranges;
}
