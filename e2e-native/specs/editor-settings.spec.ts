import { openSettings, runCommand } from '../commands';
import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';

describe('native editor settings', () => {
  it('persists editor projections across app relaunch without changing file bytes or undo history', async () => {
    const original = readFileSync(state.fixture!.docPath);
    await $('.cm-content').waitForDisplayed();
    await openSettings('Editor');
    for (const name of ['Line numbers', 'Indentation guides', 'Spellcheck', 'Wrap long lines']) {
      await $(`//section[contains(@class,"editor-settings-page")]//label[contains(., "${name}")]/input`).click();
    }
    await $('[aria-label="Tab display width"]').selectByAttribute('value', '8');
    await browser.keys('Escape');
    await $('.cm-lineNumbers').waitForDisplayed();
    expect(await $('.cm-content').getAttribute('spellcheck')).toBe('false');
    expect(readFileSync(state.fixture!.docPath).equals(original)).toBe(true);
    await $('.cm-content').click();
    await browser.keys(['Control', 'End']);
    await browser.keys('New');
    await browser.keys(['Control', 'z']);
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(state.fixture!.docPath).equals(original));
    await browser.reloadSession();
    await $('.cm-lineNumbers').waitForDisplayed();
    await $('.cm-indent-guides').waitForDisplayed();
    expect(await $('.cm-content').getAttribute('spellcheck')).toBe('false');
    await openSettings('Editor');
    expect(await $('//section[contains(@class,"editor-settings-page")]//label[contains(., "Indentation guides")]/input').isSelected()).toBe(true);
    expect(await $('[aria-label="Tab display width"]').getValue()).toBe('8');
    expect(readFileSync(state.fixture!.docPath).equals(original)).toBe(true);
  });
});
