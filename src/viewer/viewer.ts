// DOM implementation of the reading view (ViewerPort).
//
// The backend's HTML is inserted as-is: the renderer guarantees it contains no markup
// taken from the document (see ViewDocument). Every block element carries `data-line`,
// its 1-based source line, which is how scroll positions carry over to the editor.
//
// Long documents are shown progressively: the first trusted HTML chunk is parsed
// into an inert template, laid out and painted, then later chunks are parsed and
// appended in idle time slices. Laying out a 20,000-line document in one go takes
// about half a second in WebKit. Whole-block content visibility was slower;
// exceptionally tall code blocks use smaller contained segments.
import type { ViewDocument } from '../app/ports';
import type { Position, ViewerPort } from '../app/workspace';

export interface Viewer extends ViewerPort {
  focus(): void;
  /** Resolves once the whole current document is in the page. A signal prioritizes insertion until completion or abort. */
  settled(interactive?: AbortSignal): Promise<void>;
  /** Insert every block still pending, now. */
  loadAll(): void;
  /** Stop insertion when the reading surface is hidden. A later show() starts fresh. */
  suspend(): void;
  /** Changes whenever the page starts showing different content. */
  version(): number;
  /** Changes when text nodes are replaced without changing the document. */
  textVersion(): number;
  invalidateTextNodes(): void;
  /** Called after each show() has put its content in the page. */
  onShown(listener: (doc: ViewDocument) => void): void;
}

/** Time budget per idle slice for appending blocks. */
const SLICE_MS = 12;
/** Bound required insertion work when the browser reports no idle time. */
const BACKGROUND_TIMEOUT_MS = 250;
const INTERACTIVE_TIMEOUT_MS = 25;
/** Blocks appended per step when filling the first screen. */
const FIRST_SCREEN_STEP = 24;
const LARGE_CODE_LENGTH = 1_000_000;
const CODE_SEGMENT_LINES = 250;
const MAX_UNICODE_LINES_TO_MEASURE = 512;
const MAX_UNICODE_TEXT_TO_MEASURE = 200_000;
const MAX_UNICODE_LINE_LENGTH = 10_000;

interface CodeWidth {
  readonly asciiColumns: number;
  readonly unicodeLines: ReadonlySet<string>;
}

/** Fast width input for ASCII lines; retain a bounded set of Unicode lines for canvas measurement. */
function codeWidth(text: string, tabSize: number): CodeWidth | null {
  let column = 0;
  let widest = 0;
  let lineStart = 0;
  let hasUnicode = false;
  let uniqueUnicodeLength = 0;
  const unicodeLines = new Set<string>();
  const finishLine = (end: number): boolean => {
    if (hasUnicode) {
      // Very wide Unicode runs lose subpixel precision in browser shaping;
      // retain their native DOM width instead of estimating a contained span.
      if (end - lineStart > MAX_UNICODE_LINE_LENGTH) return false;
      const line = text.slice(lineStart, end);
      if (!unicodeLines.has(line)) {
        unicodeLines.add(line);
        uniqueUnicodeLength += line.length;
        if (unicodeLines.size > MAX_UNICODE_LINES_TO_MEASURE
          || uniqueUnicodeLength > MAX_UNICODE_TEXT_TO_MEASURE) return false;
      }
    } else {
      widest = Math.max(widest, column);
    }
    column = 0;
    lineStart = end + 1;
    hasUnicode = false;
    return true;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    if (char === 10) {
      if (!finishLine(i)) return null;
    } else if (char === 9) {
      column += tabSize - column % tabSize;
    } else if (char >= 32 && char <= 126) {
      column++;
    } else if (char >= 128 && char !== 0x2028 && char !== 0x2029 && char !== 0x0085) {
      hasUnicode = true;
    } else {
      return null;
    }
  }
  if (!finishLine(text.length)) return null;
  return { asciiColumns: widest, unicodeLines };
}

