// DOM implementation of the reading view (ViewerPort).
//
// The backend's HTML is inserted as-is: the renderer guarantees it contains no markup
// taken from the document (see ViewDocument). Every block element carries `data-line`,
// its 1-based source line, which is how scroll positions carry over to the editor.
//
// Long documents are shown progressively: the HTML is parsed once into an inert
// template, the first screenful is laid out and painted, and the remaining blocks are
// appended in idle time slices. Laying out a 20,000-line document in one go takes
// about half a second in WebKit; `content-visibility: auto` measured slower still.
import type { ViewDocument } from '../app/ports';
import type { Position, ViewerPort } from '../app/workspace';

export interface Viewer extends ViewerPort {
  focus(): void;
  /** Resolves once the whole current document is in the page. */
  settled(): Promise<void>;
}

/** Time budget per idle slice for appending blocks. */
const SLICE_MS = 8;
/** Blocks appended per step when filling the first screen. */
const FIRST_SCREEN_STEP = 24;

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
export function createViewer(scroller: HTMLElement, article: HTMLElement, onLink: (href: string) => void): Viewer {
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
  /** Bumped by every show(), so an older document stops appending. */
  let generation = 0;
  let settledWaiters: Array<() => void> = [];

  const appendBlocks = (count: number) => {
    for (let i = 0; i < count && pending?.firstChild; i++) article.appendChild(pending.firstChild);
    if (pending && !pending.firstChild) {
      pending = null;
      settledWaiters.forEach((resolve) => resolve());
      settledWaiters = [];
    }
  };

  /** Append blocks until `done()` holds or the document is complete. */
  const appendUntil = (done: () => boolean) => {
    while (pending && !done()) appendBlocks(FIRST_SCREEN_STEP);
  };

  const appendInBackground = (gen: number) => {
    let perBlock = 0.05; // ms per block, refined as we go
    const step = (deadline: IdleDeadline) => {
      if (gen !== generation || !pending) return;
      const budget = Math.max(2, Math.min(SLICE_MS, deadline.timeRemaining()));
      const count = Math.max(8, Math.floor(budget / perBlock));
      const start = performance.now();
      appendBlocks(count);
      void article.offsetHeight; // lay out now, inside this slice, not in the next frame
      perBlock = Math.max(0.005, (performance.now() - start) / count);
      if (pending) requestIdleCallback(step);
    };
    requestIdleCallback(step);
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
      const template = document.createElement('template');
      template.innerHTML = doc.html; // parsed but inert: nothing loads or lays out yet
      await mathFontReady(doc.html);
      if (gen !== generation) return;

      pending = template.content;
      article.replaceChildren();
      scroller.scrollTop = 0;
      // The first screenful (and a bit) now; checking the height lays it out.
      appendUntil(() => article.scrollHeight > scroller.clientHeight * 1.5);
      if (at && 'anchor' in at) {
        if (!scrollToAnchor(at.anchor)) scroller.scrollTop = 0;
      } else if (at) {
        scrollToLine(at.line);
      }
      if (pending) appendInBackground(gen);
      else appendBlocks(0); // resolves settled() waiters
    },
    topLine,
    scrollToAnchor,
    focus: () => scroller.focus({ preventScroll: true }),
    settled: () => (pending ? new Promise<void>((resolve) => settledWaiters.push(resolve)) : Promise.resolve()),
  };
}
