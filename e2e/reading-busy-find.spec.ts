import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

const largeMarkdown = readFileSync(new URL('../bench/fixtures/large.md', import.meta.url), 'utf8');

test('Find completes while animation leaves no idle time', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async (source) => {
    const response = await fetch('/__scrivo/render', { method: 'POST', body: source });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    let active = true;
    let frames = 0;
    const busyFrame = () => {
      if (!active) return;
      frames++;
      const end = performance.now() + 16;
      while (performance.now() < end) { /* continuous animation work */ }
      requestAnimationFrame(busyFrame);
    };
    requestAnimationFrame(busyFrame);
    try {
      await viewer.show(rendered);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
      const input = document.querySelector<HTMLInputElement>('.find-bar input')!;
      input.value = 'fib_400';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const focused = document.activeElement === input;
      const start = performance.now();
      while (performance.now() - start < 20_000 && document.querySelector('.find-count')?.textContent !== '1 of 1') {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        count: document.querySelector('.find-count')?.textContent,
        codes: document.querySelectorAll('#document pre[data-lang] > code').length,
        focused,
        frames,
      };
    } finally {
      active = false;
    }
  }, largeMarkdown);
  expect(result.focused).toBe(true);
  expect(result.frames).toBeGreaterThan(10);
  expect(result.count).toBe('1 of 1');
  expect(result.codes).toBe(800);
});
