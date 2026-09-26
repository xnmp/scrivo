import { expect, test } from '@playwright/test';
import {
  controllerOpen,
  diskGet,
  diskPut,
  docText,
  lastTitle,
  openApp,
  pushSaveAnswer,
} from './helpers';

test.describe('saving', () => {
  test('Ctrl+S writes the exact text and clears the dirty marker', async ({ page }) => {
    const text = 'Hello world.';
    await openApp(page, { text }); // backed by /sample/inline.md
    await page.click('.cm-content');
    await page.keyboard.press('End');
    await page.keyboard.type(' More.');

    expect(await lastTitle(page)).toContain(' •');

    await page.keyboard.press('Control+s');
    await page.waitForTimeout(50);

    const expected = `${text} More.`;
    expect(await docText(page)).toBe(expected);
    expect(await diskGet(page, '/sample/inline.md')).toBe(expected);
    expect(await lastTitle(page)).not.toContain(' •');
  });

  test('Ctrl+S on an untitled document goes through the Save dialog', async ({ page }) => {
    await openApp(page, { doc: 'none' });
    await page.click('.cm-content');
    await page.keyboard.type('New content.');
    await pushSaveAnswer(page, '/new/file.md');

    await page.keyboard.press('Control+s');
    await page.waitForTimeout(50);

    expect(await diskGet(page, '/new/file.md')).toBe('New content.');
    expect(await lastTitle(page)).toContain('file.md');
    expect(await lastTitle(page)).not.toContain(' •');
  });

  test('CRLF line endings are preserved on save', async ({ page }) => {
    await openApp(page, { doc: 'none' });
    await diskPut(page, '/crlf.md', 'line one\r\nline two\r\n');
    await controllerOpen(page, '/crlf.md');
    await page.waitForTimeout(20);

    await page.click('.cm-content');
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(50);

    const saved = await diskGet(page, '/crlf.md');
    expect(saved).toContain('\r\n');
    expect(saved!.split('\r\n').length).toBeGreaterThan(1);
    expect(saved).not.toMatch(/[^\r]\n/); // every \n is preceded by \r
  });
});
