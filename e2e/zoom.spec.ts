import { expect, test } from '@playwright/test';
import { docText, openApp, runCommand } from './helpers';

const headerHeight = async (page: import('@playwright/test').Page) => (await page.locator('#tab-bar').boundingBox())!.height;

test('Ctrl plus/minus zooms the whole interface without changing Markdown', async ({ page }) => {
  const text = '# Original\n\nBody';
  await openApp(page, { text });
  const initial = await headerHeight(page);
  await page.keyboard.press('Control+Shift+=');
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial * 1.1, 1);
  await page.keyboard.press('Control+=');
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial * 1.2, 1);
  await page.keyboard.press('Control+-');
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial * 1.1, 1);
  expect(await docText(page)).toBe(text);
  await runCommand(page, 'Reset zoom');
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial, 1);
  // KeyboardEvent modifiers are prototype getters, unlike plain unit fixtures.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: '+', code: 'BracketRight', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  })));
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial * 1.1, 1);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: '-', code: 'Slash', ctrlKey: true, bubbles: true, cancelable: true,
  })));
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial, 1);
  expect(await docText(page)).toBe(text);
});

test('zoom works through Settings, while hotkey recording and custom bindings remain authoritative', async ({ page }) => {
  await openApp(page, { text: 'Body' });
  const initial = await headerHeight(page);
  await page.keyboard.press('Control+,');
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  await page.keyboard.press('Control+-');
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial * 0.9, 1);
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Hotkeys', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search hotkeys' }).fill('Zoom in');
  for (const name of ['Ctrl+=', 'Ctrl+Shift+=', 'Ctrl+Num +']) {
    await page.getByRole('button', { name: `Remove ${name} from Zoom in`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add hotkey for Zoom in', exact: true }).click();
  await page.keyboard.press('Control+-');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText('assigned to “Zoom out”');
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial * 0.9, 1);
  await page.keyboard.press('Control+Alt+j');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+=');
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial * 0.9, 1);
  await page.keyboard.press('Control+Alt+j');
  await expect.poll(() => headerHeight(page)).toBeCloseTo(initial, 1);
  expect(await docText(page)).toBe('Body');
});

test('zoom preserves a pending Settings open and applies to the completed dialog', async ({ page }) => {
  await openApp(page, { text: 'Body' });
  const initial = await headerHeight(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/settings-*.js', async route => { await ready; await route.continue(); });
  try {
    await page.keyboard.press('Control+,');
    await page.keyboard.press('Control+=');
    await expect.poll(() => headerHeight(page)).toBeCloseTo(initial * 1.1, 1);
  } finally { release(); }
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await docText(page)).toBe('Body');
});
