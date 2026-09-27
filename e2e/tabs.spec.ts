import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { diskGet, diskPut, docText, openApp } from './helpers';

const largeMarkdown = readFileSync(new URL('../bench/fixtures/large.md', import.meta.url), 'utf8');

test('tabs retain independent text, undo history, and save outcomes', async ({ page }) => {
  await openApp(page, { text: 'First' });
  await page.locator('.cm-content').click();
  await page.keyboard.type(' A');
  const first = await page.evaluate(() => (window as any).__scrivo.tabs.state().activeId as string);
  await page.evaluate(() => (window as any).__scrivo.platform.disk.put('/sample/second.md', 'Second'));
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.document-session:not([hidden]) .markdown-body')).toContainText('Second');
  await page.keyboard.press('Control+e');
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeVisible();
  await page.locator('.document-session:not([hidden]) .cm-content').click();
  await page.keyboard.type(' B');
  expect(await docText(page)).toBe('Second B');

  await page.evaluate((id) => (window as any).__scrivo.tabs.activate(id), first);
  expect(await docText(page)).toBe('First A');
  await page.keyboard.press('Control+z');
  expect(await docText(page)).toBe('First');
  await page.evaluate(() => (window as any).__scrivo.workspace.save());
  expect(await diskGet(page, '/sample/inline.md')).toBe('First');

  await page.getByRole('tab', { name: /second\.md/i }).click();
  expect(await docText(page)).toBe('Second B');
  await page.evaluate(() => (window as any).__scrivo.workspace.save());
  expect(await diskGet(page, '/sample/second.md')).toBe('Second B');
});

test('opening the same path selects its tab and a dirty close prompts for that document', async ({ page }) => {
  await openApp(page, { text: 'First' });
  await page.evaluate(() => (window as any).__scrivo.platform.disk.put('/sample/second.md', 'Second'));
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  const second = await page.evaluate(() => (window as any).__scrivo.tabs.state().activeId as string);
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  expect(await page.getByRole('tab').count()).toBe(2);
  expect(await page.evaluate(() => (window as any).__scrivo.tabs.state().activeId)).toBe(second);

  await page.keyboard.press('Control+e');
  await page.locator('.document-session:not([hidden]) .cm-content').click();
  await page.keyboard.type(' changed');
  await page.getByRole('button', { name: 'Close second.md' }).click();
  await expect(page.locator('.modal-backdrop')).toBeVisible();
  await page.click('[data-choice=cancel]');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close second.md' }).click();
  await page.click('[data-choice=discard]');
  await expect(page.getByRole('tab')).toHaveCount(1);
  expect(await diskGet(page, '/sample/second.md')).toBe('Second');
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeVisible();
  expect(await docText(page)).toBe('First');
});

