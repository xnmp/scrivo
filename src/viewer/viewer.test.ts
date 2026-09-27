// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewDocument } from '../app/ports';
import { createViewer, type Viewer } from './viewer';

const para = (line: number, text = `Paragraph ${line}`) => `<p data-line="${line}">${text}</p>\n`;
const doc = (html: string): ViewDocument => ({ path: '/d/a.md', stamp: null, html, headings: [] });
const docOf = (count: number, text?: (line: number) => string) =>
  doc(Array.from({ length: count }, (_, i) => para(i + 1, text?.(i + 1))).join(''));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

/** Idle callbacks run only when the test says so. */
let idleQueue: Array<{ id: number; callback: IdleRequestCallback; timeout?: number }> = [];
let nextIdleId = 1;
const runIdle = () => {
  while (idleQueue.length > 0) {
    const batch = idleQueue;
    idleQueue = [];
    batch.forEach(({ callback }) => callback({ didTimeout: false, timeRemaining: () => 5 }));
  }
};

let scroller: HTMLElement;
let article: HTMLElement;
let links: string[];
let viewer: Viewer;

/**
 * happy-dom has no layout: give the article a height of 10px per block and the
 * scroller a 100px viewport, so "a screenful" means about 10 blocks.
 */
function fakeLayout() {
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(article, 'scrollHeight', { configurable: true, get: () => article.children.length * 10 });
}

const texts = () => [...article.children].map((el) => el.textContent);

beforeEach(() => {
  idleQueue = [];
  nextIdleId = 1;
  (globalThis as any).requestIdleCallback = (callback: IdleRequestCallback, options?: IdleRequestOptions) => {
    const id = nextIdleId++;
    idleQueue.push({ id, callback, timeout: options?.timeout });
    return id;
  };
  (globalThis as any).cancelIdleCallback = (id: number) => {
    idleQueue = idleQueue.filter((item) => item.id !== id);
  };
  document.body.innerHTML = '<div id="viewer"><article id="document" class="markdown-body"></article></div>';
  scroller = document.getElementById('viewer')!;
  article = document.getElementById('document')!;
  links = [];
  fakeLayout();
  viewer = createViewer(scroller, article, (href) => links.push(href));
});

afterEach(() => {
  delete (globalThis as any).requestIdleCallback;
  delete (globalThis as any).cancelIdleCallback;
});

