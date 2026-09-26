import { expect, test } from '@playwright/test';
import { diskGet, diskPut, docText, focusWindow, openApp } from './helpers';

test.describe('external change on disk', () => {
  test('a clean document reloads silently', async ({ page }) => {
    const text = 'Original.';
    await openApp(page, { text });

    await diskPut(page, '/sample/inline.md', 'Changed elsewhere.');
    await focusWindow(page);

    expect(await docText(page)).toBe('Changed elsewhere.');
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  });

  test('a dirty document shows the "changed on disk" modal', async ({ page }) => {
    const text = 'Original.';
    await openApp(page, { text });
    await page.click('.cm-content');
    await page.keyboard.type(' Mine.');

    await diskPut(page, '/sample/inline.md', 'Changed elsewhere.');
    await focusWindow(page);

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('changed on disk');
  });

  test('"Keep Mine" keeps local edits', async ({ page }) => {
    const text = 'Original.';
    await openApp(page, { text });
    await page.click('.cm-content');
    await page.keyboard.type(' Mine.');

    await diskPut(page, '/sample/inline.md', 'Changed elsewhere.');
    await focusWindow(page);
    await page.click('[data-choice=keep]');

    expect(await docText(page)).toBe('Original. Mine.');
  });

  test('"Reload" discards local edits and adopts the disk version', async ({ page }) => {
    const text = 'Original.';
    await openApp(page, { text });
    await page.click('.cm-content');
    await page.keyboard.type(' Mine.');

    await diskPut(page, '/sample/inline.md', 'Changed elsewhere.');
    await focusWindow(page);
    await page.click('[data-choice=reload]');
    await page.waitForTimeout(20);

    expect(await docText(page)).toBe('Changed elsewhere.');
  });
});
