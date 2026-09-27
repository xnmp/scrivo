import { expect, test, type Page } from '@playwright/test';
import { ControlOrMeta, controllerOpen, diskGet, docText, nextFrame, openApp, setCaret } from './helpers';

async function paste(page: Page, html: string, plain: string): Promise<void> {
  await page.evaluate(({ html, plain }) => {
    const clipboard = new DataTransfer();
    if (html) clipboard.setData('text/html', html);
    if (plain) clipboard.setData('text/plain', plain);
    const editor = (window as any).__scrivo.editor.view.contentDOM;
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  }, { html, plain });
  await nextFrame(page);
}

test('rich browser paste saves and reopens headings, lists, links, code, and a table', async ({ page }) => {
  await openApp(page, { text: 'Start\n\n' });
  await setCaret(page, 'Start\n\n'.length);
  await paste(page, '<h2>Imported</h2><p><strong>Bold</strong> and <a href="https://example.com/guide">guide</a>.</p><ul><li>One</li><li>Two</li></ul><pre><code class="language-js">const n = 1;\n</code></pre><table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>10</td></tr></table>', 'Imported Bold and guide. One Two');
  const expected = 'Start\n\n## Imported\n\n**Bold** and [guide](https://example.com/guide).\n\n- One\n- Two\n\n```js\nconst n = 1;\n```\n\n| Name | Value |\n| --- | --- |\n| A | 10 |';
  expect(await docText(page)).toBe(expected);
  await page.keyboard.press(`${ControlOrMeta}+s`);
  await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(expected);
  await controllerOpen(page, '/sample/inline.md');
  expect(await docText(page)).toBe(expected);
  await expect(page.locator('.cm-lp-table')).toBeVisible();
});

test('unsafe rich markup becomes plain text while text-only clipboard preserves bytes', async ({ page }) => {
  await openApp(page, { text: '' });
  await setCaret(page, 0);
  await paste(page, '<p onclick="evil()"><a href="javascript:evil()">Safe label</a> <img src="https://example.com/tracker" alt="image"></p><script>evil()</script>', 'fallback');
  expect(await docText(page)).toBe('Safe label image');
  await paste(page, '', '\n**literal** <b>tag</b>');
  expect(await docText(page)).toBe('Safe label image\n**literal** <b>tag</b>');
});

test('failed rich conversion uses text/plain and source mode accepts rich paste', async ({ page }) => {
  await openApp(page, { text: '' });
  await page.keyboard.press(`${ControlOrMeta}+/`);
  await setCaret(page, 0);
  await paste(page, '<script>bad()</script>', 'plain fallback');
  expect(await docText(page)).toBe('plain fallback');
  await paste(page, '<p> <em>rich</em> text</p>', 'rich text');
  expect(await docText(page)).toBe('plain fallback*rich* text');
});

test('rich paste replaces selections in one undo step', async ({ page }) => {
  await openApp(page, { text: 'Before AFTER' });
  await page.evaluate(() => {
    const view = (window as any).__scrivo.editor.view;
    view.dispatch({ selection: { anchor: 7, head: 12 } });
    view.focus();
  });
  await paste(page, '<strong>new</strong>', 'new');
  expect(await docText(page)).toBe('Before **new**');
  await page.keyboard.press(`${ControlOrMeta}+z`);
  expect(await docText(page)).toBe('Before AFTER');
  await page.keyboard.press(`${ControlOrMeta}+Shift+Z`);
  expect(await docText(page)).toBe('Before **new**');
});

test('pasting into Find and Replace edits the field, not the document', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page, { text: 'Keep this document' });
  await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob(['<strong>rich field</strong>'], { type: 'text/html' }),
    'text/plain': new Blob(['rich field'], { type: 'text/plain' }),
  })]));
  await page.keyboard.press(`${ControlOrMeta}+h`);
  const replace = page.locator('.cm-search input[name=replace]');
  await replace.waitFor();
  await replace.focus();
  await page.keyboard.press(`${ControlOrMeta}+v`);
  await expect(replace).toHaveValue('rich field');
  expect(await docText(page)).toBe('Keep this document');
});

test('entity-like text, thematic lines, math text, and link targets survive rendering', async ({ page }) => {
  await openApp(page, { text: '' });
  await setCaret(page, 0);
  await paste(page, '<p>&amp;copy; Cost $x$ today</p><p>---</p><p>one<br>===</p><p><a href="https://example.com/?q=&amp;copy;&amp;next=1">query</a></p>', 'fallback');
  const expected = '&amp;copy; Cost \\$x\\$ today\n\n\\---\n\none  \n\\===\n\n[query](https://example.com/?q=&amp;copy;&amp;next=1)';
  expect(await docText(page)).toBe(expected);
  await page.keyboard.press(`${ControlOrMeta}+s`);
  await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(expected);
  await page.keyboard.press(`${ControlOrMeta}+e`);
  await expect(page.locator('#document')).toContainText('&copy; Cost $x$ today');
  await expect(page.locator('#document hr, #document .katex, #document math')).toHaveCount(0);
  await expect(page.locator('#document a')).toHaveAttribute('href', 'https://example.com/?q=&copy;&next=1');
});

test('unsupported visible markup stays as text and a zero-based list keeps its numbering', async ({ page }) => {
  await openApp(page, { text: '' });
  await setCaret(page, 0);
  await paste(page, '<p>Equation <math><mi>x</mi><mo>+</mo><mn>1</mn></math> and <svg><text>42</text><script>evil()</script></svg>.</p><ol start="0"><li>zero</li><li>one</li></ol>', 'fallback');
  expect(await docText(page)).toBe('Equation x+1 and 42.\n\n0. zero\n1. one');
  await page.keyboard.press(`${ControlOrMeta}+e`);
  await expect(page.locator('#document')).toContainText('Equation x+1 and 42.');
  await expect(page.locator('#document ol')).toHaveAttribute('start', '0');
  await expect(page.locator('#document script')).toHaveCount(0);
});
