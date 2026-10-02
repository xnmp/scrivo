import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';

describe('native editor find and replace', () => {
  it('replaces all matches, undoes and redoes, saves exact bytes and reopens the result', async () => {
    const original = readFileSync(state.fixture!.docPath, 'utf8');
    await $('.cm-content').waitForDisplayed();
    await browser.keys(['Control', 'h']);
    await $('.cm-search input[name="search"]').waitForDisplayed();
    await $('.cm-search input[name="search"]').click();
    await browser.keys(['Control', 'a']);
    await browser.keys('Parent');
    await $('.cm-search input[name="replace"]').click();
    await browser.keys('Base');
    await $('.cm-search button[name="replaceAll"]').click();
    await browser.keys(['Escape']);
    await $('.cm-content').click();
    await browser.keys(['Control', 's']);
    const replaced = original.replaceAll('Parent', 'Base');
    await browser.waitUntil(() => readFileSync(state.fixture!.docPath, 'utf8') === replaced);
    await browser.keys(['Control', 'z']);
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(state.fixture!.docPath, 'utf8') === original);
    await browser.keys(['Control', 'Shift', 'z']);
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(state.fixture!.docPath, 'utf8') === replaced);
    await browser.reloadSession();
    await $('.cm-content').waitForDisplayed();
    expect(await $('.cm-content').getText()).toContain('Base and Base');
    expect(readFileSync(state.fixture!.docPath, 'utf8')).toBe(replaced);
  });
});
