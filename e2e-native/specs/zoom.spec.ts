import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';
import { runCommand } from '../commands';

describe('native WebView zoom', () => {
  it('zooms the actual viewport in reader and Settings, then resets without editing the file', async () => {
    await $('#document h1').waitForDisplayed({ timeout: 15_000 });
    const original = readFileSync(state.fixture!.docPath, 'utf8');
    const initial = await browser.execute(() => window.innerWidth);
    await browser.keys(['Control', '=']);
    await browser.waitUntil(async () => (await browser.execute(() => window.innerWidth)) < initial, {
      timeout: 5000, timeoutMsg: 'native WebView did not zoom in',
    });
    const zoomed = await browser.execute(() => window.innerWidth);
    expect(Math.abs(zoomed - initial / 1.1)).toBeLessThan(2);
    await browser.keys(['Control', ',']);
    await $('#scrivo-settings').waitForDisplayed();
    await browser.keys(['Control', '-']);
    await browser.waitUntil(async () => Math.abs((await browser.execute(() => window.innerWidth)) - initial) < 2);
    await browser.keys('Escape');
    await browser.keys(['Control', 'Shift', '=']);
    await browser.waitUntil(async () => (await browser.execute(() => window.innerWidth)) < initial);
    await runCommand('Reset zoom');
    await browser.waitUntil(async () => Math.abs((await browser.execute(() => window.innerWidth)) - initial) < 2);
    expect(readFileSync(state.fixture!.docPath, 'utf8')).toBe(original);
    expect(await $('#document h1').getText()).toBe('Before');
  });
});
