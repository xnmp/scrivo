import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('retrying a failed startup tail restores Find and code highlighting', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  await page.evaluate(async () => {
    const source = `${Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: ${'reading text '.repeat(8)}`).join('\n\n')}\n\n\`\`\`javascript\nconst uniqueTailMarker = 1;\n\`\`\`\n`;
    const response = await fetch('/__scrivo/render', { method: 'POST', body: source });
    if (!response.ok) throw new Error(await response.text());
    const full = { ...(await response.json()), path: null, stamp: null };
    const firstEnd = full.chunkEnds[0];
    if (!firstEnd || firstEnd >= full.html.length) throw new Error('fixture has no renderer tail');
    const preview = { ...full, html: full.html.slice(0, firstEnd), chunkEnds: [] };
    let attempts = 0;
    const viewer = (window as any).__scrivo.viewer;
    await viewer.show(preview, undefined, () => ++attempts === 1
      ? Promise.reject(new Error('temporary tail failure')) : Promise.resolve(full));
  });

  await expect(page.getByRole('alert')).toContainText('document is incomplete');
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find in document' }).fill('uniqueTailMarker');
  await expect(page.locator('.find-count')).toHaveText('Search failed');

  const retry = page.getByRole('button', { name: 'Retry' });
  await retry.focus();
  await retry.press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.find-count')).toHaveText('1 of 1');
  await expect(page.locator('#document pre[data-lang] > code .tok-keyword')).toContainText('const');
  await expect.poll(() => page.evaluate(() => document.activeElement === document.getElementById('viewer'))).toBe(true);
});
