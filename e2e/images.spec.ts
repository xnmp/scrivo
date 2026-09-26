import { expect, test } from '@playwright/test';
import { docText, openApp, setCaret } from './helpers';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.describe('images', () => {
  test('a data: URL image renders an <img>', async ({ page }) => {
    const text = `![alt text](${TINY_PNG})\n\nSome other paragraph.`;
    await openApp(page, { text });
    await setCaret(page, text.length); // caret elsewhere: image is replaced by the widget

    const img = page.locator('img.cm-lp-image');
    await expect(img).toHaveCount(1);
    expect(await img.getAttribute('src')).toBe(TINY_PNG);
  });

  test('a relative image path in an untitled document shows the missing placeholder', async ({ page }) => {
    // ?doc=none starts a genuinely untitled document (path null), so relative paths
    // can't be resolved against a document directory.
    await openApp(page, { doc: 'none' });
    await page.click('.cm-content');
    await page.keyboard.type('x ![alt text](relative/pic.png)');
    expect(await docText(page)).toBe('x ![alt text](relative/pic.png)');
    await page.keyboard.press('Home'); // caret before "x", well outside the image span

    const missing = page.locator('.cm-lp-image-missing');
    await expect(missing).toHaveCount(1);
    expect(await missing.innerText()).toBe('alt text');
    await expect(page.locator('img.cm-lp-image')).toHaveCount(0);
  });
});
