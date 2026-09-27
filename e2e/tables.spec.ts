import { expect, test } from '@playwright/test';
import { diskGet, docText, openApp, setCaret } from './helpers';

test.describe('tables', () => {
  const text = [
    '| Name | Score |',
    '| :--- | ----: |',
    '| Ann  | 10    |',
    '| Bo   | 20    |',
    '',
    'After the table.',
  ].join('\n');

  test('renders as a table when the caret is elsewhere', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length); // in "After the table."

    const table = page.locator('.cm-lp-table');
    await expect(table).toBeVisible();
    expect(await table.locator('th').allInnerTexts()).toEqual(['Name', 'Score']);
    expect(await table.locator('tbody tr').count()).toBe(2);
    expect((await table.locator('tbody tr').nth(0).locator('td').allInnerTexts())).toEqual(['Ann', '10']);
  });

  test('editing a cell keeps the table visible and changes the Markdown source', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);

    await page.locator('.cm-lp-table td').nth(0).click(); // "Ann"
    const input = page.locator('.cm-lp-table-input');
    await expect(input).toBeFocused();
    await input.fill('Ana|Maria');
    await expect(page.locator('.cm-lp-table')).toBeVisible();
    expect(await docText(page)).toContain('| Ana\\|Maria  | 10    |');
    await page.keyboard.press('Tab');
    await expect(page.locator('.cm-lp-table td').nth(1).locator('input')).toBeFocused();
    await page.keyboard.type('25');
    expect(await docText(page)).toContain('| Ana\\|Maria  | 25    |');
  });

  test('Tab and Enter traverse cells and add a row at the end', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await page.locator('.cm-lp-table td').last().click();
    await page.keyboard.press('Tab');
    await expect(page.locator('.cm-lp-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.cm-lp-table tbody tr').last().locator('td').first().locator('input')).toBeFocused();
    await page.keyboard.type('Cy');
    expect(await docText(page)).toContain('| Cy |  |');
    await page.keyboard.press('Enter');
    await expect(page.locator('.cm-lp-table tbody tr')).toHaveCount(4);
    await expect(page.locator('.cm-lp-table tbody tr').last().locator('td').first().locator('input')).toBeFocused();
  });

  test('the table menu inserts and deletes rows and columns in one undoable edit', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await page.locator('.cm-lp-table tbody tr').first().locator('td').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert row below' }).click();
    await expect(page.locator('.cm-lp-table tbody tr')).toHaveCount(3);
    expect(await docText(page)).toContain('| Ann  | 10    |\n|  |  |\n| Bo');

    await page.locator('.cm-lp-table th').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert column right' }).click();
    await expect(page.locator('.cm-lp-table th')).toHaveCount(3);
    expect(await docText(page)).toContain('| Name |  | Score |\n| :--- | --- | ----: |');

    await page.locator('.cm-lp-table th').nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete column' }).click();
    await expect(page.locator('.cm-lp-table th')).toHaveCount(2);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => document.activeElement?.outerHTML)).toContain('data-col="1"');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await docText(page)).toContain('| Name |  | Score |');
    await expect(page.locator('.cm-lp-table th')).toHaveCount(3);
  });

  test('save and undo work while a cell input has focus', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await page.locator('.cm-lp-table td').first().click();
    await page.locator('.cm-lp-table-input').fill('Alex');
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => diskGet(page, '/sample/inline.md')).toContain('| Alex  | 10');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await docText(page)).toContain('| Ann  | 10');
  });

  test('an external cell change replaces a stale input without restoring its old value', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await page.locator('.cm-lp-table td').first().click();
    await page.locator('.cm-lp-table-input').fill('Alex');
    await page.evaluate(() => {
      const view = (window as any).__scrivo.editor.view;
      const from = view.state.doc.toString().indexOf('Alex');
      view.dispatch({ changes: { from, to: from + 4, insert: 'Zoe' }, userEvent: 'input.external' });
    });
    await expect(page.locator('.cm-lp-table-input')).toHaveCount(0);
    await expect(page.locator('.cm-lp-table td').first()).toHaveText('Zoe');
    expect(await docText(page)).toContain('| Zoe  | 10');
  });

  test('a compact row stays a table when a cell ends in a backslash', async ({ page }) => {
    const compact = '| A | B |\n| --- | --- |\n|Ann|10|\n\nEnd';
    await openApp(page, { text: compact });
    await setCaret(page, compact.length);
    await page.locator('.cm-lp-table td').first().click();
    await page.locator('.cm-lp-table-input').fill('abc\\');
    await expect(page.locator('.cm-lp-table td')).toHaveCount(2);
    expect(await docText(page)).toContain('|abc\\ |10|');
  });

  test('a keyboard menu action returns focus to the table', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await page.locator('.cm-lp-table tbody tr').first().locator('td').first().focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Insert row below' }).click();
    await expect(page.locator('.cm-lp-table tbody tr').nth(1).locator('td').first()).toBeFocused();
  });

  test('leaving the table menu with Tab closes it', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await page.locator('.cm-lp-table tbody tr').first().locator('td').first().focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'Table actions' })).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('menu', { name: 'Table actions' })).toHaveCount(0);
  });
});
