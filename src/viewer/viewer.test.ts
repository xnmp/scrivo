// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ViewDocument } from '../app/ports';
import { createViewer, type Viewer } from './viewer';

const para = (line: number, text = `Paragraph ${line}`) => `<p data-line="${line}">${text}</p>\n`;
const doc = (html: string): ViewDocument => ({ path: '/d/a.md', stamp: null, html, headings: [] });
const docOf = (count: number, text?: (line: number) => string) =>
  doc(Array.from({ length: count }, (_, i) => para(i + 1, text?.(i + 1))).join(''));

/** Idle callbacks run only when the test says so. */
let idleQueue: IdleRequestCallback[] = [];
const runIdle = () => {
  while (idleQueue.length > 0) {
    const batch = idleQueue;
    idleQueue = [];
    batch.forEach((cb) => cb({ didTimeout: false, timeRemaining: () => 5 }));
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
  (globalThis as any).requestIdleCallback = (cb: IdleRequestCallback) => idleQueue.push(cb);
  document.body.innerHTML = '<div id="viewer"><article id="document" class="markdown-body"></article></div>';
  scroller = document.getElementById('viewer')!;
  article = document.getElementById('document')!;
  links = [];
  fakeLayout();
  viewer = createViewer(scroller, article, (href) => links.push(href));
});

afterEach(() => {
  delete (globalThis as any).requestIdleCallback;
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
    idleQueue.shift()?.({ didTimeout: false, timeRemaining: () => 5 });
    expect(article.querySelector('[data-line="81"]')).toBeNull();
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
