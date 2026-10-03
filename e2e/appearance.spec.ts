import { expect, test } from '@playwright/test';
import { openSettings, runCommand, docText, openApp } from './helpers';

test('appearance controls persist and apply to reading and editing without changing Markdown', async ({ page }) => {
  const original = '# Theme\n\nA paragraph.\n';
  await openApp(page, { text: original, mode: 'view' });
  await openSettings(page, 'Appearance');
  await page.getByLabel('Color scheme', { exact: true }).selectOption('dark');
  await page.getByLabel('Font size', { exact: true }).fill('20');
  await page.getByLabel('Font size', { exact: true }).press('Tab');
  await page.getByLabel('Text font', { exact: true }).fill('Georgia');
  await page.getByLabel('Text font', { exact: true }).press('Tab');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#document')).toHaveCSS('font-size', '20px');
  await expect(page.locator('#document')).toHaveCSS('font-family', 'Georgia');
  await page.keyboard.press('Control+n');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.keyboard.press('Control+e');
  await expect(page.locator('.cm-content')).toHaveCSS('font-size', '20px');
  await expect(page.locator('.cm-gutters')).toHaveCSS('border-right-width', '0px');
  expect(await docText(page)).toBe(original);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#document')).toHaveCSS('font-size', '20px');
});

test('imports Obsidian body variables, switches palettes, restores theme and resets it', async ({ page }) => {
  await openApp(page, { text: '# Imported\n\nBody', mode: 'view' });
  await openSettings(page, 'Appearance');
  await page.locator('.appearance-dialog input[type=file]').setInputFiles({
    name: 'Dusk.css', mimeType: 'text/css', buffer: Buffer.from('.theme-dark { --background-primary: #123456; --text-normal: #fedcba; --font-text-theme: Georgia; --h1-color: #aabbcc; } .theme-light { --background-primary: #abcdef; }'),
  });
  await page.getByLabel('Color scheme', { exact: true }).selectOption('dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(page.locator('#document')).toHaveCSS('color', 'rgb(254, 220, 186)');
  await expect(page.locator('#document')).toHaveCSS('font-family', 'Georgia');
  await expect(page.locator('#document h1')).toHaveCSS('color', 'rgb(170, 187, 204)');
  await page.getByLabel('Text font', { exact: true }).fill('monospace');
  await page.getByLabel('Text font', { exact: true }).press('Tab');
  await expect(page.locator('#document')).toHaveCSS('font-family', 'monospace');
  await page.getByLabel('Color scheme', { exact: true }).selectOption('light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(171, 205, 239)');
  await page.reload();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(171, 205, 239)');
  await page.keyboard.press('Control+,');
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue(/.+/);
  await page.keyboard.press('Control+Shift+Comma');
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toBeFocused();
});

test('system mode reacts to OS changes and appearance fits a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page, { mode: 'view' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openSettings(page, 'Appearance');
  const bounds = await page.getByRole('dialog', { name: 'Settings' }).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(await page.locator('.appearance-dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('a failed controls import preserves the document and reports recovery without an unhandled error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/assets/tab-window-*.js', (route) => route.abort());
  await page.goto('/?text=%23%20Still%20readable%0A%0ABody');
  await expect(page.locator('#document h1')).toHaveText('Still readable');
  await expect(page.getByText(/Could not initialize document controls/)).toBeVisible();
  expect(errors).toEqual([]);
  const captured = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(captured).toBe(false);
});