describe('showing a document', () => {
  it('shows the first screenful at once and the rest in idle time', async () => {
    await viewer.show(docOf(100));
    const first = article.children.length;
    expect(first).toBeGreaterThanOrEqual(15); // 1.5 screens
    expect(first).toBeLessThan(100);
    let settled = false;
    void viewer.settled().then(() => (settled = true));

    runIdle();
    await Promise.resolve();
    expect(texts()).toEqual(Array.from({ length: 100 }, (_, i) => `Paragraph ${i + 1}`));
    expect(settled).toBe(true);
  });

  it('shows and navigates every block when the renderer supplies HTML chunks', async () => {
    const chunks = Array.from({ length: 5 }, (_, batch) =>
      Array.from({ length: 40 }, (_, i) => para(batch * 40 + i + 1, i === 0 && batch === 0 ? '😀 first' : `Paragraph ${batch * 40 + i + 1}`)).join(''));
    const html = chunks.join('');
    const chunkEnds = chunks.slice(0, -1).map((_, i) => chunks.slice(0, i + 1).join('').length);
    await viewer.show({ ...doc(html), chunkEnds });
    expect(article.children.length).toBeLessThan(40);
    idleQueue.shift()?.callback({ didTimeout: false, timeRemaining: () => 5 });
    expect(article.children.length).toBeLessThan(200);
    runIdle();
    await viewer.settled();
    expect(texts()).toEqual(['😀 first', ...Array.from({ length: 199 }, (_, i) => `Paragraph ${i + 2}`)]);
    expect(viewer.scrollToAnchor('missing')).toBe(false);
    await viewer.show({ ...doc(html + '<h2 id="end" data-line="201">End</h2>'), chunkEnds });
    expect(viewer.scrollToAnchor('end')).toBe(true);
  });

  it('a short document is complete as soon as show() resolves', async () => {
    await viewer.show(docOf(3));
    expect(texts()).toEqual(['Paragraph 1', 'Paragraph 2', 'Paragraph 3']);
    await expect(viewer.settled()).resolves.toBeUndefined();
  });

  it('promotes pending insertion for interactive consumers and completes on timeout slices', async () => {
    await viewer.show(docOf(100));
    expect(idleQueue.map((item) => item.timeout)).toEqual([250]);
    const settled = viewer.settled(new AbortController().signal);
    expect(idleQueue.map((item) => item.timeout)).toEqual([25]);
    while (idleQueue.length > 0) {
      const item = idleQueue.shift()!;
      item.callback({ didTimeout: true, timeRemaining: () => 0 });
    }
    await settled;
    expect(texts()).toEqual(Array.from({ length: 100 }, (_, i) => `Paragraph ${i + 1}`));
  });

  it('returns to background scheduling when an interactive wait is cancelled', async () => {
    await viewer.show(docOf(100));
    const controller = new AbortController();
    const settled = viewer.settled(controller.signal);
    expect(idleQueue.map((item) => item.timeout)).toEqual([25]);
    controller.abort();
    await settled;
    expect(idleQueue.map((item) => item.timeout)).toEqual([250]);
    runIdle();
    expect(texts()).toHaveLength(100);
  });

  it('stops pending insertion while the reading surface is hidden', async () => {
    await viewer.show(docOf(100));
    const visible = article.children.length;
    let settled = false;
    void viewer.settled().then(() => { settled = true; });
    viewer.suspend();
    runIdle();
    await Promise.resolve();
    expect(article.children.length).toBe(visible);
    expect(settled).toBe(true);
    await viewer.show(docOf(3));
    expect(texts()).toEqual(['Paragraph 1', 'Paragraph 2', 'Paragraph 3']);
  });

  it('an empty document empties the page', async () => {
    await viewer.show(docOf(3));
    await viewer.show(doc(''));
    expect(article.children).toHaveLength(0);
    await expect(viewer.settled()).resolves.toBeUndefined();
  });

  it('a newer document replaces one still being appended, which then stops', async () => {
    const old = docOf(100, (n) => `old ${n}`);
    const firstChunkEnd = Array.from({ length: 40 }, (_, i) => para(i + 1, `old ${i + 1}`)).join('').length;
    await viewer.show({ ...old, chunkEnds: [firstChunkEnd] });
    await viewer.show(docOf(50, (n) => `new ${n}`));
    runIdle();
    expect(texts()).toEqual(Array.from({ length: 50 }, (_, i) => `new ${i + 1}`));
  });

  it('scrolling to a line or anchor loads the document that far', async () => {
    await viewer.show(docOf(100), { line: 80 });
    expect(article.querySelector('[data-line="80"]')).not.toBeNull();

    const withAnchor = docOf(100).html + '<h2 id="end" data-line="101">End</h2>\n';
    await viewer.show(doc(withAnchor));
    expect(viewer.scrollToAnchor('end')).toBe(true);
    expect(viewer.scrollToAnchor('END')).toBe(true); // GitHub anchors are lowercase
    expect(viewer.scrollToAnchor('missing')).toBe(false);
  });
});

