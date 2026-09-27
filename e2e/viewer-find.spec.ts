import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';

const DOC = [
  '# Find me',
  '',
  'Some **bold** text, then plain text.',
  '',
  ...Array.from({ length: 150 }, (_, i) => `Filler paragraph ${i + 1}.\n`),
  'The needle is at the very end.',
].join('\n');

const bar = (page: Page) => page.locator('.find-bar');
const count = (page: Page) => page.locator('.find-count');
const highlightSize = (page: Page, name: string) =>
  page.evaluate((n) => (CSS as any).highlights.get(n)?.size ?? 0, name);
/** Text of the current match and whether it is within the scroller's visible area. */
const currentMatch = (page: Page) =>
  page.evaluate(() => {
    const [range] = [...((CSS as any).highlights.get('scrivo-find-current') ?? [])] as Range[];
    if (!range) return null;
    const box = range.getBoundingClientRect();
    const view = document.getElementById('viewer')!.getBoundingClientRect();
    return { text: range.toString(), visible: box.top >= view.top && box.bottom <= view.bottom };
  });

test.describe('find in the reading view', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { text: DOC, mode: 'view' });
  });

  test('highlights every match, counts them, and steps through with Enter', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await expect(bar(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Find in document' })).toBeFocused();
    await page.keyboard.type('text');
    await expect(count(page)).toHaveText('1 of 2');
    expect(await highlightSize(page, 'scrivo-find')).toBe(2);
    expect(await currentMatch(page)).toEqual({ text: 'text', visible: true });

    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('2 of 2');
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('1 of 2'); // wraps
    await page.keyboard.press('Shift+Enter');
    await expect(count(page)).toHaveText('2 of 2');
  });

  test('matches across formatting and ignores case', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('SOME BOLD');
    await expect(count(page)).toHaveText('1 of 1');
    expect((await currentMatch(page))?.text).toBe('Some bold');
  });

  test('finds text far down the document and scrolls to it', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('needle');
    await expect(count(page)).toHaveText('1 of 1');
    await expect.poll(() => currentMatch(page)).toEqual({ text: 'needle', visible: true });
  });

  test('says when nothing matches', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('zebra');
    await expect(count(page)).toHaveText('No matches');
    expect(await highlightSize(page, 'scrivo-find')).toBe(0);
  });

  test('Escape closes the bar, clears highlights and returns focus to the document', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('filler');
    await expect(count(page)).toHaveText(/ of 150$/);
    await page.keyboard.press('Escape');
    await expect(bar(page)).toBeHidden();
    expect(await highlightSize(page, 'scrivo-find')).toBe(0);
    await expect(page.locator('#viewer')).toBeFocused();

    // Reopening keeps the last query and shows its matches again.
    await page.keyboard.press('Control+f');
    await expect(page.getByRole('textbox', { name: 'Find in document' })).toHaveValue('filler');
    await expect(count(page)).toHaveText(/ of 150$/);
  });

  test('F3 steps through matches from the document', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('filler');
    await expect(count(page)).toHaveText(/^1 of 150$/);
    await page.locator('#viewer').focus();
    await page.keyboard.press('F3');
    await expect(count(page)).toHaveText(/^2 of 150$/);
    await page.keyboard.press('Shift+F3');
    await expect(count(page)).toHaveText(/^1 of 150$/);
  });

  test('switching to the editor closes it; the editor keeps focus', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('text');
    await expect(count(page)).toHaveText('1 of 2');
    await page.keyboard.press('Control+e');
    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(bar(page)).toBeHidden();
    expect(await highlightSize(page, 'scrivo-find')).toBe(0);
    await expect(page.locator('.cm-content')).toBeFocused();
  });

  test('an open bar follows the document when it changes', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('needle');
    await expect(count(page)).toHaveText('1 of 1');
    await page.evaluate(() => {
      const s = (window as any).__scrivo;
      s.platform.disk.put('/sample/inline.md', 'needle needle needle\n');
      s.platform.focus();
    });
    await expect(count(page)).toHaveText('1 of 3');
  });
});

test('Find reveals a match beyond an ordinary code block’s horizontal scrollbar', async ({ page }) => {
  await openApp(page, { text: `\`\`\`\n${'W'.repeat(1000)}far-right-marker\n\`\`\`\n`, mode: 'view' });
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find in document' }).fill('far-right-marker');
  await expect(page.locator('.find-count')).toHaveText('1 of 1');
  const revealed = await page.evaluate(() => {
    const pre = document.querySelector<HTMLPreElement>('#document pre')!;
    const [range] = [...((CSS as any).highlights.get('scrivo-find-current') ?? [])] as Range[];
    const box = range!.getBoundingClientRect();
    const clip = pre.getBoundingClientRect();
    return pre.scrollLeft > pre.clientWidth * 4
      && box.left >= clip.left - 1 && box.right <= clip.right + 1;
  });
  expect(revealed).toBe(true);
});
