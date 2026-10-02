import { expect, test } from '@playwright/test';
import { controllerOpen, diskGet, diskPut, docText, openApp } from './helpers';

const original = '---\n# Comment before\ntitle: Old  # inline\nscore: 7\ndone: false\nunknown: !custom value\nnested:\n  tags: [one, two]\n---\n# Body\n\nText.\n';

test('property edits preserve unrelated YAML and have independent undo/save/reopen outcomes', async ({ page }) => {
  await openApp(page, { text: original });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByRole('textbox', { name: 'Property title', exact: true }).fill('New: 😀');
  await page.getByRole('button', { name: 'Save property title', exact: true }).click();
  const titled = original.replace('title: Old', 'title: "New: 😀"');
  expect(await docText(page)).toBe(titled);
  await page.keyboard.press('Control+z');
  expect(await docText(page)).toBe(original);
  await page.keyboard.press('Control+Shift+z');
  expect(await docText(page)).toBe(titled);
  await page.getByRole('checkbox', { name: 'Property done', exact: true }).check();
  await page.getByRole('button', { name: 'Save property done', exact: true }).click();
  const done = titled.replace('done: false', 'done: true');
  expect(await docText(page)).toBe(done);
  await page.keyboard.press('Control+z');
  expect(await docText(page)).toBe(titled);
  await page.keyboard.press('Control+Shift+z');
  expect(await docText(page)).toBe(done);
  await page.keyboard.press('Control+s');
  await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(done);
  await controllerOpen(page, '/sample/inline.md');
  expect(await docText(page)).toBe(done);
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Property title', exact: true })).toHaveValue('New: 😀');
  await expect(page.getByRole('checkbox', { name: 'Property done', exact: true })).toBeChecked();
  await expect(page.locator('.properties-notice')).toContainText('2 complex or unsupported properties');
});

test('adding a property preserves the document and is one undo step', async ({ page }) => {
  await openApp(page, { text: '# Body\n' });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByRole('textbox', { name: 'New property name' }).fill('author');
  await page.getByRole('textbox', { name: 'New property value' }).fill('Ada');
  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  expect(await docText(page)).toBe('---\nauthor: "Ada"\n---\n# Body\n');
  await page.keyboard.press('Control+z');
  expect(await docText(page)).toBe('# Body\n');
});

test('invalid YAML stays intact and can be edited through source mode', async ({ page }) => {
  const text = '---\ntitle: [bad\n---\n# Body\n';
  await openApp(page, { text });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(page.locator('.properties-notice')).toContainText('invalid YAML');
  await expect(page.getByRole('button', { name: 'Add property', exact: true })).toHaveCount(0);
  expect(await docText(page)).toBe(text);
  await page.getByRole('button', { name: 'Edit YAML in source' }).click();
  await expect(page.locator('.cm-source-mode')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeFocused();
  expect(await docText(page)).toBe(text);
});

test('an open stale property control cannot overwrite a source edit', async ({ page }) => {
  await openApp(page, { text: original });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const replaced = original.replace('title: Old', 'title: External');
  await page.evaluate((text) => (window as any).__scrivo.editor.port.replace(text), replaced);
  await page.getByRole('textbox', { name: 'Property title', exact: true }).fill('Draft');
  await page.getByRole('button', { name: 'Save property title', exact: true }).click();
  await expect(page.locator('.properties-notice')).toContainText('changed in the document');
  expect(await docText(page)).toBe(replaced);
});

test('properties edits stay local to their tab and Escape returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openApp(page, { text: original });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByRole('textbox', { name: 'Property title', exact: true }).fill('First draft');
  await diskPut(page, '/sample/second.md', '---\ntitle: Second\n---\n# Second\n');
  await page.evaluate(() => (window as any).__scrivo.tabs.open('/sample/second.md'));
  await page.keyboard.press('Control+e');
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Property title', exact: true })).toHaveValue('Second');
  await page.getByRole('textbox', { name: 'Property title', exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Properties', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'inline.md', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Property title', exact: true })).toHaveValue('First draft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await docText(page)).toBe(original.replace('title: Old', 'title: "First draft"'));
});

test('typing properties and saving from the panel writes the current values', async ({ page }) => {
  await openApp(page, { text: original });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Property title', exact: true });
  await title.fill('Saved directly');
  await title.press('Control+s');
  await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(original.replace('title: Old', 'title: "Saved directly"'));
  await page.getByRole('spinbutton', { name: 'Property score', exact: true }).fill('');
  await page.getByRole('spinbutton', { name: 'Property score', exact: true }).press('Control+s');
  await expect(page.locator('.properties-notice')).toContainText('valid number');
  expect(await docText(page)).toContain('score: 7');
  await page.getByRole('spinbutton', { name: 'Property score', exact: true }).fill('3.5');
  await page.getByRole('spinbutton', { name: 'Property score', exact: true }).press('Control+s');
  await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe(original.replace('title: Old', 'title: "Saved directly"').replace('score: 7', 'score: 3.5'));
});
