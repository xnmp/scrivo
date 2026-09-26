import { expect, test } from '@playwright/test';
import { lineText, openApp, setCaret } from './helpers';

test.describe('code blocks', () => {
  const text = 'Before.\n\n```python\ndef greet(name):\n    return name\n```\n\nAfter.';

  test('fences are hidden when the caret is outside, with a data-lang label', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length); // in "After."

    const first = page.locator('.cm-lp-codeblock-begin');
    await expect(first).toBeVisible();
    expect(await first.getAttribute('data-lang')).toBe('python');
    // Line 2 is the opening fence, hidden entirely (including the `python` info string).
    expect(await lineText(page, 2)).toBe('');
    expect(await lineText(page, 3)).toBe('def greet(name):');

    await expect(page.locator('.cm-lp-codeblock-end')).toBeVisible();
  });

  test('highlighted tokens appear once the python grammar lazy-loads', async ({ page }) => {
    await openApp(page, { text });
    await setCaret(page, text.length);

    const keyword = page.locator('.tok-keyword', { hasText: 'def' });
    await expect(keyword).toBeVisible({ timeout: 10_000 });
  });
});
