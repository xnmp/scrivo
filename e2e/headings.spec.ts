import { expect, test } from '@playwright/test';
import { docText, openApp, setCaret } from './helpers';

test.describe('heading prefix is atomic', () => {
  test('Backspace at the start of the visible text removes the hidden "# " as a unit', async ({ page }) => {
    const text = '# Title\n\nBody.';
    await openApp(page, { text });
    await setCaret(page, 2); // right after the hidden "# ", start of "Title"
    await page.keyboard.press('Backspace');
    expect(await docText(page)).toBe('Title\n\nBody.');
  });
});
