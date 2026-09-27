import { expect, test } from '@playwright/test';
import { diskGet, diskPut, docText, focusWindow, openApp, pushSaveAnswer, statusBarText } from './helpers';

test.describe('durable editing', () => {
  test('a named file saves after an editing pause and shows the completed state', async ({ page }) => {
    await openApp(page, { text: 'Start' });
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' here');
    await expect.poll(() => statusBarText(page)).toContain('Edited');
    expect(await diskGet(page, '/sample/inline.md')).toBe('Start');
    await expect.poll(() => diskGet(page, '/sample/inline.md'), { timeout: 5000 }).toBe('Start here');
    await expect.poll(() => statusBarText(page)).toContain('Saved');
  });

  test('a failed autosave leaves a visible retry action that saves the buffer', async ({ page }) => {
    await openApp(page, { text: 'Start' });
    await page.evaluate(() => {
      const { platform } = (window as any).__scrivo;
      platform.disk.failNextWrite(new Error('disk full'));
    });
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' here');
    const retry = page.getByRole('button', { name: /Could not save.*Retry save/ });
    await expect(retry).toBeVisible({ timeout: 5000 });
    expect(await diskGet(page, '/sample/inline.md')).toBe('Start');
    expect(await docText(page)).toBe('Start here');
    await retry.click();
    await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe('Start here');
    await expect.poll(() => statusBarText(page)).toContain('Saved');
  });

  test('an external edit stops autosave until the user saves their buffer elsewhere', async ({ page }) => {
    await openApp(page, { text: 'Start' });
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' mine');
    await diskPut(page, '/sample/inline.md', 'Theirs');
    await focusWindow(page);
    await page.getByRole('button', { name: 'Keep Mine' }).click();
    await expect(page.getByRole('button', { name: /changed on disk.*Retry save/ })).toBeVisible();
    await page.waitForTimeout(2200);
    expect(await diskGet(page, '/sample/inline.md')).toBe('Theirs');
    await pushSaveAnswer(page, '/sample/mine.md');
    await page.getByRole('button', { name: /changed on disk.*Retry save/ }).click();
    await page.getByRole('button', { name: 'Save Elsewhere' }).click();
    await expect.poll(() => diskGet(page, '/sample/mine.md')).toBe('Start mine');
    expect(await diskGet(page, '/sample/inline.md')).toBe('Theirs');
  });
});
