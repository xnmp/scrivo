import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('large code blocks remain complete and searchable after background parsing', async ({ page }) => {
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async () => {
    const line = '0123456789'.repeat(10).concat('\n').repeat(300);
    const markdown = Array.from({ length: 32 }, (_, i) => `\`\`\`\n${line}${i}\n\`\`\`\n`).join('\n') + '\n# Tail\n';
    const response = await fetch('/__scrivo/render', { method: 'POST', body: markdown });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    const frameGaps: number[] = [];
    let previous = 0;
    let sampling = true;
    const frame = (time: number) => {
      if (previous) frameGaps.push(time - previous);
      previous = time;
      if (sampling) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    await new Promise(requestAnimationFrame);
    await viewer.show(rendered);
    await viewer.settled();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    sampling = false;
    const codes = [...document.querySelectorAll('#document pre > code')];
    return {
      exact: codes.length === 32 && codes.every((code, i) => code.textContent === `${line}${i}\n`),
      maxFrameGap: Math.max(...frameGaps),
      chunks: rendered.chunkEnds.length + 1,
      tail: viewer.scrollToAnchor('tail'),
    };
  });
  expect(result.exact).toBe(true);
  expect(result.tail).toBe(true);
  expect(result.maxFrameGap).toBeLessThan(200);
  await expect(page.locator('#document h1')).toHaveText('Tail');
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find in document' }).fill('Tail');
  await expect(page.locator('.find-count')).toHaveText('1 of 1');
  console.log(`heavy-chunk diagnostic: ${result.chunks} chunks, max frame gap ${result.maxFrameGap.toFixed(1)} ms`);
});
