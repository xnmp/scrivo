import { expect, test } from '@playwright/test';
import { diskGet, diskPut, docText, openApp } from './helpers';

const original = '# Settings\n\n- Parent\n  - Child\n    - Grandchild\n\n\tIndented code\n\n' + 'Long line '.repeat(300) + '\n';

test('editor settings persist after reload and apply to all tabs without editing Markdown or history', async ({ page }) => {
  await openApp(page, { text: original });
  await page.getByRole('button', { name: 'Editor settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Line numbers', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Indentation guides', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Spellcheck', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Wrap long lines', exact: true }).uncheck();
  await page.getByLabel('Tab display width', { exact: true }).selectOption('8');
  await page.getByLabel('Tab display width', { exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Editor settings', exact: true })).toBeFocused();
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveAttribute('spellcheck', 'false');
  await expect(page.locator('.cm-content')).not.toHaveClass(/cm-lineWrapping/);
  await expect(page.locator('.cm-indent-guides').first()).toBeVisible();
  expect(await docText(page)).toBe(original);
  await page.evaluate(() => (window as any).__scrivo.editor.view.focus());
  await page.keyboard.press('Control+z');
  expect(await docText(page)).toBe(original);
  expect(await diskGet(page, '/sample/inline.md')).toBe(original);
  await diskPut(page, '/sample/second.md', original);
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  await page.keyboard.press('Control+e');
  await expect(page.locator('.document-session:not([hidden]) .cm-lineNumbers')).toBeVisible();
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toHaveAttribute('spellcheck', 'false');
  await page.getByRole('button', { name: 'Editor settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Line numbers', exact: true }).uncheck();
  await page.getByRole('tab', { name: 'inline.md', exact: true }).click();
  await expect(page.locator('.document-session:not([hidden]) .cm-lineNumbers')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.cm-content')).toHaveAttribute('spellcheck', 'false');
  await page.getByRole('button', { name: 'Editor settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Indentation guides', exact: true })).toBeChecked();
  await expect(page.getByLabel('Tab display width', { exact: true })).toHaveValue('8');
  expect(await docText(page)).toBe(original);
});

test('guides follow source indentation and settings preserve existing undo history', async ({ page }) => {
  await openApp(page, { text: original });
  await page.keyboard.press('Control+/');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Added');
  await page.getByRole('button', { name: 'Editor settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Indentation guides', exact: true }).check();
  const guide = page.locator('.cm-line.cm-indent-guides').filter({ hasText: 'Indented code' });
  await expect(guide).toHaveCSS('background-image', /repeating-linear-gradient/);
  await page.getByRole('checkbox', { name: 'Indentation guides', exact: true }).press('Escape');
  await page.evaluate(() => (window as any).__scrivo.editor.view.focus());
  await page.keyboard.press('Control+z');
  expect(await docText(page)).toBe(original);
});
