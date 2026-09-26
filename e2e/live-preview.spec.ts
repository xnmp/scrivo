import { expect, test } from '@playwright/test';
import { docText, lineText, openApp, setCaret } from './helpers';

test.describe('live preview hides syntax', () => {
  test('heading renders without the marker, reveals it when the caret is inside', async ({ page }) => {
    const text = '# Title\n\nSomething else here.';
    await openApp(page, { text });
    await setCaret(page, text.length); // caret in the second paragraph: elsewhere

    const heading = page.locator('.cm-lp-h1');
    await expect(heading).toBeVisible();
    expect((await heading.innerText()).trim()).toBe('Title');

    // Move the caret onto the "# " marker itself (not into the text after it, which stays
    // hidden so typing right after the marker doesn't make it flash back — see reveal.ts).
    await setCaret(page, 0);
    expect(await lineText(page, 0)).toBe('# Title');
  });

  test('bold hides markers until the caret enters, then reveals **bold**', async ({ page }) => {
    const text = 'Some **bold** word.';
    await openApp(page, { text });
    await setCaret(page, text.length);

    const strong = page.locator('.cm-lp-strong');
    await expect(strong).toBeVisible();
    expect(await strong.innerText()).toBe('bold');
    expect(await lineText(page, 0)).toBe('Some bold word.');

    await setCaret(page, text.indexOf('bold') + 2); // caret inside "bold"
    expect(await lineText(page, 0)).toBe(text);
  });

  test('link shows only the label as .cm-lp-link', async ({ page }) => {
    const text = 'See [t](http://x) for more.';
    await openApp(page, { text });
    await setCaret(page, text.length);

    const link = page.locator('.cm-lp-link');
    await expect(link).toBeVisible();
    expect(await link.innerText()).toBe('t');
    expect(await lineText(page, 0)).toBe('See t for more.');
  });

  test('a bare URL is styled as a link without brackets', async ({ page }) => {
    const text = 'Visit https://example.com today.';
    await openApp(page, { text });
    await setCaret(page, text.length);

    const link = page.locator('.cm-lp-link.cm-lp-bare-url');
    await expect(link).toBeVisible();
    expect(await link.innerText()).toBe('https://example.com');
  });

  test('a bracketed span with no destination stays literal text', async ({ page }) => {
    const text = 'A [TODO] item.';
    await openApp(page, { text });
    await setCaret(page, text.length);

    expect(await lineText(page, 0)).toBe(text);
    await expect(page.locator('.cm-lp-link')).toHaveCount(0);
  });
});
