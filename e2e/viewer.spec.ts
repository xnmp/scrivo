import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';

const doc = (page: Page) => page.locator('#document');

const SAMPLE = [
  '# Guide',
  '',
  'Some **bold** text and `code` with $e^{i\\pi}$.',
  '',
  '- [x] done',
  '- [ ] todo',
  '',
  '| a | b |',
  '|:--|--:|',
  '| 1 | 2 |',
  '',
  '```js',
  'let x = "<b>";',
  '```',
  '',
  '[other](other.md) · [web](https://example.com/) · [jump](#part-two) · [bad](javascript:alert(1))',
  '',
  ...Array.from({ length: 60 }, (_, i) => `Filler paragraph ${i + 1}.\n`),
  '## Part two',
  '',
  ...Array.from({ length: 60 }, (_, i) => `More filler ${i + 1}.\n`),
  'The end.',
].join('\n');

test.describe('reading view', () => {
  test('highlights fenced code after opening without changing its text', async ({ page }) => {
    const source = 'def greet(name):\n    return "<b>"\n';
    await openApp(page, { text: `# Code\n\n\`\`\`python\n${source}\`\`\``, mode: 'view' });
    const code = doc(page).locator('pre code');
    await expect(code.locator('.tok-keyword', { hasText: 'def' })).toBeVisible();
    await expect(code).toHaveText(source);
    await expect(code.locator('b')).toHaveCount(0);
    await expect(page.locator('.cm-editor')).toHaveCount(0);
  });

  test('opens a file rendered, without loading the editor', async ({ page }) => {
    await openApp(page, { text: SAMPLE, mode: 'view' });
    await expect(doc(page).locator('h1')).toHaveText('Guide');
    await expect(doc(page).locator('p').first()).toContainText('Some bold text and code with');
    await expect(doc(page).locator('strong').first()).toHaveText('bold');
    await expect(doc(page).locator('math').first()).toBeVisible();
    await expect(doc(page).locator('input[type=checkbox]')).toHaveCount(2);
    await expect(doc(page).locator('input[type=checkbox]').first()).toBeChecked();
    await expect(doc(page).locator('th').first()).toHaveText('a');
    await expect(doc(page).locator('td').last()).toHaveAttribute('data-align', 'right');
    await expect(doc(page).locator('pre code')).toHaveText('let x = "<b>";\n');
    await expect(page.locator('.cm-editor')).toHaveCount(0);
    await expect(page.locator('.status-bar')).toContainText('to edit');
    await expect(page).toHaveTitle('inline.md — Scrivo');
  });

  test('contents sidebar jumps to a heading and closes with Escape', async ({ page }) => {
    await openApp(page, { text: SAMPLE, mode: 'view' });
    const toggle = page.getByRole('button', { name: 'Contents', exact: true });
    await expect(toggle).toBeVisible();
    await toggle.click();
    const panel = page.locator('#outline-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Heading level 2: Part two' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__scrivo.viewer.topLine())).toBeGreaterThan(60);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('contents sidebar works on a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openApp(page, { text: SAMPLE, mode: 'view' });
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    const panel = page.locator('#outline-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Heading level 2: Part two' }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator('#viewer')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('never runs markup from the document', async ({ page }) => {
    const hostile = [
      '<script>window.__pwned = 1</script>',
      '',
      'x <img src=x onerror="window.__pwned = 2"> y',
      '',
      '[click](javascript:window.__pwned=3)',
      '',
      '![i](x.png "a\\" onerror=\\"window.__pwned=4")',
    ].join('\n');
    await openApp(page, { text: hostile, mode: 'view' });
    await expect(doc(page)).toContainText('<script>window.__pwned = 1</script>');
    await expect(doc(page)).toContainText('<img src=x onerror="window.__pwned = 2">');
    await doc(page).getByText('click').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    await expect(doc(page).locator('script, [onerror], [onclick]')).toHaveCount(0);
  });

  test('Ctrl+E switches to the editor where the reader was, and back', async ({ page }) => {
    await openApp(page, { text: SAMPLE, mode: 'view' });
    await doc(page).locator('h2').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.getElementById('part-two')!.scrollIntoView({ block: 'start' }));
    const readerTop = await page.evaluate(() => (window as any).__scrivo.viewer.topLine());

    await page.keyboard.press('Control+e');
    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page.locator('#viewer')).toBeHidden();
    const editorTop = await page.evaluate(() => (window as any).__scrivo.editor.topLine());
    expect(Math.abs(editorTop - readerTop)).toBeLessThanOrEqual(2);
    // The caret is at the revealed line, ready to type there.
    await page.keyboard.type('Edited ');
    const caretLine = await page.evaluate(() => {
      const { state } = (window as any).__scrivo.editor.view;
      const line = state.doc.lineAt(state.selection.main.head);
      return { number: line.number, text: line.text };
    });
    expect(caretLine.text.startsWith('Edited ')).toBe(true);
    expect(Math.abs(caretLine.number - readerTop)).toBeLessThanOrEqual(2);

    await page.keyboard.press('Control+e');
    await expect(page.locator('#viewer')).toBeVisible();
    await expect(doc(page)).toContainText('Edited ');
    await expect(page).toHaveTitle('inline.md • — Scrivo');
    const backTop = await page.evaluate(() => (window as any).__scrivo.viewer.topLine());
    expect(Math.abs(backTop - editorTop)).toBeLessThanOrEqual(2);
  });

  test('keyboard scrolling works straight away', async ({ page }) => {
    await openApp(page, { text: SAMPLE, mode: 'view' });
    const before = await page.locator('#viewer').evaluate((el) => el.scrollTop);
    await page.keyboard.press('PageDown');
    await expect.poll(() => page.locator('#viewer').evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  });

  test('fragment links scroll to the heading', async ({ page }) => {
    await openApp(page, { text: SAMPLE, mode: 'view' });
    await doc(page).getByText('jump').click();
    await expect.poll(() => page.evaluate(() => (window as any).__scrivo.viewer.topLine())).toBeGreaterThan(60);
    const top = await page.locator('#part-two').evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThan(5);
  });

  test('markdown links open in the reader; web links go to the system; unsafe links do nothing', async ({ page }) => {
    await openApp(page, { text: SAMPLE, mode: 'view' });
    await page.evaluate(() => (window as any).__scrivo.platform.disk.put('/sample/other.md', '# Other doc\n\nhello'));
    await doc(page).getByText('web').click();
    await doc(page).getByText('bad').click();
    expect(await page.evaluate(() => (window as any).__scrivo.platform.opened)).toEqual(['url:https://example.com/']);
    expect(page.url()).toContain('localhost');

    await doc(page).getByText('other', { exact: true }).click();
    await expect(doc(page).locator('h1')).toHaveText('Other doc');
    await expect(page).toHaveTitle('other.md — Scrivo');
  });

  test('picks up changes made by other programs on focus', async ({ page }) => {
    await openApp(page, { text: '# One\n', mode: 'view' });
    await page.evaluate(() => {
      const s = (window as any).__scrivo;
      s.platform.disk.put('/sample/inline.md', '# Two\n');
      s.platform.focus();
    });
    await expect(doc(page).locator('h1')).toHaveText('Two');
  });

  test('a missing linked document leaves the page as it was', async ({ page }) => {
    await openApp(page, { text: '# Here\n\n[gone](gone.md)', mode: 'view' });
    await doc(page).getByText('gone').click();
    await expect(page.locator('.toast')).toContainText('Could not open gone.md');
    await expect(doc(page).locator('h1')).toHaveText('Here');
  });

  test('untitled and new documents start in the editor', async ({ page }) => {
    await page.goto('/?doc=none');
    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page.locator('#viewer')).toBeHidden();
  });
});
