// @vitest-environment happy-dom
// happy-dom has no CSS Custom Highlight API, so this exercises the fallback: the current
// match is the selection. The highlight path is covered by e2e/find.spec.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { createFinder, type FindSource } from './find';

let scroller: HTMLElement;
let article: HTMLElement;
let loadAllCalls: number;
let version: number;

const source: FindSource = {
  loadAll: () => void loadAllCalls++,
  version: () => version,
};

const selected = () => getSelection()?.toString() ?? '';

beforeEach(() => {
  document.body.innerHTML = '<div id="viewer"><article id="document"></article></div>';
  scroller = document.getElementById('viewer')!;
  article = document.getElementById('document')!;
  loadAllCalls = 0;
  version = 1;
});

describe('finder', () => {
  it('finds matches across inline formatting, case-insensitively', () => {
    article.innerHTML = '<p>Some <strong>bo</strong>ld text.</p>\n<p>More BOLD here</p>';
    const finder = createFinder(scroller, article, source);
    expect(finder.search('bold')).toEqual({ count: 2, current: 0, capped: false });
    expect(selected()).toBe('bold');
    expect(finder.next(1)).toMatchObject({ current: 1 });
    expect(selected()).toBe('BOLD');
  });

  it('wraps around in both directions', () => {
    article.innerHTML = '<p>a x b x c x</p>';
    const finder = createFinder(scroller, article, source);
    finder.search('x');
    expect(finder.next(-1).current).toBe(2);
    expect(finder.next(1).current).toBe(0);
  });

  it('searches the whole document, including blocks not yet inserted', () => {
    article.innerHTML = '<p>one</p>';
    const finder = createFinder(scroller, article, { ...source, loadAll: () => article.insertAdjacentHTML('beforeend', '<p>two</p>') });
    expect(finder.search('two').count).toBe(1);
    expect(selected()).toBe('two');
  });

  it('re-reads the text when the document changes', () => {
    article.innerHTML = '<p>alpha</p>';
    const finder = createFinder(scroller, article, source);
    expect(finder.search('beta').count).toBe(0);
    article.innerHTML = '<p>beta</p>';
    version = 2;
    expect(finder.search('beta').count).toBe(1);
  });

  it('reports no match, and nothing for an empty query', () => {
    article.innerHTML = '<p>text</p>';
    const finder = createFinder(scroller, article, source);
    expect(finder.search('zebra')).toEqual({ count: 0, current: -1, capped: false });
    expect(finder.search('')).toEqual({ count: 0, current: -1, capped: false });
    expect(finder.next(1).current).toBe(-1);
  });

  it('treats the query as literal text', () => {
    article.innerHTML = '<p>cost (a+b)* 2 and ab</p>';
    const finder = createFinder(scroller, article, source);
    expect(finder.search('(a+b)*').count).toBe(1);
    expect(selected()).toBe('(a+b)*');
  });

  it('caps huge match counts', () => {
    article.innerHTML = `<p>${'a '.repeat(10_050)}</p>`;
    const finder = createFinder(scroller, article, source);
    expect(finder.search('a')).toMatchObject({ count: 10_000, capped: true });
  });

  it('clear() drops the matches and the selection', () => {
    article.innerHTML = '<p>word word</p>';
    const finder = createFinder(scroller, article, source);
    finder.search('word');
    finder.clear();
    expect(selected()).toBe('');
    expect(finder.next(1).current).toBe(-1);
  });
});
