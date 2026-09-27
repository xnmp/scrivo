import { expect, test } from '@playwright/test';
import { diskGet, docText, openApp } from './helpers';

test.describe('recovery', () => {
  test('offers an untitled recovery copy and restores its exact Markdown', async ({ page }) => {
    await openApp(page, { doc: 'none' });
    await page.evaluate(async () => {
      const { platform, controller } = (window as any).__scrivo;
      await platform.recovery.put({
        id: crypto.randomUUID(), path: null, stamp: null,
        format: { eol: '\n', bom: false, mixedEol: false },
        text: '# Draft\n\n😀 | text', updatedAt: Date.now(),
      });
      void controller.start({ kind: 'none' });
    });
    await expect(page.getByRole('alertdialog')).toContainText('Recover edits to Untitled?');
    await page.getByRole('button', { name: 'Restore Edits' }).click();
    await expect.poll(() => docText(page)).toBe('# Draft\n\n😀 | text');
    await expect(page.locator('.save-status')).toContainText('Edited');
    expect(await diskGet(page, '/sample/inline.md')).toBeUndefined();
  });

  test('a newer disk version stays untouched when a recovery copy is restored', async ({ page }) => {
    await openApp(page, { text: 'Newer disk' });
    await page.evaluate(async () => {
      const { platform, controller } = (window as any).__scrivo;
      const file = await platform.fs.read('/sample/inline.md');
      await platform.recovery.put({
        id: crypto.randomUUID(), path: file.path, stamp: 'older-stamp',
        format: { eol: '\n', bom: false, mixedEol: false },
        text: 'Recovered draft', updatedAt: Date.now(),
      });
      void controller.start({ kind: 'file', file });
    });
    await expect(page.getByRole('alertdialog')).toContainText('file on disk has changed');
    await page.getByRole('button', { name: 'Restore Edits' }).click();
    await expect.poll(() => docText(page)).toBe('Recovered draft');
    await expect(page.getByRole('button', { name: /changed on disk.*Retry save/ })).toBeVisible();
    expect(await diskGet(page, '/sample/inline.md')).toBe('Newer disk');
  });

  test('Escape leaves the recovery copy available for a later launch', async ({ page }) => {
    await openApp(page, { doc: 'none' });
    await page.evaluate(async () => {
      const { platform, controller } = (window as any).__scrivo;
      await platform.recovery.put({ id: crypto.randomUUID(), path: null, stamp: null,
        format: { eol: '\n', bom: false, mixedEol: false }, text: 'keep me', updatedAt: Date.now() });
      void controller.start({ kind: 'none' });
    });
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const copies = await page.evaluate(() => (window as any).__scrivo.platform.recovery.list());
    expect(copies.map((copy: { text: string }) => copy.text)).toEqual(['keep me']);
  });
});
