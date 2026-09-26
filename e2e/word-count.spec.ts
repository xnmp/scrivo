import { expect, test } from '@playwright/test';
import { openApp, statusBarText } from './helpers';

test.describe('word count', () => {
  test('the status bar shows the count and updates (debounced) after typing', async ({ page }) => {
    const text = 'one two three';
    await openApp(page, { text });
    await expect.poll(() => statusBarText(page)).toContain('3 words');

    await page.click('.cm-content');
    await page.keyboard.press('End');
    await page.keyboard.type(' four');

    // Debounced ~300ms: should not have updated immediately.
    expect(await statusBarText(page)).toContain('3 words');

    await expect.poll(() => statusBarText(page), { timeout: 2000 }).toContain('4 words');
  });
});
