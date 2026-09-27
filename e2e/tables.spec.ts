import { expect, test } from '@playwright/test';
import { controllerOpen, diskGet, docText, openApp, setCaret } from './helpers';

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

  test('clicking within a cell places a text caret instead of selecting its contents', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    const cell = page.locator('.cm-lp-table td').first();
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width - 5, box!.y + box!.height / 2);
    const input = page.locator('.cm-lp-table-input');
    await expect(input).toBeFocused();
    expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd]))
      .toEqual([3, 3]);
    await page.keyboard.type('!');
    expect(await docText(page)).toContain('| Ann!  | 10');
  });

  test('clicking formatted cell text does not place the caret inside hidden Markdown syntax', async ({ page }) => {
    const linked = '| Name | Score |\n| --- | --- |\n| [click me](https://example.com/long/path) | 10 |\n\nEnd';
    await openApp(page, { text: linked });
    await setCaret(page, linked.length);
    const cell = page.locator('.cm-lp-table td').first();
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width - 5, box!.y + box!.height / 2);
    await page.keyboard.type('!');
    expect(await docText(page)).toContain('| [click me](https://example.com/long/path)! | 10 |');
  });

  test('arrow keys and typing move through focused cells while Escape leaves the cell selected', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    const first = page.locator('.cm-lp-table tbody tr').first().locator('td').first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    const score = page.locator('.cm-lp-table tbody tr').first().locator('td').nth(1);
    await expect(score).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const nextScore = page.locator('.cm-lp-table tbody tr').nth(1).locator('td').nth(1);
    await expect(nextScore).toBeFocused();
    await page.keyboard.type('3');
    expect(await docText(page)).toContain('| Bo   | 3    |');
    await page.keyboard.press('Escape');
    await expect(nextScore).toBeFocused();
    await expect(page.locator('.cm-lp-table-input')).toHaveCount(0);
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

  test('pasting spreadsheet cells expands rows and columns in one undoable edit', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await page.locator('.cm-lp-table tbody td').first().click();
    await page.evaluate(() => {
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'Ana\t25\tA|B\nCy\t30\tlast\nDee\t40\tend\n');
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    });
    await expect(page.locator('.cm-lp-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.cm-lp-table th')).toHaveCount(3);
    await expect(page.locator('.cm-lp-table tbody tr').last().locator('td').last().locator('input')).toHaveValue('end');
    const pasted = await docText(page);
    await setCaret(page, pasted.length);
    expect(await page.locator('.cm-lp-table tbody td').allInnerTexts()).toEqual([
      'Ana', '25', 'A|B', 'Cy', '30', 'last', 'Dee', '40', 'end',
    ]);
    expect(pasted).toContain('| Ana | 25 | A\\|B |');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await docText(page)).toBe(text);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await docText(page)).toBe(pasted);
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(pasted);
    await controllerOpen(page, '/sample/inline.md');
    await setCaret(page, pasted.length);
    await expect(page.locator('.cm-lp-table tbody tr')).toHaveCount(3);
  });

  test('cell-edge arrows and Tab on a selected cell continue table editing', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    const first = page.locator('.cm-lp-table tbody tr').first().locator('td').first();
    await first.click();
    const input = page.locator('.cm-lp-table-input');
    await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(element.value.length, element.value.length));
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.cm-lp-table tbody tr').first().locator('td').nth(1).locator('input')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(page.locator('.cm-lp-table tbody tr').nth(1).locator('td').first().locator('input')).toBeFocused();
    await page.keyboard.press('Shift+Enter');
    await expect(first.locator('input')).toBeFocused();
    await page.locator('.cm-lp-table th').nth(1).click();
    await page.keyboard.press('Shift+Enter');
    await expect(page.locator('.cm-lp-table th').nth(1).locator('input')).toBeFocused();
    expect(await docText(page)).toBe(text);
  });

  test('pasting into a selected cell writes to Markdown without opening an input first', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await page.locator('.cm-lp-table tbody td').first().focus();
    await page.evaluate(() => {
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'Alex');
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    });
    await expect(page.locator('.cm-lp-table tbody td').first().locator('input')).toHaveValue('Alex');
    expect(await docText(page)).toContain('| Alex  | 10');
  });

  test('oversized grid paste is rejected without corrupting Markdown', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    const cell = page.locator('.cm-lp-table tbody td').first();
    await cell.focus();
    const paste = async () => page.evaluate(() => {
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'a\tb\n'.repeat(10_001));
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    });
    await paste();
    await expect(page.getByText('Could not paste table cells: grid too large, or a cell contains tabs or line breaks.')).toBeVisible();
    expect(await docText(page)).toBe(text);
    await cell.click();
    await paste();
    expect(await docText(page)).toBe(text);
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

  test('table actions move rows and columns, sort numbers, and align a column', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    const rows = page.locator('.cm-lp-table tbody tr');
    await rows.nth(1).locator('td').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move row up' }).click();
    expect(await docText(page)).toContain('| Bo   | 20    |\n| Ann  | 10    |');

    await page.locator('.cm-lp-table th').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move column right' }).click();
    expect(await docText(page)).toContain('| Score | Name |\n| ----: | :--- |');

    await page.locator('.cm-lp-table th').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Align center' }).click();
    expect(await docText(page)).toContain('| Score | Name |\n| :----: | :--- |');

    await page.locator('.cm-lp-table th').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Sort ascending' }).click();
    expect(await docText(page)).toContain('| 10 | Ann |\n| 20 | Bo |');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await docText(page)).toContain('| 20 | Bo |\n| 10 | Ann |');
    expect(await docText(page)).toContain('| :----: | :--- |');
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    expect(await docText(page)).toContain('| 10 | Ann |\n| 20 | Bo |');
    const saved = await docText(page);
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(saved);
    await controllerOpen(page, '/sample/inline.md');
    await setCaret(page, saved.length);
    expect(await page.locator('.cm-lp-table tbody td').allInnerTexts()).toEqual(['10', 'Ann', '20', 'Bo']);
  });

  test('sorting an already sorted table does not mark the document edited', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);
    await expect(page.locator('.save-status')).toContainText('Saved');
    await page.locator('.cm-lp-table th').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Sort ascending' }).click();
    await expect(page.locator('.save-status')).toContainText('Saved');
    expect(await docText(page)).toBe(text);
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

  test('a long cell remains editable and saves without changing adjacent cells', async ({ page }) => {
    const long = 'a'.repeat(20_000);
    const source = `| Name | Score |\n| --- | --- |\n| ${long} | 10 |\n\nEnd`;
    await openApp(page, { text });
    await page.evaluate((value) => {
      const view = (window as any).__scrivo.editor.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }, source);
    await setCaret(page, source.length);
    await page.locator('.cm-lp-table td').first().click({ position: { x: 10, y: 10 } });
    await page.keyboard.type('!');
    const edited = await docText(page);
    expect(edited.length).toBe(source.length + 1);
    expect(edited).toContain('| 10 |');
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(edited);
  });

  test('a malformed delimiter stays editable as Markdown source', async ({ page }) => {
    const malformed = '| A | B |\n| --- | broken |\n| one | two |\n\nEnd';
    await openApp(page, { text: malformed });
    await setCaret(page, malformed.length);
    await expect(page.locator('.cm-lp-table')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(malformed);
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
