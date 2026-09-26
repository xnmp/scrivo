import { expect, test } from '@playwright/test';
import { docText, openApp } from './helpers';

test.describe('typing produces exact source text', () => {
  test('typing bold markers keeps the literal asterisks', async ({ page }) => {
    await openApp(page, { doc: 'none' });
    await page.click('.cm-content');
    await page.keyboard.type('**x**');
    expect(await docText(page)).toBe('**x**');
  });

  test('typing a list item keeps the literal marker', async ({ page }) => {
    await openApp(page, { doc: 'none' });
    await page.click('.cm-content');
    await page.keyboard.type('- item');
    expect(await docText(page)).toBe('- item');
  });
});
