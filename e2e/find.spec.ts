import { expect, test } from '@playwright/test';
import { controllerOpen, diskGet, docText, openApp } from './helpers';

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

  test('replace all changes the saved source, undo restores it, and reopening shows the replacement', async ({ page }) => {
    const original = '# Search\n\nParent and Parent\n\nOther\n';
    await openApp(page, { text: original });
    await page.keyboard.press('Control+h');
    const panel = page.locator('.cm-search');
    await panel.locator('input[name=search]').pressSequentially('Parent');
    await panel.locator('input[name=replace]').pressSequentially('Root');
    await panel.locator('button[name=replaceAll]').click();
    const replaced = original.replaceAll('Parent', 'Root');
    expect(await docText(page)).toBe(replaced);
    await page.evaluate(() => (window as any).__scrivo.editor.view.focus());
    await page.keyboard.press('Control+z');
    expect(await docText(page)).toBe(original);
    await page.keyboard.press('Control+Shift+z');
    expect(await docText(page)).toBe(replaced);
    await page.keyboard.press('Control+s');
    await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(replaced);
    await controllerOpen(page, '/sample/inline.md');
    await expect(page.locator('.cm-content')).toContainText('Root and Root');
    expect(await docText(page)).toBe(replaced);
  });
});