describe('deferred startup tail', () => {
  const prefix = Array.from({ length: 32 }, (_, i) => para(i + 1, i === 0 ? '😀 first' : `Paragraph ${i + 1}`)).join('');
  const full = doc(prefix + Array.from({ length: 68 }, (_, i) => para(i + 33)).join(''));
  const complete = { ...full, chunkEnds: [prefix.length] };

  it('keeps Find waiting until the complete document is present', async () => {
    const tail = deferred<ViewDocument>();
    await viewer.show(doc(prefix), undefined, () => tail.promise);
    let settled = false;
    void viewer.settled().then(() => { settled = true; });
    runIdle();
    await Promise.resolve();
    expect(settled).toBe(false);
    const searchReady = viewer.settled(new AbortController().signal);
    tail.resolve(complete);
    await Promise.resolve();
    await Promise.resolve();
    runIdle();
    await searchReady;
    expect(texts()).toEqual(['😀 first', ...Array.from({ length: 99 }, (_, i) => `Paragraph ${i + 2}`)]);
  });

  it('waits for the tail before showing a sparse first viewport', async () => {
    const tail = deferred<ViewDocument>();
    const first = para(1);
    let shown = false;
    const showing = viewer.show(doc(first), undefined, () => tail.promise).then(() => { shown = true; });
    await Promise.resolve();
    expect(shown).toBe(false);
    tail.resolve({ ...docOf(50), chunkEnds: [first.length] });
    await showing;
    expect(article.children.length).toBeGreaterThanOrEqual(15);
  });

  it('honors an anchor requested before the tail arrives', async () => {
    const tail = deferred<ViewDocument>();
    await viewer.show(doc(prefix), undefined, () => tail.promise);
    expect(viewer.scrollToAnchor('end')).toBe(true);
    tail.resolve({ ...doc(`${full.html}<h2 id="end" data-line="101">End</h2>\n`), chunkEnds: [prefix.length] });
    await Promise.resolve();
    await Promise.resolve();
    expect(article.querySelector('#end')?.textContent).toBe('End');
  });

  it('does not replay a queued anchor after a newer successful jump', async () => {
    const tail = deferred<ViewDocument>();
    const first = `<h2 id="early" data-line="1">Early</h2>\n${prefix}`;
    await viewer.show(doc(first), undefined, () => tail.promise);
    expect(viewer.scrollToAnchor('late')).toBe(true);
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    try {
      expect(viewer.scrollToAnchor('early')).toBe(true);
      tail.resolve({ ...doc(`${first}<h2 id="late" data-line="101">Late</h2>\n`), chunkEnds: [first.length] });
      await Promise.resolve();
      await Promise.resolve();
      expect(scrolled.mock.instances.map((element) => (element as Element).id)).toEqual(['early']);
    } finally {
      scrolled.mockRestore();
    }
  });

  it('keeps a failed tail visible and completes the document when retried', async () => {
    const first = deferred<ViewDocument>();
    const second = deferred<ViewDocument>();
    const errors: Error[] = [];
    const shown: ViewDocument[] = [];
    let attempts = 0;
    viewer = createViewer(scroller, article, () => undefined, () => undefined, (error) => errors.push(error));
    viewer.onShown((document) => shown.push(document));
    await viewer.show(doc(prefix), undefined, () => ++attempts === 1 ? first.promise : second.promise);
    const settled = viewer.settled(new AbortController().signal);
    first.reject(new Error('tail failed'));
    await expect(settled).rejects.toThrow('tail failed');
    expect(errors.map((error) => error.message)).toEqual(['tail failed']);
    await vi.waitFor(() => expect(scroller.querySelector('[role="alert"]')?.textContent).toContain('document is incomplete'));
    expect(texts().length).toBeGreaterThan(0);
    expect(texts().length).toBeLessThan(100);
    await expect(viewer.settled()).rejects.toThrow('tail failed');
    const retry = scroller.querySelector('.document-load-error button') as HTMLButtonElement;
    retry.focus();
    retry.click();
    expect(attempts).toBe(2);
    second.resolve(complete);
    await Promise.resolve();
    await Promise.resolve();
    runIdle();
    await viewer.settled();
    expect(attempts).toBe(2);
    expect(scroller.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(scroller);
    expect(texts()).toHaveLength(100);
    expect(shown).toEqual([doc(prefix), complete]);
  });

  it('clears a failed tail when a new document is shown', async () => {
    const tail = deferred<ViewDocument>();
    await viewer.show(doc(prefix), undefined, () => tail.promise);
    const settled = viewer.settled(new AbortController().signal);
    tail.reject(new Error('tail failed'));
    await expect(settled).rejects.toThrow('tail failed');
    await vi.waitFor(() => expect(scroller.querySelector('[role="alert"]')).not.toBeNull());
    await viewer.show(docOf(3));
    await expect(viewer.settled()).resolves.toBeUndefined();
    expect(scroller.querySelector('[role="alert"]')).toBeNull();
    expect(texts()).toEqual(['Paragraph 1', 'Paragraph 2', 'Paragraph 3']);
  });

  it('ignores an old tail after the reader is replaced', async () => {
    const tail = deferred<ViewDocument>();
    await viewer.show(doc(prefix), undefined, () => tail.promise);
    const waiting = viewer.settled(new AbortController().signal);
    await viewer.show(docOf(3, (line) => `new ${line}`));
    tail.resolve(complete);
    await waiting;
    runIdle();
    expect(texts()).toEqual(['new 1', 'new 2', 'new 3']);
  });
});

describe('links', () => {
  it('report the raw href and never navigate', async () => {
    await viewer.show(doc('<p data-line="1"><a href="other.md#x">go</a> <a>no href</a> text</p>\n'));
    const [withHref, withoutHref] = article.querySelectorAll('a');
    const click = (el: Element) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(click(withHref!)).toBe(true);
    expect(click(withoutHref!)).toBe(true);
    expect(click(article.querySelector('p')!)).toBe(false);
    expect(links).toEqual(['other.md#x']);
  });

  it('ignore middle clicks, which would open a window', async () => {
    await viewer.show(doc('<p data-line="1"><a href="https://example.com/">go</a></p>\n'));
    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    article.querySelector('a')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(links).toEqual([]);
  });
});
