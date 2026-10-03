import { expect, test } from '@playwright/test';
import { diskGet, docText, openApp } from './helpers';

test('untitled Ctrl S uses the app modal, validates, cancels and saves; named save is direct', async ({ page }) => {
  await openApp(page, { doc: 'none' }); await page.keyboard.type('New content');
  await page.keyboard.press('Control+s');
  const dialog = page.getByRole('dialog', { name: 'Save document', exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('File name')).toBeFocused();
  await dialog.getByLabel('Folder').fill('relative'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('absolute');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  expect(await docText(page)).toBe('New content'); expect(await diskGet(page, '/sample/Untitled.md')).toBeUndefined();
  await page.keyboard.press('Control+s'); await dialog.getByLabel('File name').fill('my notes.md');
  await dialog.getByLabel('Folder').fill('/sample'); await page.keyboard.press('Enter');
  await expect.poll(() => diskGet(page, '/sample/my notes.md')).toBe('New content');
  await expect(dialog).toHaveCount(0); await page.keyboard.type('!'); await page.keyboard.press('Control+s');
  await expect.poll(() => diskGet(page, '/sample/my notes.md')).toBe('New content!');
  await expect(dialog).toHaveCount(0);
});

test('app Save As retains guarded overwrite cancellation', async ({ page }) => {
  await openApp(page, { text: 'Original' }); await page.keyboard.press('Control+Shift+s');
  const dialog = page.getByRole('dialog', { name: 'Save document', exact: true });
  await dialog.getByLabel('File name').fill('welcome.md'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await diskGet(page, '/sample/inline.md')).toBe('Original'); expect(await diskGet(page, '/sample/welcome.md')).not.toBe('Original');
});
