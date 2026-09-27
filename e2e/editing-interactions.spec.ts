import { expect, test } from '@playwright/test';
import { ControlOrMeta, controllerOpen, diskGet, docText, openApp, setCaret } from './helpers';

test.describe('Markdown editing interactions', () => {
  test('Enter exits an empty list and the saved source survives reopening', async ({ page }) => {
    const initial = '- first\n- ';
    await openApp(page, { text: initial });
    await setCaret(page, initial.length);
    await page.keyboard.press('Enter');
    expect(await docText(page)).toBe('- first\n');
    await page.keyboard.press(`${ControlOrMeta}+s`);
    await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe('- first\n');
    await controllerOpen(page, '/sample/inline.md');
    expect(await docText(page)).toBe('- first\n');
    await page.keyboard.press(`${ControlOrMeta}+/`);
    await expect(page.locator('.cm-source-mode')).toHaveCount(1);
    expect(await docText(page)).toBe('- first\n');
  });

  test('Tab indents selected list lines and undo restores their exact Markdown', async ({ page }) => {
    const initial = '- one\n- two';
    await openApp(page, { text: initial });
    await page.evaluate((length) => {
      const view = (window as any).__scrivo.editor.view;
      view.dispatch({ selection: { anchor: 0, head: length } });
      view.focus();
    }, initial.length);
    await page.keyboard.press('Tab');
    expect(await docText(page)).toBe('  - one\n  - two');
    await page.keyboard.press(`${ControlOrMeta}+z`);
    expect(await docText(page)).toBe(initial);
  });

  test('a typed closer skips an inserted bracket and Backspace removes an empty pair', async ({ page }) => {
    await openApp(page, { doc: 'none' });
    await page.locator('.cm-content').click();
    await page.keyboard.type('[note]');
    expect(await docText(page)).toBe('[note]');
    await page.keyboard.type(' (');
    expect(await docText(page)).toBe('[note] ()');
    await page.keyboard.press('Backspace');
    expect(await docText(page)).toBe('[note] ');
    await page.keyboard.type('`code`');
    expect(await docText(page)).toBe('[note] `code`');
  });

  test('fold controls hide a heading section and nested list without changing source', async ({ page }) => {
    const text = '# First\nbody\n## Child\ninside\n\n- parent\n  - child\n  - second\n\n# Next\nend';
    await openApp(page, { text });
    await setCaret(page, text.length);
    const firstFold = page.getByRole('button', { name: 'Fold heading First (line 1)' });
    await expect(firstFold).toBeVisible();
    await firstFold.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('body', { exact: true })).toHaveCount(0);
    expect(await docText(page)).toBe(text);
    const firstUnfold = page.getByRole('button', { name: 'Unfold heading First (line 1)' });
    await expect(firstUnfold).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('body', { exact: true })).toBeVisible();
    await expect(firstFold).toBeFocused();
    await page.getByRole('button', { name: 'Fold list parent (line 6)' }).click();
    await expect(page.getByText('second', { exact: true })).toHaveCount(0);
    await expect(page.getByText('body', { exact: true })).toBeVisible();
    expect(await docText(page)).toBe(text);
  });
});
