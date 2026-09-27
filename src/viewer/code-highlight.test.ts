// @vitest-environment happy-dom
import { LanguageDescription, LanguageSupport } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { highlightCodeBlocks } from './code-highlight';

const parser = () => new LanguageSupport(markdownLanguage);
const fast = LanguageDescription.of({ name: 'Fast', load: async () => parser() });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const article = () => {
  const root = document.createElement('article');
  root.innerHTML = '<pre data-lang="fast"><code># First\n</code></pre><pre data-lang="slow"><code># Second\n</code></pre>';
  document.body.append(root);
  return root;
};

let originalIdle: typeof requestIdleCallback;
beforeEach(() => {
  originalIdle = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (callback) => {
    callback({ didTimeout: false, timeRemaining: () => 12 });
    return 1;
  };
});
afterEach(() => {
  globalThis.requestIdleCallback = originalIdle;
  document.body.replaceChildren();
});

it('reports changed text before waiting for another grammar, then preserves both code blocks', async () => {
  const slowLoad = deferred<LanguageSupport>();
  const slow = LanguageDescription.of({ name: 'Slow', load: () => slowLoad.promise });
  const root = article();
  const onMutated = vi.fn();
  const done = highlightCodeBlocks(root, () => true, onMutated, [fast, slow]);

  await vi.waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1));
  expect(root.querySelector('code')?.querySelector('span')).not.toBeNull();
  expect(root.querySelectorAll('code')[1]?.querySelector('span')).toBeNull();

  slowLoad.resolve(parser());
  await done;
  expect([...root.querySelectorAll('code')].map((code) => code.textContent)).toEqual(['# First\n', '# Second\n']);
  expect(root.querySelectorAll('code')[1]?.querySelector('span')).not.toBeNull();
  expect(onMutated).toHaveBeenCalledTimes(2);
});

it('stops changing a superseded document while a grammar loads', async () => {
  const slowLoad = deferred<LanguageSupport>();
  const slow = LanguageDescription.of({ name: 'Slow', load: () => slowLoad.promise });
  const root = article();
  let current = true;
  const onMutated = vi.fn();
  const done = highlightCodeBlocks(root, () => current, onMutated, [fast, slow]);

  await vi.waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1));
  current = false;
  slowLoad.resolve(parser());
  await done;
  expect(root.querySelectorAll('code')[1]?.querySelector('span')).toBeNull();
  expect(onMutated).toHaveBeenCalledTimes(1);
});
