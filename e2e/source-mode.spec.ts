import { expect, test } from '@playwright/test';
import { lineText, openApp, setCaret } from './helpers';

test.describe('source mode', () => {
  test('Ctrl+/ shows raw markdown and toggles back', async ({ page }) => {
    const text = '# Title\n\nBody.';
    await openApp(page, { text });
    await setCaret(page, text.length);

    expect(await lineText(page, 0)).toBe('Title'); // live preview: marker hidden

    await page.keyboard.press('Control+/');
    expect(await lineText(page, 0)).toBe('# Title');
    await expect(page.locator('.cm-source-mode')).toHaveCount(1);

    await page.keyboard.press('Control+/');
    expect(await lineText(page, 0)).toBe('Title');
  });
});