/** Bound layout work for a very tall code block while keeping its full text in the DOM. */
function segmentLargeCodeBlock(block: Node): void {
  if (!(block instanceof HTMLPreElement) || typeof CSS === 'undefined'
    || typeof CSS.supports !== 'function'
    || !CSS.supports('content-visibility', 'auto')
    || !CSS.supports('contain-intrinsic-height', 'auto 100px')) return;
  const code = block.firstElementChild;
  if (!(code instanceof HTMLElement) || code.tagName !== 'CODE'
    || [...code.childNodes].some((node) => !(node instanceof Text))) return;
  // WebKit splits very long parsed text into several Text nodes; join them before
  // segmenting while preserving the exact bytes exposed through textContent.
  const text = code.textContent ?? '';
  if (text.length < LARGE_CODE_LENGTH) return;
  const style = getComputedStyle(code);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || style.whiteSpace !== 'pre'
    || (style.letterSpacing !== 'normal' && style.letterSpacing !== '0px')) return;
  const tabSize = Number(style.tabSize);
  if (!Number.isInteger(tabSize) || tabSize <= 0 || tabSize > 256) return;
  const width = codeWidth(text, tabSize);
  if (width === null) return;
  let minWidth = `${width.asciiColumns}ch`;
  if (width.unicodeLines.size > 0) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if (!context.font.includes(style.fontSize)) return;
    const tabWidth = context.measureText(' '.repeat(tabSize)).width;
    const halfCh = context.measureText('0').width / 2;
    if (!Number.isFinite(tabWidth) || tabWidth <= 0 || !Number.isFinite(halfCh)) return;
    let widestUnicode = 0;
    for (const line of width.unicodeLines) {
      const parts = line.split('\t');
      let advance = 0;
      for (let i = 0; i < parts.length; i++) {
        advance += context.measureText(parts[i]!).width;
        // CSS Text skips a stop if the tab would advance less than 0.5ch.
        // One extra pixel absorbs Canvas/DOM subpixel rounding at that boundary.
        if (i < parts.length - 1) advance = Math.ceil((advance + halfCh + 1) / tabWidth) * tabWidth;
      }
      widestUnicode = Math.max(widestUnicode, advance);
    }
    // Allow for subpixel differences between Canvas and DOM text shaping.
    minWidth = `max(${minWidth}, ${Math.ceil(widestUnicode + 4)}px)`;
  }
  const segments = document.createDocumentFragment();
  let start = 0;
  while (start < text.length) {
    let end = start;
    let lines = 0;
    while (lines < CODE_SEGMENT_LINES && end < text.length) {
      const newline = text.indexOf('\n', end);
      if (newline < 0) { end = text.length; break; }
      end = newline + 1;
      lines++;
    }
    if (end === text.length && start === 0) return; // one huge line is not helped
    if (text[end - 1] !== '\n') lines++;
    const segment = document.createElement('span');
    segment.className = 'code-segment';
    segment.style.containIntrinsicHeight = `auto ${Math.max(1, lines) * lineHeight}px`;
    segment.textContent = text.slice(start, end);
    segments.append(segment);
    start = end;
  }
  code.classList.add('segmented-code');
  code.style.minWidth = minWidth;
  code.replaceChildren(segments);
}

/**
 * Math glyphs need an OpenType MATH font. Loaded before math is laid out, the layout
 * uses it directly instead of first going through per-glyph system font fallback
 * (measured: ~40% of first-layout time for a math-heavy page).
 */
function mathFontReady(html: string): Promise<unknown> {
  if (!html.includes('<math')) return Promise.resolve();
  const loaded = document.fonts.load('1em "Scrivo Math"').catch(() => undefined);
  const giveUp = new Promise((resolve) => setTimeout(resolve, 300));
  return Promise.race([loaded, giveUp]);
}

/**
 * `scroller` scrolls; `article` receives the document. `onLink` gets the raw `href` of
 * a clicked link: the page itself never navigates.
 */
