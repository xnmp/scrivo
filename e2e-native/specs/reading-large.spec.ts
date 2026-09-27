import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';

const expectedCode = [...readFileSync(new URL('../../bench/fixtures/large.md', import.meta.url), 'utf8')
  .matchAll(/```(?:python|rust)\n([\s\S]*?)```/g)].map((match) => match[1]);

describe('large file in the native reading view', () => {
  it('opens Find while code highlighting is still in progress', async () => {
    await $('#document h1').waitForExist({ timeout: 15_000 });
    let openedAt = 0;
    await browser.waitUntil(async () => {
      const result = await browser.execute(() => {
        const codes = document.querySelectorAll('#document pre[data-lang] > code');
        const highlighted = document.querySelectorAll('#document pre[data-lang] > code:has(.tok-keyword)').length;
        if (codes.length !== 800 || highlighted === 0 || highlighted === 800) return null;
        // Sample and open in one webview task, so highlighting cannot finish between them.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Find in document"]');
        return { highlighted, open: input !== null && !input.closest('.find-bar')?.hasAttribute('hidden') && document.activeElement === input };
      });
      if (!result?.open) return false;
      openedAt = result.highlighted;
      return true;
    }, { timeout: 20_000, timeoutMsg: 'Find did not open during partial code highlighting' });
    const find = $('input[aria-label="Find in document"]');
    await find.waitForDisplayed();
    expect(openedAt).toBeLessThan(800);
    await find.setValue('fib_400');
    await browser.waitUntil(async () => (await $('.find-count').getText()) === '1 of 1', {
      timeout: 10_000,
      timeoutMsg: 'find did not locate text in the final code block while highlighting',
    });
    await browser.keys(['Escape']);
  });

  it('renders the fixture-specific tail and can scroll it into view', async () => {
    const heading = $('#document h1');
    await heading.waitForExist({ timeout: 15_000 });
    expect(await heading.getText()).toBe('Benchmark Large Document');

    await browser.waitUntil(async () => browser.execute(() =>
      document.getElementById('end-of-large-benchmark-document')?.textContent === 'End of Large Benchmark Document',
    ), { timeout: 20_000, timeoutMsg: 'the large document tail did not render' });
    const structure = await browser.execute(() => ({
      tables: document.querySelectorAll('#document table').length,
      math: document.querySelectorAll('#document math').length,
      tasks: document.querySelectorAll('#document input[type="checkbox"]').length,
    }));
    expect(structure).toEqual({ tables: 400, math: 800, tasks: 800 });
    await browser.execute(() => document.getElementById('end-of-large-benchmark-document')!.scrollIntoView());
    const visible = await browser.execute(() => {
      const tail = document.getElementById('end-of-large-benchmark-document')!;
      const viewer = document.querySelector('#viewer')!;
      const tailBox = tail.getBoundingClientRect();
      const viewerBox = viewer.getBoundingClientRect();
      return tailBox.top >= viewerBox.top && tailBox.bottom <= viewerBox.bottom;
    });
    expect(visible).toBe(true);
  });

  it('highlights all fenced blocks without changing their source', async () => {
    expect(expectedCode).toHaveLength(800);
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelectorAll('#document pre[data-lang] > code').length === 800,
    ), { timeout: 20_000, timeoutMsg: 'the large document code blocks did not render' });
    await browser.keys(['Control', 'f']);
    const find = $('input[aria-label="Find in document"]');
    await find.waitForDisplayed();
    await find.setValue('fib_400');
    await browser.waitUntil(async () => (await $('.find-count').getText()) === '1 of 1', {
      timeout: 10_000,
      timeoutMsg: 'find did not locate text in the final code block',
    });
    await browser.waitUntil(async () => browser.execute(() => {
      const codes = [...document.querySelectorAll('#document pre[data-lang] > code')];
      return codes.length === 800 && codes.every((code) => code.querySelector('.tok-keyword'));
    }), { timeout: 20_000, timeoutMsg: 'the large document code blocks were not highlighted' });
    expect(await $('.find-count').getText()).toBe('1 of 1');
    const highlighted = await browser.execute(() =>
      [...document.querySelectorAll('#document pre[data-lang] > code')].map((code) => code.textContent),
    );
    expect(highlighted).toEqual(expectedCode);
  });

  it('returns from editing with a populated first screen and finishes the document in the background', async () => {
    await browser.keys(['Escape']);
    await browser.execute(() => { document.getElementById('viewer')!.scrollTop = 0; });
    await browser.keys(['Control', 'e']);
    await browser.waitUntil(() => browser.execute(() => document.body.dataset.mode === 'edit'), {
      timeout: 15_000,
      timeoutMsg: 'large document did not enter edit mode',
    });
    await browser.execute(() => {
      const observer = new MutationObserver(() => {
        if (document.body.dataset.mode !== 'view') return;
        const viewer = document.getElementById('viewer')!;
        const article = document.getElementById('document')!;
        (window as any).__largeToggleFirst = {
          codes: article.querySelectorAll('pre[data-lang] > code').length,
          viewport: viewer.clientHeight,
          content: article.scrollHeight,
        };
        observer.disconnect();
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
    });
    await browser.keys(['Control', 'e']);
    await browser.waitUntil(() => browser.execute(() => Boolean((window as any).__largeToggleFirst)), {
      timeout: 15_000,
      timeoutMsg: 'large document did not return to reading mode',
    });
    const first = await browser.execute(() => (window as any).__largeToggleFirst as { codes: number; viewport: number; content: number });
    expect(first.codes).toBeLessThan(800);
    expect(first.viewport).toBeGreaterThan(0);
    expect(first.content).toBeGreaterThan(first.viewport * 1.5);
    await browser.waitUntil(() => browser.execute(() =>
      document.querySelectorAll('#document pre[data-lang] > code').length === 800,
    ), { timeout: 20_000, timeoutMsg: 'large document did not finish inserting after the mode switch' });
  });
});
