import { expect, test } from '@playwright/test';
import { docText, openApp, setCaret } from './helpers';

test.describe('task checkbox', () => {
  test('clicking toggles the source marker, undo restores it', async ({ page }) => {
    const text = '- [ ] task one\n- [x] task two';
    await openApp(page, { text });
    await setCaret(page, 0); // caret away from either checkbox line's text

    const boxes = page.locator('.cm-lp-checkbox');
    await expect(boxes).toHaveCount(2);
    expect(await boxes.nth(0).isChecked()).toBe(false);
    expect(await boxes.nth(1).isChecked()).toBe(true);

    await boxes.nth(0).click();
    expect(await docText(page)).toBe('- [x] task one\n- [x] task two');

    await page.keyboard.press('Control+z');
    expect(await docText(page)).toBe(text);
  });
});
