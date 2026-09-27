// Find in the reading view: matches over the article's text, shown with the CSS Custom
// Highlight API so the document's DOM is never modified. Where that API is missing, the
// current match is selected instead.
import { type Match, MAX_MATCHES, findAll, firstFrom, locate, step } from '../domain/find';

export interface FindState {
  readonly count: number;
  /** Index of the current match, -1 when there is none. */
  readonly current: number;
  /** True when there were more than MAX_MATCHES matches (count is then a lower bound). */
  readonly capped: boolean;
}

export interface Finder {
  /** Find `query` and show the first match at or below the top of the view. */
  search(query: string): Promise<FindState | null>;
  /** Move to the next (1) or previous (-1) match. */
  next(direction: 1 | -1): FindState;
  /** Remove all highlights. */
  clear(): void;
}

/** What the finder needs from the viewer. */
export interface FindSource {
  /** Resolves when every block of the current document is in the page. */
  settled(): Promise<void>;
  /** Bumped whenever indexed text nodes may have changed. */
  textVersion(): number;
}

const HIGHLIGHT_ALL = 'scrivo-find';
const HIGHLIGHT_CURRENT = 'scrivo-find-current';

interface TextIndex {
  readonly version: number;
  readonly nodes: Text[];
  readonly starts: number[];
  readonly text: string;
}

function indexText(root: HTMLElement, version: number): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    nodes.push(text);
    starts.push(offset);
    parts.push(text.data);
    offset += text.data.length;
  }
  return { version, nodes, starts, text: parts.join('') };
}

export function createFinder(scroller: HTMLElement, article: HTMLElement, source: FindSource): Finder {
  const highlights = typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;
  let index: TextIndex | null = null;
  let matches: Match[] = [];
  let ranges: Range[] = [];
  let current = -1;
  let capped = false;
  let request = 0;

  const state = (): FindState => ({ count: matches.length, current, capped });

  const rangeOf = (m: Match, idx: TextIndex): Range => {
    const start = locate(idx.starts, m.start);
    // The last character's node, so the end never lands at the start of the next node.
    const last = locate(idx.starts, m.end - 1);
    const range = document.createRange();
    range.setStart(idx.nodes[start.index]!, start.offset);
    range.setEnd(idx.nodes[last.index]!, last.offset + 1);
    return range;
  };

  const boxOf = (range: Range): DOMRect => {
    // WebKit reports a zero rect for text inside an offscreen content-visibility
    // segment. Lay out only the segment(s) containing this match for the query.
    const start = range.startContainer.parentElement?.closest<HTMLElement>('.code-segment');
    const end = range.endContainer.parentElement?.closest<HTMLElement>('.code-segment');
    const segments = start === end ? (start ? [start] : []) : [start, end].filter((el): el is HTMLElement => !!el);
    const previous = segments.map((segment) => segment.style.contentVisibility);
    for (const segment of segments) segment.style.contentVisibility = 'visible';
    try {
      return range.getBoundingClientRect();
    } finally {
      segments.forEach((segment, i) => { segment.style.contentVisibility = previous[i]!; });
    }
  };

  /** Index of the first match whose box reaches below the top of the view. */
  const firstVisible = (): number => {
    const top = scroller.getBoundingClientRect().top;
    let lo = 0;
    let hi = ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (boxOf(ranges[mid]!).bottom <= top) lo = mid + 1;
      else hi = mid;
    }
    return lo < ranges.length ? lo : 0;
  };

  const reveal = (range: Range) => {
    const box = boxOf(range);
    const view = scroller.getBoundingClientRect();
    if (box.top < view.top || box.bottom > view.bottom) {
      scroller.scrollTop += box.top - view.top - scroller.clientHeight / 3;
    }
    const pre = range.startContainer.parentElement?.closest('pre');
    if (pre && pre.scrollWidth > pre.clientWidth) {
      const clip = pre.getBoundingClientRect();
      if (box.left < clip.left) pre.scrollLeft += box.left - clip.left - 8;
      else if (box.right > clip.right) pre.scrollLeft += box.right - clip.right + 8;
    }
  };

  const showCurrent = () => {
    const range = ranges[current];
    if (highlights) {
      if (range) highlights.set(HIGHLIGHT_CURRENT, new Highlight(range));
      else highlights.delete(HIGHLIGHT_CURRENT);
    } else if (range) {
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (range) reveal(range);
  };

  const clearMatches = () => {
    highlights?.delete(HIGHLIGHT_ALL);
    highlights?.delete(HIGHLIGHT_CURRENT);
    if (!highlights && ranges.length > 0) getSelection()?.removeAllRanges();
    matches = [];
    ranges = [];
    current = -1;
    capped = false;
  };

  const clear = () => {
    request++;
    clearMatches();
  };

  return {
    async search(query) {
      const id = ++request;
      clearMatches();
      if (query === '') return state();
      await source.settled();
      if (id !== request) return null;
      const version = source.textVersion();
      if (index?.version !== version) index = indexText(article, version);
      const idx = index;
      matches = findAll(idx.text, query, MAX_MATCHES + 1);
      capped = matches.length > MAX_MATCHES;
      if (capped) matches = matches.slice(0, MAX_MATCHES);
      ranges = matches.map((m) => rangeOf(m, idx));
      highlights?.set(HIGHLIGHT_ALL, new Highlight(...ranges));
      current = ranges.length > 0 ? firstFrom(matches, matches[firstVisible()]!.start) : -1;
      showCurrent();
      return state();
    },
    next(direction) {
      current = step(current, matches.length, direction);
      showCurrent();
      return state();
    },
    clear,
  };
}
