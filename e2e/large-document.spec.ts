import { expect, test } from '@playwright/test';
import { generateLargeDoc, lineText, nextFrame, openApp } from './helpers';

test.describe('large document performance', () => {
  test('reset + first paint stays fast, and the tail renders after scrolling', async ({ page }) => {
    await openApp(page, { doc: 'none' });
    const big = generateLargeDoc(400); // ~ tens of thousands of lines

    const start = Date.now();
    await page.evaluate((text) => (window as any).__scrivo.editor.port.reset(text, '/big.md'), big);
    await nextFrame(page);
    const elapsed = Date.now() - start;

    expect(await lineText(page, 0)).toBe('Section 0');
    expect(elapsed).toBeLessThan(2000);

    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await expect(page.locator('.cm-content')).toContainText('Section 399');
  });
});
