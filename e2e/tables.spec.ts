import { expect, test } from '@playwright/test';
import { docText, openApp, setCaret } from './helpers';

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

  test('clicking a cell reveals the source row with the caret in that cell, and typing edits it', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);

    await page.locator('.cm-lp-table td').nth(0).click(); // "Ann"
    // The table widget is gone; the raw row is now an editable .cm-line.
    await expect(page.locator('.cm-lp-table')).toHaveCount(0);
    const current = await docText(page);
    expect(current).toContain('| Ann  | 10    |');

    await page.keyboard.type('X');
    const updated = await docText(page);
    expect(updated).toContain('AnnX');
    expect(updated).not.toContain('| Ann  | 10    |');
  });
});