export function createViewer(
  scroller: HTMLElement,
  article: HTMLElement,
  onLink: (href: string) => void,
  trace: (label: string) => void = () => undefined,
): Viewer {
  scroller.tabIndex = -1; // focusable, so arrow keys and Page Up/Down scroll it

  const linkFrom = (event: Event): HTMLAnchorElement | null => {
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    return target && article.contains(target) ? target : null;
  };
  article.addEventListener('click', (event) => {
    const link = linkFrom(event);
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (href !== null && event.button === 0) onLink(href);
  });
  // Middle-click would otherwise ask the webview to open a new window.
  article.addEventListener('auxclick', (event) => {
    if (linkFrom(event)) event.preventDefault();
  });

  /** Blocks parsed but not yet in the page. */
  let pending: DocumentFragment | null = null;
  let pendingHtml = '';
  let chunkEnds: readonly number[] = [];
  let nextChunk = 0;
  /** Bumped by every show(), so an older document stops appending. */
  let generation = 0;
  /** Bumped when content is actually replaced (after show()'s awaits). */
  let contentVersion = 0;
  let textRevision = 0;
  const shownListeners: Array<(doc: ViewDocument) => void> = [];
  let settledWaiters: Array<{ resolve: () => void; signal?: AbortSignal; abort?: () => void }> = [];
  let interactiveCompletion = false;
  let rescheduleBackground: (() => void) | null = null;
  let cancelBackground: (() => void) | null = null;

  const resolveSettledWaiters = () => {
    settledWaiters.forEach(({ resolve, signal, abort }) => {
      if (signal && abort) signal.removeEventListener('abort', abort);
      resolve();
    });
    settledWaiters = [];
  };

  const appendBlocks = (count: number, maxChunkParses = Infinity, shouldYield: () => boolean = () => false): number => {
    let parsedChunks = 0;
    let appended = 0;
    for (let i = 0; i < count && pending; i++) {
      if (i > 0 && shouldYield()) break;
      while (!pending.firstChild && nextChunk < chunkEnds.length) {
        if (parsedChunks >= maxChunkParses) return appended;
        const template = document.createElement('template');
        template.innerHTML = pendingHtml.slice(chunkEnds[nextChunk - 1]!, chunkEnds[nextChunk]!);
        pending.append(template.content);
        nextChunk++;
        parsedChunks++;
      }
      if (!pending.firstChild) break;
      const block = pending.firstChild;
      article.appendChild(block);
      segmentLargeCodeBlock(block);
      appended++;
    }
    if (pending && !pending.firstChild && nextChunk === chunkEnds.length) {
      pending = null;
      pendingHtml = '';
      interactiveCompletion = false;
      rescheduleBackground = null;
      cancelBackground = null;
      resolveSettledWaiters();
    }
    return appended;
  };

  /** Append blocks until `done()` holds or the document is complete. */
  const appendUntil = (done: () => boolean) => {
    while (pending && !done()) appendBlocks(FIRST_SCREEN_STEP);
  };

  const appendInBackground = (gen: number) => {
    let perBlock = 0.05; // ms per block, refined as we go
    let idleId = 0;
    const schedule = () => {
      idleId = requestIdleCallback(step, {
        timeout: interactiveCompletion ? INTERACTIVE_TIMEOUT_MS : BACKGROUND_TIMEOUT_MS,
      });
    };
    const step = (deadline: IdleDeadline) => {
      if (gen !== generation || !pending) return;
      const budget = deadline.didTimeout ? SLICE_MS : Math.max(2, Math.min(SLICE_MS, deadline.timeRemaining()));
      const count = Math.max(8, Math.floor(budget / perBlock));
      const start = performance.now();
      // Most renderer chunks are cheap, but a table can be costly. Parse at most
      // two chunks per callback and stop appending when its budget runs out.
      // An expired callback reports no idle time, but still gets a bounded slice.
      const appended = appendBlocks(count, 2,
        () => performance.now() - start >= budget || (!deadline.didTimeout && deadline.timeRemaining() < 2));
      void article.offsetHeight; // lay out now, inside this slice, not in the next frame
      perBlock = Math.max(0.005, (performance.now() - start) / Math.max(1, appended));
      if (pending) schedule();
    };
    rescheduleBackground = () => {
      cancelIdleCallback(idleId);
      schedule();
    };
    cancelBackground = () => cancelIdleCallback(idleId);
    schedule();
  };

  const lineOf = (el: Element) => Number(el.getAttribute('data-line')) || 1;
  const lastLoadedLine = () => {
    const last = article.lastElementChild;
    return last ? lineOf(last) : 0;
  };

  /** Elements with a source line, in document order (so also in line order). */
  const lineElements = () => article.querySelectorAll<HTMLElement>('[data-line]');

  const topLine = (): number => {
    const els = lineElements();
    const edge = scroller.getBoundingClientRect().top;
    // First element whose bottom is below the top edge; positions grow with document
    // order, so binary search.
    let lo = 0;
    let hi = els.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (els[mid]!.getBoundingClientRect().bottom <= edge + 1) lo = mid + 1;
      else hi = mid;
    }
    const el = els[lo];
    return el ? lineOf(el) : 1;
  };

  const scrollToElement = (el: Element) => el.scrollIntoView({ block: 'start' });

  const scrollToLine = (line: number) => {
    // Load past the target, with a screenful below it, so it can reach the top.
    appendUntil(() => lastLoadedLine() > line && article.scrollHeight > scroller.clientHeight * 2);
    const els = lineElements();
    // Last element starting at or before `line`.
    let lo = 0;
    let hi = els.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lineOf(els[mid]!) <= line) lo = mid + 1;
      else hi = mid;
    }
    const el = els[lo - 1];
    if (el) scrollToElement(el);
    else scroller.scrollTop = 0;
  };

  const findAnchor = (id: string): HTMLElement | null =>
    article.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ??
    article.querySelector<HTMLElement>(`[id="${CSS.escape(id.toLowerCase())}"]`);

  const scrollToAnchor = (id: string): boolean => {
    let el = findAnchor(id);
    while (!el && pending) {
      appendBlocks(FIRST_SCREEN_STEP * 8);
      el = findAnchor(id);
    }
    if (!el) return false;
    const target = el;
    appendUntil(() => article.scrollHeight - target.offsetTop > scroller.clientHeight * 2);
    scrollToElement(target);
    return true;
  };

  return {
    async show(doc: ViewDocument, at?: Position) {
      const gen = ++generation;
      const ends = [...(doc.chunkEnds ?? []), doc.html.length];
      const template = document.createElement('template');
      template.innerHTML = doc.html.slice(0, ends[0]); // inert: nothing loads or lays out yet
      trace('viewer first HTML chunk parsed');
      await mathFontReady(doc.html);
      trace('viewer math font ready');
      if (gen !== generation) return;

      pending = template.content;
      interactiveCompletion = settledWaiters.some(({ signal }) => signal && !signal.aborted);
      rescheduleBackground = null;
      cancelBackground = null;
      pendingHtml = doc.html;
      chunkEnds = ends;
      nextChunk = 1;
      contentVersion++;
      textRevision++;
      article.replaceChildren();
      scroller.scrollTop = 0;
      // The first screenful (and a bit) now; checking the height lays it out.
      appendUntil(() => article.scrollHeight > scroller.clientHeight * 1.5);
      trace('viewer first blocks laid out');
      if (at && 'anchor' in at) {
        if (!scrollToAnchor(at.anchor)) scroller.scrollTop = 0;
      } else if (at) {
        scrollToLine(at.line);
      }
      if (pending) appendInBackground(gen);
      else appendBlocks(0); // resolves settled() waiters
      shownListeners.forEach((listener) => listener(doc));
    },
    topLine,
    scrollToAnchor,
    focus: () => scroller.focus({ preventScroll: true }),
    settled: (interactive) => (pending && !interactive?.aborted ? new Promise<void>((resolve) => {
      const waiter: { resolve: () => void; signal?: AbortSignal; abort?: () => void } = { resolve, signal: interactive };
      if (interactive) {
        waiter.abort = () => {
          interactive.removeEventListener('abort', waiter.abort!);
          settledWaiters = settledWaiters.filter((item) => item !== waiter);
          resolve();
          if (interactiveCompletion && !settledWaiters.some(({ signal }) => signal && !signal.aborted)) {
            interactiveCompletion = false;
            rescheduleBackground?.();
          }
        };
        interactive.addEventListener('abort', waiter.abort, { once: true });
      }
      settledWaiters.push(waiter);
      if (interactive && !interactiveCompletion) {
        interactiveCompletion = true;
        rescheduleBackground?.();
      }
    }) : Promise.resolve()),
    loadAll: () => appendUntil(() => false),
    suspend: () => {
      generation++;
      contentVersion++;
      cancelBackground?.();
      cancelBackground = null;
      rescheduleBackground = null;
      interactiveCompletion = false;
      pending = null;
      pendingHtml = '';
      resolveSettledWaiters();
    },
    version: () => contentVersion,
    textVersion: () => textRevision,
    invalidateTextNodes: () => void textRevision++,
    onShown: (listener) => void shownListeners.push(listener),
  };
}
