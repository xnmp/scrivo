import { expect, test } from '@playwright/test';
import { controllerOpen, diskGet, diskPut, docText, openApp, pushSaveAnswer, setCaret } from './helpers';

async function transferFile(page: import('@playwright/test').Page, kind: 'paste' | 'drop', name: string, bytes: number[], fallbackText = '') {
  await page.evaluate(({ kind, name, bytes, fallbackText }) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
    if (fallbackText) data.setData('text/plain', fallbackText);
    const view = (window as any).__scrivo.editor.view;
    const target = view.contentDOM;
    if (kind === 'paste') {
      target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    } else {
      const rect = view.coordsAtPos(view.state.doc.length)!;
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.right, clientY: rect.top + 2 }));
    }
  }, { kind, name, bytes, fallbackText });
}

test('image paste creates collision-safe local assets and links that survive save/reopen', async ({ page }) => {
  await openApp(page, { text: 'Note\n' });
  await setCaret(page, 5);
  await transferFile(page, 'paste', 'café photo.png', [1, 2, 3]);
  await expect.poll(() => docText(page)).toContain('![café photo](assets/caf%C3%A9%20photo.png)');
  await transferFile(page, 'paste', 'café photo.png', [4, 5]);
  await expect.poll(() => docText(page)).toContain('![café photo-2](assets/caf%C3%A9%20photo-2.png)');
  const assets = await page.evaluate(() => {
    const disk = (window as any).__scrivo.platform.disk;
    return [disk.getBytes('/sample/assets/café photo.png'), disk.getBytes('/sample/assets/café photo-2.png')]
      .map((bytes: Uint8Array) => [...bytes]);
  });
  expect(assets).toEqual([[1, 2, 3], [4, 5]]);
  const markdown = await docText(page);
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(markdown);
  await controllerOpen(page, '/sample/inline.md');
  expect(await docText(page)).toBe(markdown);
});

test('untitled paste prompts Save As before writing an asset', async ({ page }) => {
  await openApp(page, { doc: 'none' });
  await pushSaveAnswer(page, '/notes/New.md');
  await transferFile(page, 'paste', 'image.png', [9, 8, 7]);
  await expect.poll(() => docText(page)).toContain('![image](assets/image.png)');
  const state = await page.evaluate(() => ({
    path: (window as any).__scrivo.controller.info().path,
    bytes: [...(window as any).__scrivo.platform.disk.getBytes('/notes/assets/image.png')],
  }));
  expect(state).toEqual({ path: '/notes/New.md', bytes: [9, 8, 7] });
});

test('Save As during attachment paste starts watching the chosen document', async ({ page }) => {
  await openApp(page, { doc: 'none' });
  await pushSaveAnswer(page, '/notes/New.md');
  await transferFile(page, 'paste', 'image.png', [9]);
  await expect.poll(() => page.evaluate(() => (window as any).__scrivo.platform.watchedPath()))
    .toBe('/notes/New.md');
  await diskPut(page, '/notes/New.md', 'Changed elsewhere');
  await page.evaluate(() => (window as any).__scrivo.platform.disk.notify('/notes/New.md'));
  await expect(page.locator('.modal-backdrop')).toContainText('changed on disk');
});

test('failed import preserves clipboard text and inserts no broken link', async ({ page }) => {
  await openApp(page, { text: 'Start ' });
  await setCaret(page, 6);
  await page.evaluate(() => (window as any).__scrivo.platform.disk.failNextAttachmentImport(new Error('permission denied')));
  await transferFile(page, 'paste', 'blocked.png', [1], 'plain fallback');
  await expect.poll(() => docText(page)).toBe('Start plain fallback');
  expect(await page.evaluate(() => (window as any).__scrivo.platform.disk.getBytes('/sample/assets/blocked.png'))).toBeUndefined();
  await expect(page.getByText(/Could not import attachment/)).toBeVisible();
});

test('paste preserves text carried with an image', async ({ page }) => {
  await openApp(page, { text: '' });
  await transferFile(page, 'paste', 'diagram.png', [1, 2], 'Diagram caption');
  await expect.poll(() => docText(page)).toBe('Diagram caption\n![diagram](assets/diagram.png)');
});

test('oversized clipboard files are rejected before Save As', async ({ page }) => {
  await openApp(page, { doc: 'none' });
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'large.bin'));
    (window as any).__scrivo.editor.view.contentDOM.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await expect(page.getByText(/64 MiB import limit/)).toBeVisible();
  expect(await docText(page)).toBe('');
  expect(await page.evaluate(() => (window as any).__scrivo.controller.info().path)).toBeNull();
});

test('dropping a browser file inserts at the drop position', async ({ page }) => {
  await openApp(page, { text: 'Start ' });
  await setCaret(page, 0);
  await transferFile(page, 'drop', 'drop.png', [6, 7]);
  await expect.poll(() => docText(page)).toBe('Start ![drop](assets/drop.png)');
  expect(await page.evaluate(() => [...(window as any).__scrivo.platform.disk.getBytes('/sample/assets/drop.png')])).toEqual([6, 7]);
});

test('a pending attachment insertion cannot edit a newly opened document', async ({ page }) => {
  await openApp(page, { text: 'First' });
  await diskPut(page, '/sample/other.md', 'Second');
  await page.evaluate(() => {
    (window as any).__pendingInsertion = (window as any).__scrivo.editor.beginInsertion();
  });
  await controllerOpen(page, '/sample/other.md');
  const inserted = await page.evaluate(() => (window as any).__pendingInsertion.insert('![wrong](assets/wrong.png)'));
  expect(inserted).toBe(false);
  expect(await docText(page)).toBe('Second');
});
