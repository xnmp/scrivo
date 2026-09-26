import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test.describe('find', () => {
  test('Ctrl+F opens the search panel and highlights matches', async ({ page }) => {
    const text = 'apple banana apple cherry apple';
    await openApp(page, { text });
    await page.click('.cm-content');

    await page.keyboard.press('Control+f');
    const panel = page.locator('.cm-search');
    await expect(panel).toBeVisible();

    const input = panel.locator('input[name=search]');
    await input.pressSequentially('apple'); // the panel commits on keyup, not on a plain value set

    const matches = page.locator('.cm-searchMatch');
    await expect(matches).toHaveCount(3);
  });
});
