import { execFileSync } from 'node:child_process';
import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';
describe('native commands and integrated chrome', () => {
  it('creates tabs, protects dirty close, opens recents, persists hotkeys/themes and saves palette formatting', async () => {
    await $('#document h1').waitForDisplayed({ timeout: 15_000 });
    const original = readFileSync(state.fixture!.docPath, 'utf8');
    await browser.saveScreenshot('/tmp/scrivo-native-chrome.png');
    const position = await browser.execute(async () => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|outer_position', { label: 'main' }));
    const drag = await browser.execute(() => { const rect = document.querySelector('.window-drag')!.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; });
    // WebDriver DOM actions do not move the X pointer used by native window moves.
    execFileSync('python3', ['e2e-native/x11-drag.py', String(Math.round(position.x + drag.x)), String(Math.round(position.y + drag.y)), '60', '40']);
    await browser.waitUntil(async () => {
      const next = await browser.execute(async () => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|outer_position', { label: 'main' }));
      // Openbox can adjust the client frame when dragging from the screen edge.
      return next.x >= position.x + 30 && next.y >= position.y + 20;
    });
    const initialWidth = await browser.execute(() => window.innerWidth);
    await $('[aria-label="Maximize or restore window"]').click();
    await browser.waitUntil(() => browser.execute((width: number) => window.innerWidth > width, initialWidth));
    await $('[aria-label="Maximize or restore window"]').click();
    await browser.waitUntil(() => browser.execute((width: number) => window.innerWidth === width, initialWidth));
    await browser.keys(['Control', 't']);
    await $('.document-session:not([hidden]) .cm-content').waitForDisplayed({ timeout: 10_000 });
    await browser.keys('Draft text');
    expect(await browser.execute(() => document.querySelectorAll('.tab-select').length)).toBe(2);
    await $('[aria-label="Close window"]').click();
    await $('.modal h2').waitForDisplayed();
    expect(await $('.modal h2').getText()).toContain('Untitled');
    await $('button[data-choice="cancel"]').click();
    expect(await browser.execute(() => document.querySelectorAll('.tab-select').length)).toBe(2);
    await browser.keys(['Control', 'w']); await $('button[data-choice="discard"]').waitForDisplayed(); await $('button[data-choice="discard"]').click();
    await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('.tab-select').length === 1));
    await browser.keys(['Control', 'w']);
    await $('.document-session:not([hidden]) .cm-content').waitForDisplayed();
    await browser.keys(['Control', 'r']); await $('[aria-label="Search recent files"]').waitForDisplayed();
    await $('[aria-label="Search recent files"]').setValue('doc.md'); await browser.keys('Enter');
    await $('.document-session:not([hidden]) .markdown-body h1').waitForDisplayed();
    expect(await $('.document-session:not([hidden]) .markdown-body h1').getText()).toBe('Before');
    await browser.keys(['Control', 'p']); await $('[aria-label="Search commands"]').setValue('heading 2'); await browser.keys('Enter');
    await $('.document-session:not([hidden]) .cm-content').waitForDisplayed();
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(state.fixture!.docPath, 'utf8') === original.replace('# Before', '## Before'));
    await browser.keys(['Control', ',']); await $('[aria-label="Theme"]').selectByAttribute('value', 'builtin:ember');
    await $('[aria-label="Color scheme"]').selectByAttribute('value', 'dark'); await browser.keys('Escape');
    await browser.keys(['Control', 'p']); await $('[aria-label="Search commands"]').setValue('customize hotkeys'); await browser.keys('Enter');
    await $('[aria-label="Search hotkeys"]').setValue('New tab');
    await $('[aria-label="Remove Ctrl+T from New tab"]').click(); await $('[aria-label="Remove Ctrl+N from New tab"]').click();
    await $('[aria-label="Add hotkey for New tab"]').click(); await browser.keys(['Control', 'Alt', 'j']);
    await $('//dialog[@aria-label="Hotkeys"]//button[normalize-space(.)="Close"]').click();
    await $('[aria-label="Minimize window"]').click();
    await browser.waitUntil(() => browser.execute(async () => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' })));
    await browser.reloadSession(); await $('#document h2').waitForDisplayed({ timeout: 15_000 });
    expect(await browser.execute(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(38, 37, 36)');
    await browser.keys(['Control', 'Alt', 'j']); await $('.document-session:not([hidden]) .cm-content').waitForDisplayed();
    expect(await browser.execute(() => document.querySelectorAll('.tab-select').length)).toBe(2);
  });
});
