import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

// Slow playback makes motion observable without changing application timing/state.
const slowMotion = async (page: import('@playwright/test').Page) => page.evaluate(() => {
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args: Parameters<typeof animate>) {
    const animation = animate.apply(this, args); animation.playbackRate = 0.1; return animation;
  };
});

test('opening and closing tabs slides neighboring controls while document changes stay immediate', async ({ page }) => {
  await openApp(page, { text: '# Original', mode: 'view' });
  const initialAdd = (await page.getByRole('button', { name: 'New document' }).boundingBox())!.x;
  await slowMotion(page);
  await page.keyboard.press('Control+t');
  const item = page.locator('.tab-item').last();
  const early = (await item.boundingBox())!.width;
  await expect(page.getByRole('tab', { name: 'Untitled', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.cm-content')).toBeFocused();
  await expect.poll(async () => (await item.boundingBox())!.width).toBeGreaterThan(early + 20);
  await expect.poll(async () => (await page.getByRole('button', { name: 'New document' }).boundingBox())!.x).toBeGreaterThan(initialAdd + 80);
  await expect.poll(() => item.evaluate(node => node.getAnimations().length)).toBe(0);
  const expandedAdd = (await page.getByRole('button', { name: 'New document' }).boundingBox())!.x;
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'inline.md' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#document h1')).toHaveText('Original');
  await expect.poll(async () => (await page.getByRole('button', { name: 'New document' }).boundingBox())!.x).toBeLessThan(expandedAdd - 20);
  await expect(page.locator('.tab-item')).toHaveCount(1);
  expect((await page.getByRole('button', { name: 'New document' }).boundingBox())!.x).toBeCloseTo(initialAdd, 1);
});

test('rapid tab changes preserve keyboard focus and reduced motion settles departing tabs', async ({ page }) => {
  await openApp(page, { text: 'Original', mode: 'view' });
  await slowMotion(page);
  await page.keyboard.press('Control+t');
  await page.keyboard.press('Control+w');
  await page.keyboard.press('Control+t');
  await page.keyboard.press('Control+t');
  await page.getByRole('tab', { name: 'inline.md' }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { selected: true })).toBeFocused();
  await page.keyboard.press('Control+w');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await expect.poll(() => page.locator('.tab-list').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.keyboard.press('Control+t');
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.locator('.tab-item')).toHaveCount(3);
  await expect(page.locator('.cm-content:visible')).toBeFocused();
});

test('a delayed editor load preserves focus in another tab’s unsaved prompt', async ({ page }) => {
  await openApp(page, { text: 'Original' });
  await page.locator('.cm-content').click(); await page.keyboard.type(' dirty');
  await page.evaluate(() => {
    const platform = (window as any).__scrivo.platform;
    platform.disk.put('/sample/reader.md', '# Reader');
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    (window as any).__releaseEditorRead = release;
    const read = platform.fs.read;
    platform.fs.read = async (path: string) => {
      if (path === '/sample/reader.md') { (window as any).__editorReadStarted = true; await ready; }
      return read(path);
    };
  });
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/reader.md'));
  await page.keyboard.press('Control+e');
  await page.waitForFunction(() => (window as any).__editorReadStarted);
  await page.getByRole('tab', { name: /inline.md/ }).hover();
  await page.getByRole('button', { name: 'Close inline.md', exact: true }).click();
  const save = page.locator('.modal').getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeFocused();
  await page.evaluate(() => (window as any).__releaseEditorRead());
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeVisible();
  await expect(save).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
});
