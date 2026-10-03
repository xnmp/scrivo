import { expect, test } from '@playwright/test';
import { diskGet, docText, openApp, openSettings, runCommand, setCaret } from './helpers';

test('minimal chrome and Escape dismiss settings, palette and command-opened document panels', async ({ page }) => {
  await openApp(page, { text: '# Note\n\nText' });
  await expect(page.locator('#tab-bar .icon-button')).toHaveCount(1);
  await expect(page.locator('#document-toolbar')).toBeHidden();
  await expect(page.locator('.outline-toggle, .properties-toggle, .editor-settings-toggle')).toHaveCount(0);
  await page.keyboard.press('Control+p'); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeFocused();
  await openSettings(page, 'Hotkeys'); await page.getByRole('searchbox', { name: 'Search hotkeys' }).fill('next occurrence');
  await page.getByRole('button', { name: 'Add hotkey for Select next occurrence' }).click();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  await runCommand(page, 'Document properties'); await expect(page.locator('.properties-panel')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('.properties-panel')).toBeHidden();
  await expect(page.locator('.cm-content')).toBeFocused();
  await runCommand(page, 'Toggle contents'); await expect(page.locator('#outline-panel')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#outline-panel')).toBeHidden();
});

test('Ctrl D selects successive occurrences and editing changes each selection together', async ({ page }) => {
  await openApp(page, { text: 'one two one one' }); await setCaret(page, 1);
  await page.keyboard.press('Control+d'); await page.keyboard.press('Control+d'); await page.keyboard.press('Control+d');
  await page.keyboard.type('three'); await expect.poll(() => docText(page)).toBe('three two three three');
  await page.keyboard.press('Control+z'); await expect.poll(() => docText(page)).toBe('one two one one');
  await openSettings(page, 'Hotkeys'); await page.getByRole('searchbox', { name: 'Search hotkeys' }).fill('next occurrence');
  await page.getByRole('button', { name: 'Remove Ctrl+D from Select next occurrence' }).click();
  await page.getByRole('button', { name: 'Add hotkey for Select next occurrence' }).click(); await page.keyboard.press('Control+Alt+d');
  await page.keyboard.press('Escape'); await setCaret(page, 1); await page.keyboard.press('Control+Alt+d');
  await page.keyboard.type('X'); await expect.poll(() => docText(page)).toBe('X two one one');
});

test('substitutions type, restore with Backspace, save, persist, and leave paste and existing text unchanged', async ({ page }) => {
  await openApp(page, { text: 'Existing !=\n\n' }); await page.keyboard.press('Control+End');
  await page.keyboard.type('!='); await expect.poll(() => docText(page)).toBe('Existing !=\n\n≠');
  await page.keyboard.press('Backspace'); await expect.poll(() => docText(page)).toBe('Existing !=\n\n!=');
  await openSettings(page, 'Substitutions'); await page.getByRole('button', { name: 'Add substitution', exact: true }).click();
  const row = page.locator('.substitution-row').last();
  await row.getByLabel('Replace this', { exact: true }).fill('brb'); await row.getByLabel('With this', { exact: true }).fill('be right back');
  await page.keyboard.press('Escape'); await page.keyboard.type(' brb');
  await expect.poll(() => docText(page)).toBe('Existing !=\n\n!= be right back');
  await page.keyboard.press('Control+s'); await expect.poll(() => diskGet(page, '/sample/inline.md')).toBe('Existing !=\n\n!= be right back');
  await page.reload(); await page.waitForFunction(() => Boolean((window as any).__scrivo));
  await openSettings(page, 'Substitutions'); await page.getByLabel('Search substitutions').fill('brb');
  await expect(page.getByLabel('With this', { exact: true })).toHaveValue('be right back');
  await page.getByRole('switch', { name: 'Enable substitutions', exact: true }).uncheck(); await page.keyboard.press('Escape');
  await page.keyboard.press('Control+End'); await page.keyboard.type(' !=');
  await expect.poll(() => docText(page)).toContain(' !=');
});

test('regex substitutions show invalid rules and expand captures; multi-cursor input substitutes each occurrence', async ({ page }) => {
  await openApp(page, { text: 'hi hi' });
  await openSettings(page, 'Substitutions'); await page.getByRole('button', { name: 'Add substitution', exact: true }).click();
  const row = page.locator('.substitution-row').last();
  await row.getByRole('button', { name: 'Use regular expressions' }).click();
  await row.getByLabel('Replace this', { exact: true }).fill('/[$/'); await expect(row.locator('.substitution-error')).not.toBeEmpty();
  await row.getByLabel('Replace this', { exact: true }).fill('/(hi)@$/i'); await row.getByLabel('With this', { exact: true }).fill('$1 there');
  await expect(row.locator('.substitution-error')).toBeEmpty(); await page.keyboard.press('Escape');
  await setCaret(page, 1); await page.keyboard.press('Control+d'); await page.keyboard.press('Control+d'); await page.keyboard.press('ArrowRight');
  await page.keyboard.type('@'); await expect.poll(() => docText(page)).toBe('hi there hi there');
  await page.keyboard.press('Backspace'); await expect.poll(() => docText(page)).toBe('hi@ hi@');
});

test('table hover controls append editable rows and columns with undo and preserve alignment', async ({ page }) => {
  const text = 'Before\n\n| Name | Value |\n| :--- | ---: |\n| A | B |\n\nAfter';
  await openApp(page, { text }); const table = page.locator('.cm-lp-table-wrap');
  await table.hover(); await expect(page.getByRole('button', { name: 'Add table row' })).toHaveCSS('cursor', 's-resize');
  await page.getByRole('button', { name: 'Add table row' }).click(); await expect(page.locator('.cm-lp-table tbody tr')).toHaveCount(2);
  await page.keyboard.type('New'); await page.keyboard.press('Escape');
  await expect.poll(() => docText(page)).toContain('| New |');
  await page.getByRole('button', { name: 'Add table column' }).click(); await expect(page.locator('.cm-lp-table th')).toHaveCount(3);
  await page.keyboard.type('Extra'); await expect.poll(() => docText(page)).toContain('Extra');
  await page.keyboard.press('Control+z'); await expect.poll(() => docText(page)).not.toContain('Extra');
  await page.keyboard.press('Control+z'); await expect(page.locator('.cm-lp-table th')).toHaveCount(2);
  expect(await docText(page)).toContain('| :--- | ---: |');
});

test('mixed cursor replacements keep Backspace on every cursor and plain paste stays literal', async ({ page }) => {
  await openApp(page, { text: '! x' });
  // Two independent insertion points: only the first suffix matches a rule.
  await page.evaluate(() => {
    const view = (window as any).__scrivo.editor.view;
    const Selection = view.state.selection.constructor;
    view.dispatch({ selection: Selection.create([Selection.cursor(1), Selection.cursor(3)]) });
  });
  await page.keyboard.type('='); await expect.poll(() => docText(page)).toBe('≠ x=');
  await page.keyboard.press('Backspace'); await expect.poll(() => docText(page)).toBe(' x');
  await setCaret(page, 2);
  await page.keyboard.press('Control+End');
  await page.evaluate(() => {
    const clipboard = new DataTransfer(); clipboard.setData('text/plain', ' !=');
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });
  await expect.poll(() => docText(page)).toBe(' x !=');
});

test('substitution controls preserve long replacements and hotkey recording does not reset appearance', async ({ page }) => {
  await openApp(page, { text: '' }); await openSettings(page);
  await page.getByLabel('Theme', { exact: true }).selectOption('builtin:ember');
  await openSettings(page, 'Hotkeys'); await page.getByLabel('Search hotkeys').fill('next occurrence');
  await page.getByRole('button', { name: 'Add hotkey for Select next occurrence' }).click();
  await page.keyboard.press('Control+Shift+,');
  await expect(page.locator('.hotkeys-dialog [role=status]')).toContainText('Reset appearance');
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('builtin:ember');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Substitutions', exact: true }).click();
  await page.getByRole('button', { name: 'Add substitution', exact: true }).click();
  const row = page.locator('.substitution-row').last();
  await row.getByLabel('With this', { exact: true }).fill('x'.repeat(129));
  await expect(row.getByRole('button', { name: 'Swap source and replacement' })).toBeDisabled();
  await page.keyboard.press('Escape'); await openSettings(page, 'Substitutions');
  await expect(page.locator('.substitution-row').last().getByLabel('With this', { exact: true })).toHaveValue('x'.repeat(129));
});

test('table cells keep multiline substitution triggers literal and selected Backspace deletes text', async ({ page }) => {
  await openApp(page, { text: 'Before\n\n| Name |\n| --- |\n| A |\n\nAfter' });
  await openSettings(page, 'Substitutions'); await page.getByRole('button', { name: 'Add substitution', exact: true }).click();
  const row = page.locator('.substitution-row').last();
  await row.getByLabel('Replace this', { exact: true }).fill('brb'); await row.getByLabel('With this', { exact: true }).fill('a\\nb');
  await page.keyboard.press('Escape'); await page.locator('.cm-lp-table td').dblclick();
  await page.keyboard.type('brb'); await expect.poll(() => docText(page)).toContain('| brb |');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  await expect.poll(() => docText(page)).toContain('|  |');
});

test('dotall regex substitutions match bounded text across lines', async ({ page }) => {
  await openApp(page, { text: '' }); await openSettings(page, 'Substitutions');
  await page.getByRole('button', { name: 'Add substitution', exact: true }).click();
  const row = page.locator('.substitution-row').last();
  await row.getByRole('button', { name: 'Use regular expressions' }).click();
  await row.getByLabel('Replace this', { exact: true }).fill('/foo.*bar$/s');
  await row.getByLabel('With this', { exact: true }).fill('X');
  await page.keyboard.press('Escape'); await page.keyboard.type('foo'); await page.keyboard.press('Enter'); await page.keyboard.type('bar');
  await expect.poll(() => docText(page)).toBe('X');
  await page.keyboard.press('Backspace'); await expect.poll(() => docText(page)).toBe('foo\nbar');
});

test('reading startup loads settings only on demand and repeated shortcuts share one dialog', async ({ page }) => {
  await openApp(page, { text: '# Note\n\nReading', mode: 'view' });
  await expect(page.locator('#scrivo-settings')).toHaveCount(0);
  const initial = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(initial.some(name => /\/(?:settings|substitutions)-[^/]+\.js(?:\?|$)/.test(name))).toBe(false);
  await page.keyboard.press('Control+,'); await page.keyboard.press('Control+,'); await page.keyboard.press('Control+,');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('#scrivo-settings')).toHaveCount(1);
  await page.keyboard.press('Escape'); await openSettings(page, 'Substitutions');
  await expect(page.getByRole('heading', { name: 'Substitutions', exact: true })).toBeVisible();
});

test('Escape cancels an in-flight first Settings open without opening a late dialog', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route('**/assets/settings-*.js', async route => {
    await new Promise<void>(resolve => { release = resolve; }); await route.continue();
  });
  await openApp(page, { text: '# Note', mode: 'view' }); await page.keyboard.press('Control+,');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.keyboard.press('Escape'); release!();
  await expect(page.locator('#scrivo-settings')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  await page.keyboard.press('Control+,'); await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

test('reading startup reconciles packaged theme CSS without constructing Settings', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('scrivo.appearance.v1', JSON.stringify({ mode: 'dark', theme: 'builtin:ember', fontSize: 16 }));
    localStorage.setItem('scrivo.active-theme.v1', JSON.stringify({ id: 'builtin:ember', name: 'Ember', css: '.theme-dark { --background-primary: #123456; }' }));
  });
  await openApp(page, { text: '# Note', mode: 'view' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(38, 37, 36)');
  await expect(page.locator('#scrivo-settings')).toHaveCount(0);
});
