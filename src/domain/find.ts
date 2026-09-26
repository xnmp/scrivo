// Find in text: the pure part of "find in page" for the reading view.
//
// Matching is literal and case-insensitive, like a browser's find bar. It runs a regular
// expression over the original text (rather than lower-casing it first) because case
// mapping can change a string's length ('İ'.toLowerCase() is two code units), which would
// shift every offset after it.

export interface Match {
  /** UTF-16 offsets into the searched text; `end` is exclusive. */
  readonly start: number;
  readonly end: number;
}

/** More matches than this aren't worth highlighting or counting precisely. */
export const MAX_MATCHES = 10_000;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Non-overlapping matches of `query` in `text`, in order. An empty query matches nothing. */
export function findAll(text: string, query: string, limit = MAX_MATCHES): Match[] {
  if (query === '') return [];
  const re = new RegExp(escapeRegExp(query), 'giu');
  const matches: Match[] = [];
  for (let m = re.exec(text); m !== null && matches.length < limit; m = re.exec(text)) {
    matches.push({ start: m.index, end: m.index + m[0].length });
  }
  return matches;
}

/**
 * Where `offset` falls in text made by concatenating segments that start at `starts`
 * (ascending, first 0): the segment index and the offset within it. An offset at a
 * boundary belongs to the segment that starts there.
 */
export function locate(starts: readonly number[], offset: number): { index: number; offset: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { index: lo, offset: offset - (starts[lo] ?? 0) };
}

/** The match to show first: the first one at or after `from` (e.g. the top of the view), wrapping. */
export function firstFrom(matches: readonly Match[], from: number): number {
  if (matches.length === 0) return -1;
  const i = matches.findIndex((m) => m.start >= from);
  return i === -1 ? 0 : i;
}

/** The next (or previous) match index, wrapping around. */
export function step(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}
