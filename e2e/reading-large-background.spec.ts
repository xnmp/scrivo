import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

const largeMarkdown = readFileSync(new URL('../bench/fixtures/large.md', import.meta.url), 'utf8');

test('background insertion completes the large document without stalling frames', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async (source) => {
    const response = await fetch('/__scrivo/render', { method: 'POST', body: source });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    const gaps: number[] = [];
    let previous = 0;
    let sampling = true;
    const sample = (time: number) => {
      if (previous) gaps.push(time - previous);
      previous = time;
      if (sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    await new Promise(requestAnimationFrame);
    await viewer.show(rendered);
    await viewer.settled();
    await new Promise(requestAnimationFrame);
    sampling = false;
    return {
      maxFrameGap: Math.max(...gaps),
      codes: document.querySelectorAll('#document pre[data-lang] > code').length,
      tables: document.querySelectorAll('#document table').length,
      math: document.querySelectorAll('#document math').length,
      tasks: document.querySelectorAll('#document input[type="checkbox"]').length,
      tail: viewer.scrollToAnchor('end-of-large-benchmark-document'),
    };
  }, largeMarkdown);
  expect(result).toMatchObject({ codes: 800, tables: 400, math: 800, tasks: 800, tail: true });
  expect(result.maxFrameGap).toBeLessThan(250);
  await expect(page.locator('#end-of-large-benchmark-document')).toBeInViewport();
});