test('tab controls support keyboard navigation and return focus to the remaining document', async ({ page }) => {
  await openApp(page, { text: '# First' });
  await diskPut(page, '/sample/second.md', '# Second');
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  const second = page.getByRole('tab', { name: 'second.md' });
  await second.focus();
  await second.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'inline.md' })).toBeFocused();
  await page.keyboard.press('Control+Tab');
  await expect(page.getByRole('tab', { name: 'second.md' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeFocused();
});

test('switching tabs preserves selection and scroll, then detects an external edit on activation', async ({ page }) => {
  const firstText = Array.from({ length: 160 }, (_, index) => `Line ${index + 1}`).join('\n');
  await openApp(page, { text: firstText });
  const first = await page.evaluate(() => (window as any).__scrivo.tabs.state().activeId as string);
  const anchor = await page.evaluate(() => {
    const view = (window as any).__scrivo.editor.view;
    const anchor = view.state.doc.line(110).from + 2;
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    return anchor;
  });
  await page.waitForFunction(() => (window as any).__scrivo.editor.view.scrollDOM.scrollTop > 0);
  const before = await page.evaluate((anchor) => ({
    anchor, scroll: (window as any).__scrivo.editor.view.scrollDOM.scrollTop,
  }), anchor);
  await page.evaluate(() => (window as any).__scrivo.platform.disk.put('/sample/second.md', 'Second'));
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  await page.evaluate((id) => (window as any).__scrivo.tabs.activate(id), first);
  const retained = await page.evaluate(() => {
    const view = (window as any).__scrivo.editor.view;
    return { anchor: view.state.selection.main.anchor, scroll: view.scrollDOM.scrollTop };
  });
  expect(retained.anchor).toBe(before.anchor);
  expect(Math.abs(retained.scroll - before.scroll)).toBeLessThan(50);
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  await page.evaluate(() => {
    const disk = (window as any).__scrivo.platform.disk;
    disk.put('/sample/inline.md', 'Externally changed');
    disk.notify('/sample/inline.md');
  });
  await page.evaluate((id) => (window as any).__scrivo.tabs.activate(id), first);
  await expect.poll(() => docText(page)).toBe('Externally changed');
});

test('a cancelled whole-window close re-protects earlier dirty tabs', async ({ page }) => {
  await openApp(page, { text: 'First' });
  await page.locator('.cm-content').click();
  await page.keyboard.type(' dirty');
  await page.evaluate(() => (window as any).__scrivo.platform.disk.put('/sample/second.md', 'Second'));
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  await page.keyboard.press('Control+e');
  await page.locator('.document-session:not([hidden]) .cm-content').click();
  await page.keyboard.type(' dirty');
  await page.evaluate(() => { (window as any).__closeResult = (window as any).__scrivo.platform.requestClose(); });
  await page.click('[data-choice=discard]');
  await page.click('[data-choice=cancel]');
  expect(await page.evaluate(() => (window as any).__closeResult)).toBe(false);
  await expect.poll(() => page.evaluate(async () =>
    (await (window as any).__scrivo.platform.recovery.list()).some((copy: any) => copy.path === '/sample/inline.md'))).toBe(true);
  await page.waitForTimeout(2200);
  expect(await diskGet(page, '/sample/inline.md')).toBe('First');
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('Save As from reading view updates the reader path and tab identity', async ({ page }) => {
  await openApp(page, { text: 'First' });
  await page.locator('.cm-content').click();
  await page.keyboard.type(' changed');
  await page.keyboard.press('Control+e');
  await expect(page.locator('#viewer')).toBeVisible();
  await page.evaluate(() => (window as any).__scrivo.platform.dialogAnswers.save.push('/sample/renamed.md'));
  await page.evaluate(() => (window as any).__scrivo.workspace.saveAs());
  await expect(page.getByRole('tab', { name: /renamed\.md/i })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__scrivo.workspace.documentPath())).toBe('/sample/renamed.md');
  expect(await diskGet(page, '/sample/renamed.md')).toBe('First changed');
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/inline.md'));
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/renamed.md'));
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('two large editing tabs switch with their own visible content', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  await diskPut(page, '/sample/large-a.md', largeMarkdown.replace('Benchmark Large Document', 'Large Document A'));
  await diskPut(page, '/sample/large-b.md', largeMarkdown.replace('Benchmark Large Document', 'Large Document B'));
  for (const path of ['/sample/large-a.md', '/sample/large-b.md']) {
    await page.evaluate((value) => (window as any).__scrivo.tabs.open(value), path);
    await page.evaluate(() => (window as any).__scrivo.workspace.toggle());
    await expect(page.locator('.document-session:not([hidden]) .cm-content')).toBeVisible();
  }
  const tabs = await page.evaluate(() => (window as any).__scrivo.tabs.state().tabs
    .filter((tab: { id: string }) => tab.id !== 'initial').map((tab: { id: string }) => tab.id)) as string[];
  expect(tabs).toHaveLength(2);
  const times = await page.evaluate(async (ids) => {
    const measured: number[] = [];
    for (let index = 0; index < 10; index++) {
      const expected = index % 2 === 0 ? 'Large Document A' : 'Large Document B';
      const start = performance.now();
      (window as any).__scrivo.tabs.activate(ids[index % 2]);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const active = document.querySelector('.document-session:not([hidden]) .cm-content');
      if (!active?.textContent?.includes(expected)) throw new Error(`${expected} was not visible after tab switch`);
      measured.push(performance.now() - start);
    }
    return measured;
  }, tabs);
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]!;
  console.log(`two 443 KiB editing tabs: median two-frame switch ${median.toFixed(1)} ms; max ${Math.max(...times).toFixed(1)} ms`);
});
