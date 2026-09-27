import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';

const expectedCode = [...readFileSync(new URL('../../bench/fixtures/large.md', import.meta.url), 'utf8')
  .matchAll(/```(?:python|rust)\n([\s\S]*?)```/g)].map((match) => match[1]);

describe('large file in the native reading view', () => {
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
});
