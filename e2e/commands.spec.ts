import { expect, test } from '@playwright/test';
import { diskGet, diskPut, docText, openApp, pushSaveAnswer, setCaret } from './helpers';
test('Ctrl T creates an independent tab and Ctrl R opens the chosen recent document', async ({ page }) => {
  await openApp(page, { text: '# Original\n\nBody', mode: 'view' });
  await page.keyboard.press('Control+t');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeFocused();
  await page.keyboard.type('New tab content');
  await pushSaveAnswer(page, '/sample/new.md'); await page.keyboard.press('Control+s');
  await expect.poll(() => diskGet(page, '/sample/new.md')).toBe('New tab content');
  await page.keyboard.press('Control+w'); await expect(page.getByRole('tab')).toHaveCount(1);
  await page.keyboard.press('Control+r');
  await page.getByRole('combobox', { name: 'Search recent files' }).fill('new.md');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.document-session:not([hidden]) .markdown-body')).toContainText('New tab content');
  await page.keyboard.press('Control+r'); await page.getByRole('combobox').fill('new.md'); await page.keyboard.press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(2);
});
test('palette formatting changes Markdown and supports undo after closing the picker', async ({ page }) => {
  await openApp(page, { text: 'Word' }); await setCaret(page, 0);
  await page.keyboard.press('Control+p'); await page.getByRole('combobox', { name: 'Search commands' }).fill('heading 2');
  await page.keyboard.press('Enter'); await expect.poll(() => docText(page)).toBe('## Word');
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeFocused();
  await page.keyboard.press('Control+z'); await expect.poll(() => docText(page)).toBe('Word');
  await page.keyboard.press('Control+Shift+z'); await expect.poll(() => docText(page)).toBe('## Word');
  await page.keyboard.press('Control+Shift+t'); await expect.poll(() => docText(page)).toContain('| Column 1 |');
  await expect(page.getByRole('tab')).toHaveCount(1);
});
test('custom hotkeys replace defaults, reject conflicts, persist and can be reset', async ({ page }) => {
  await openApp(page, { text: 'Body' });
  await page.keyboard.press('Control+p'); await page.getByRole('combobox').fill('customize hotkeys'); await page.keyboard.press('Enter');
  await page.getByRole('searchbox', { name: 'Search hotkeys' }).fill('New tab');
  await page.getByRole('button', { name: 'Remove Ctrl+T from New tab', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Ctrl+N from New tab', exact: true }).click();
  await page.getByRole('button', { name: 'Add hotkey for New tab', exact: true }).click(); await page.keyboard.press('Control+s');
  await expect(page.getByRole('dialog', { name: 'Hotkeys' })).toContainText('assigned to “Save”');
  await page.keyboard.press('Control+Alt+j'); await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Control+t'); await expect(page.getByRole('tab')).toHaveCount(1);
  await page.keyboard.press('Control+Alt+j'); await expect(page.getByRole('tab')).toHaveCount(2);
  await page.reload(); await page.waitForFunction(() => Boolean((window as any).__scrivo));
  await page.keyboard.press('Control+Alt+j'); await expect(page.getByRole('tab')).toHaveCount(2);
  await page.keyboard.press('Control+p'); await page.getByRole('combobox').fill('customize hotkeys'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Restore default hotkeys' }).click(); await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Control+t'); await expect(page.getByRole('tab')).toHaveCount(3);
});
test('bundled palettes are immediately available and restore before reading after reload', async ({ page }) => {
  await openApp(page, { text: '# Theme', mode: 'view' }); await page.keyboard.press('Control+,');
  await page.getByLabel('Theme', { exact: true }).selectOption('builtin:ember'); await page.getByLabel('Color scheme', { exact: true }).selectOption('dark');
  await expect(page.getByRole('button', { name: 'Remove theme' })).toBeDisabled();
  await expect(page.locator('#document h1')).toHaveCSS('color', 'rgb(255, 146, 28)');
  await page.reload(); await expect(page.locator('#document h1')).toHaveCSS('color', 'rgb(255, 146, 28)');
  await page.keyboard.press('Control+,'); await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('builtin:ember');
});

test('palette find keeps focus in the search field and selection navigation works', async ({ page }) => {
  await openApp(page, { text: '# Note\n\nTarget and Target', mode: 'view' });
  await page.keyboard.press('Control+p'); await page.getByRole('combobox').fill('find…');
  await page.keyboard.press('Enter'); await expect(page.getByRole('textbox', { name: 'Find in document' })).toBeFocused();
  await page.keyboard.type('Target'); await expect(page.locator('.find-count')).toContainText('of 2');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+r'); await page.getByRole('button', { name: 'Clear recent files', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Open recent' })).toContainText('No recent files yet');
  await page.keyboard.press('Escape'); await page.keyboard.press('Control+r');
  await expect(page.getByRole('dialog', { name: 'Open recent' })).toContainText('No recent files yet');
});
test('unassigning source and code-block hotkeys leaves Markdown and properties unsaved', async ({ page }) => {
  const text = '---\ntitle: Old\n---\n# Content\n';
  await openApp(page, { text });
  await page.evaluate(() => localStorage.setItem('scrivo.hotkeys.v1', JSON.stringify({ source: [], codeBlock: [], save: [] })));
  await page.reload(); await page.waitForFunction(() => Boolean((window as any).__scrivo));
  await setCaret(page, text.length); await page.keyboard.press('Control+Shift+k'); await page.keyboard.press('Control+/');
  expect(await docText(page)).toBe(text);
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByLabel('New property name').fill('draft'); await page.getByLabel('New property value').fill('Pending');
  await page.keyboard.press('Control+p'); await page.getByRole('combobox').fill('document properties'); await page.keyboard.press('Enter');
  await expect(page.getByLabel('New property name')).toHaveValue('draft');
  await page.keyboard.press('Control+s'); expect(await docText(page)).toBe(text);
});

test('grouped menus support keyboard navigation and execute the selected command', async ({ page }) => {
  await openApp(page, { text: '# Menu', mode: 'view' });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.getByRole('menuitem', { name: 'New tab', exact: false }).click();
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeFocused();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Appearance…', exact: false }).first().click();
  await expect(page.getByRole('dialog', { name: 'Appearance', exact: true })).toBeVisible();
});
