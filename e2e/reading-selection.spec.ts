import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

const selected = (page: import('@playwright/test').Page) => page.evaluate(() => getSelection()?.toString() ?? '');

test('reader selection clears on outside primary clicks while Shift and context clicks preserve it', async ({ page }) => {
  await openApp(page, { text: '# Heading\n\nOriginal text.', mode: 'view' });
  const paragraph = page.locator('#document p');
  const select = async () => paragraph.dblclick({ position: { x: 25, y: 10 } });
  await select(); await expect.poll(() => selected(page)).toContain('Original');
  await page.getByRole('tab', { name: 'inline.md' }).click({ modifiers: ['Shift'] });
  await expect.poll(() => selected(page)).toContain('Original');
  await paragraph.click({ button: 'right', position: { x: 25, y: 10 } });
  await expect.poll(() => selected(page)).toContain('Original');
  await select();
  await page.getByRole('tab', { name: 'inline.md' }).click();
  await expect.poll(() => selected(page)).toBe('');
  await select();
  const box = (await paragraph.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 10, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => selected(page)).not.toBe('');
  await page.mouse.click(12, box.y + 50);
  await expect.poll(() => selected(page)).toBe('');
});
