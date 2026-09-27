import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

const largeMarkdown = readFileSync(new URL('../bench/fixtures/large.md', import.meta.url), 'utf8');

test('Find stays responsive while the large document finishes inserting', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  const immediate = await page.evaluate(async (source) => {
    const response = await fetch('/__scrivo/render', { method: 'POST', body: source });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    await viewer.show(rendered);
    const start = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    const input = document.querySelector<HTMLInputElement>('.find-bar input')!;
    input.value = 'fib_400';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      ms: performance.now() - start,
      count: document.querySelector('.find-count')?.textContent,
      focused: document.activeElement === input,
      codes: document.querySelectorAll('#document pre[data-lang] > code').length,
    };
  }, largeMarkdown);
  expect(immediate.ms).toBeLessThan(150);
  expect(immediate.count).toBe('Searching…');
  expect(immediate.focused).toBe(true);
  expect(immediate.codes).toBeLessThan(800);

  await expect(page.locator('.find-count')).toHaveText('1 of 1', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => {
    const [range] = [...((CSS as any).highlights.get('scrivo-find-current') ?? [])] as Range[];
    if (!range) return null;
    const box = range.getBoundingClientRect();
    const view = document.getElementById('viewer')!.getBoundingClientRect();
    return { text: range.toString(), visible: box.top >= view.top && box.bottom <= view.bottom };
  })).toEqual({ text: 'fib_400', visible: true });
  expect(await page.locator('#document pre[data-lang] > code').count()).toBe(800);
});

test('closing Find while the large document loads leaves no stale highlights', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  await page.evaluate(async (source) => {
    const response = await fetch('/__scrivo/render', { method: 'POST', body: source });
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    await viewer.show(rendered);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    const input = document.querySelector<HTMLInputElement>('.find-bar input')!;
    input.value = 'fib_400';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    if (!document.querySelector<HTMLElement>('.find-bar')?.hidden) throw new Error('Find remained open');
  }, largeMarkdown);
  await page.evaluate(() => (window as any).__scrivo.viewer.settled());
  expect(await page.evaluate(() => (CSS as any).highlights.get('scrivo-find')?.size ?? 0)).toBe(0);
  await expect(page.locator('.find-bar')).toBeHidden();
});
