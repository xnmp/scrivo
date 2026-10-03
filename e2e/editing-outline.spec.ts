import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openSettings, runCommand, diskPut, docText, openApp } from './helpers';

test('editing Contents excludes code and YAML and navigates the current source', async ({ page }) => {
  const text = '---\ntitle: Hello\n# Comment\n---\n# First\n\n```md\n# Code\n```\n\n## Last\nEnd\n';
  await openApp(page, { text });
  await runCommand(page, 'Toggle contents');
  await expect(page.locator('.outline-panel button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Heading level 2: Last', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__scrivo.editor.view.state.selection.main.head)).toBe(text.indexOf('## Last'));
  await expect(page.locator('.cm-content')).toBeFocused();
  expect(await docText(page)).toBe(text);
  await page.keyboard.press('Control+/');
  await expect(page.locator('.cm-source-mode')).toBeVisible();
  const changed = text.replace('# First', '# Renamed');
  await page.evaluate((value) => (window as any).__scrivo.editor.port.replace(value), changed);
  await expect(page.getByRole('button', { name: 'Heading level 1: Renamed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Heading level 2: Last', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__scrivo.editor.view.state.selection.main.head)).toBe(changed.indexOf('## Last'));
});

test('editing Contents reaches headings beyond a large document viewport', async ({ page }) => {
  test.setTimeout(60_000);
  const text = readFileSync(new URL('../bench/fixtures/large.md', import.meta.url), 'utf8') + '\n# Worker index tail\n';
  await openApp(page, { mode: 'view' });
  await diskPut(page, '/sample/large.md', text);
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/large.md'));
  await page.keyboard.press('Control+e');
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeVisible();
  await runCommand(page, 'Toggle contents');
  await page.getByRole('button', { name: 'Heading level 1: Worker index tail', exact: true }).click();
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toContainText('Worker index tail');
  expect(await page.evaluate(() => (window as any).__scrivo.editor.view.state.selection.main.head)).toBe(text.lastIndexOf('# Worker index tail'));
  await page.getByRole('tab', { name: 'welcome.md', exact: true }).click();
  await runCommand(page, 'Toggle contents');
  await expect(page.getByRole('button', { name: 'Heading level 1: Worker index tail', exact: true })).toHaveCount(0);
});
