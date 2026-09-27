import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { diskPut, openApp } from './helpers';

const largeMarkdown = readFileSync(new URL('../bench/fixtures/large.md', import.meta.url), 'utf8');

test('returning from edit shows the first screen before inserting the whole large document', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  await diskPut(page, '/sample/large.md', largeMarkdown);
  await page.evaluate(() => (window as any).__scrivo.workspace.open('/sample/large.md'));

  const first = await page.evaluate(async () => {
    const { workspace } = (window as any).__scrivo;
    await workspace.toggle();
    if (workspace.mode() !== 'edit') throw new Error('Editor did not open');
    await workspace.toggle();
    return {
      mode: workspace.mode(),
      codes: document.querySelectorAll('#document pre[data-lang] > code').length,
      viewport: document.getElementById('viewer')!.clientHeight,
      content: document.getElementById('document')!.scrollHeight,
      firstBlockVisible: (() => {
        const block = document.querySelector('#document > *')!.getBoundingClientRect();
        const view = document.getElementById('viewer')!.getBoundingClientRect();
        return block.bottom > view.top && block.top < view.bottom;
      })(),
      preparing: document.body.dataset.preparingView,
    };
  });
  expect(first.mode).toBe('view');
  expect(first.viewport).toBeGreaterThan(0);
  expect(first.content).toBeGreaterThan(first.viewport * 1.5);
  expect(first.firstBlockVisible).toBe(true);
  expect(first.preparing).toBeUndefined();
  expect(first.codes).toBeLessThan(800);
  await expect(page.locator('#document pre[data-lang] > code')).toHaveCount(800, { timeout: 20_000 });
  const tail = await page.evaluate(() => (window as any).__scrivo.viewer.scrollToAnchor('end-of-large-benchmark-document'));
  expect(tail).toBe(true);
  await expect(page.locator('#end-of-large-benchmark-document')).toBeInViewport();
});
