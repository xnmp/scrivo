// @vitest-environment happy-dom
// happy-dom has no CSS Custom Highlight API, so this exercises the fallback: the current
// match is the selection. The highlight path is covered by e2e/find.spec.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { createFinder, type FindSource } from './find';

let scroller: HTMLElement;
let article: HTMLElement;
let version: number;

const source: FindSource = {
  settled: () => Promise.resolve(),
  textVersion: () => version,
};

const selected = () => getSelection()?.toString() ?? '';

beforeEach(() => {
  document.body.innerHTML = '<div id="viewer"><article id="document"></article></div>';
  scroller = document.getElementById('viewer')!;
  article = document.getElementById('document')!;
  version = 1;
});

describe('finder', () => {
  it('finds matches across inline formatting, case-insensitively', async () => {
    article.innerHTML = '<p>Some <strong>bo</strong>ld text.</p>\n<p>More BOLD here</p>';
    const finder = createFinder(scroller, article, source);
    expect(await finder.search('bold')).toEqual({ count: 2, current: 0, capped: false });
    expect(selected()).toBe('bold');
    expect(finder.next(1)).toMatchObject({ current: 1 });
    expect(selected()).toBe('BOLD');
  });

  it('wraps around in both directions', async () => {
    article.innerHTML = '<p>a x b x c x</p>';
    const finder = createFinder(scroller, article, source);
    await finder.search('x');
    expect(finder.next(-1).current).toBe(2);
    expect(finder.next(1).current).toBe(0);
  });

  it('waits for the whole document before searching', async () => {
    article.innerHTML = '<p>one</p>';
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    const finder = createFinder(scroller, article, { ...source, settled: () => settled });
    const result = finder.search('two');
    expect(finder.next(1).count).toBe(0);
    article.insertAdjacentHTML('beforeend', '<p>two</p>');
    finish();
    expect((await result)?.count).toBe(1);
    expect(selected()).toBe('two');
  });

  it('re-reads the text when the document changes', async () => {
    article.innerHTML = '<p>alpha</p>';
    const finder = createFinder(scroller, article, source);
    expect((await finder.search('beta'))?.count).toBe(0);
    article.innerHTML = '<p>beta</p>';
    version = 2;
    expect((await finder.search('beta'))?.count).toBe(1);
  });

  it('finds text again after a code highlighter replaces its text nodes', async () => {
    article.innerHTML = '<pre><code>def value</code></pre>';
    const finder = createFinder(scroller, article, source);
    expect((await finder.search('value'))?.count).toBe(1);
    const code = article.querySelector('code')!;
    const span = document.createElement('span');
    span.textContent = 'def value';
    code.replaceChildren(span);
    version++;
    expect((await finder.search('value'))?.count).toBe(1);
    expect(selected()).toBe('value');
    expect(getSelection()?.anchorNode?.isConnected).toBe(true);
  });

  it('reports no match, and nothing for an empty query', async () => {
    article.innerHTML = '<p>text</p>';
    const finder = createFinder(scroller, article, source);
    expect(await finder.search('zebra')).toEqual({ count: 0, current: -1, capped: false });
    expect(await finder.search('')).toEqual({ count: 0, current: -1, capped: false });
    expect(finder.next(1).current).toBe(-1);
  });

  it('treats the query as literal text', async () => {
    article.innerHTML = '<p>cost (a+b)* 2 and ab</p>';
    const finder = createFinder(scroller, article, source);
    expect((await finder.search('(a+b)*'))?.count).toBe(1);
    expect(selected()).toBe('(a+b)*');
  });

  it('caps huge match counts', async () => {
    article.innerHTML = `<p>${'a '.repeat(10_050)}</p>`;
    const finder = createFinder(scroller, article, source);
    expect(await finder.search('a')).toMatchObject({ count: 10_000, capped: true });
  });

  it('clear() drops the matches and the selection', async () => {
    article.innerHTML = '<p>word word</p>';
    const finder = createFinder(scroller, article, source);
    await finder.search('word');
    finder.clear();
    expect(selected()).toBe('');
    expect(finder.next(1).current).toBe(-1);
  });

  it('does not publish a superseded query or a query cleared while waiting', async () => {
    article.innerHTML = '<p>alpha beta</p>';
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    const finder = createFinder(scroller, article, { ...source, settled: () => settled });
    const first = finder.search('alpha');
    const second = finder.search('beta');
    finish();
    expect(await first).toBeNull();
    expect(await second).toMatchObject({ count: 1 });
    expect(selected()).toBe('beta');

    const pending = finder.search('alpha');
    finder.clear();
    expect(await pending).toBeNull();
    expect(selected()).toBe('');
  });
});
