import { expect, test } from '@playwright/test';
import { diskGet, docText, openApp } from './helpers';

async function startClose(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as any).__closeResult = (window as any).__scrivo.platform.requestClose();
  });
  await page.waitForSelector('.modal-backdrop');
}

async function readCloseResult(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__closeResult);
}

test.describe('closing with unsaved changes', () => {
  test('Cancel keeps the window open and the text intact', async ({ page }) => {
    const text = 'Hello.';
    await openApp(page, { text });
    await page.click('.cm-content');
    await page.keyboard.type(' Dirty.');

    await startClose(page);
    await page.click('[data-choice=cancel]');

    expect(await readCloseResult(page)).toBe(false);
    expect(await docText(page)).toBe('Hello. Dirty.');
    expect(await page.evaluate(() => (window as any).__scrivo.platform.destroyed)).toBe(false);
  });

  test("Don't Save closes without writing", async ({ page }) => {
    const text = 'Hello.';
    await openApp(page, { text });
    await page.click('.cm-content');
    await page.keyboard.type(' Dirty.');

    await startClose(page);
    await page.click('[data-choice=discard]');

    expect(await readCloseResult(page)).toBe(true);
    expect(await diskGet(page, '/sample/inline.md')).toBe(text);
    expect(await page.evaluate(() => (window as any).__scrivo.platform.destroyed)).toBe(true);
  });

  test('Save writes then closes', async ({ page }) => {
    const text = 'Hello.';
    await openApp(page, { text });
    await page.click('.cm-content');
    await page.keyboard.type(' Dirty.');

    await startClose(page);
    await page.click('[data-choice=save]');
    await page.waitForTimeout(50);

    expect(await readCloseResult(page)).toBe(true);
    expect(await diskGet(page, '/sample/inline.md')).toBe('Hello. Dirty.');
    expect(await page.evaluate(() => (window as any).__scrivo.platform.destroyed)).toBe(true);
  });

  test('Escape behaves as Cancel', async ({ page }) => {
    const text = 'Hello.';
    await openApp(page, { text });
    await page.click('.cm-content');
    await page.keyboard.type(' Dirty.');

    await startClose(page);
    await page.keyboard.press('Escape');

    expect(await readCloseResult(page)).toBe(false);
    expect(await page.evaluate(() => (window as any).__scrivo.platform.destroyed)).toBe(false);
  });
});
