import { expect, test } from '@playwright/test';
import { openApp, setCaret } from './helpers';

test.describe('math', () => {
  test('inline math renders via KaTeX and reveals source when the caret enters', async ({ page }) => {
    const text = 'Energy $x^2$ here.';
    await openApp(page, { text });
    await setCaret(page, text.length);

    await expect(page.locator('.katex')).toBeVisible({ timeout: 10_000 });

    await setCaret(page, text.indexOf('x^2'));
    await expect(page.locator('.cm-lp-math-src')).toBeVisible();
    await expect(page.locator('.katex')).toHaveCount(0);
  });

  test('block math renders via KaTeX after lazy load', async ({ page }) => {
    const text = 'Before.\n\n$$\nx^2 + 1\n$$\n\nAfter.';
    await openApp(page, { text });
    await setCaret(page, text.length);

    await expect(page.locator('.katex')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cm-lp-math-display')).toBeVisible();
  });
});
