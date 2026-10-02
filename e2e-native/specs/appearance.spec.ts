import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';

describe('native appearance', () => {
  it('imports Obsidian variables and persists appearance across native relaunch without editing the file', async () => {
    const original = readFileSync(state.fixture!.docPath);
    await $('#document h1').waitForDisplayed();
    await $('.appearance-toggle').click();
    await $('[aria-label="Color scheme"]').selectByAttribute('value', 'dark');
    // Exercise the browser File API/import change event without automating a host file chooser.
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('.appearance-dialog input[type=file]')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(['.theme-dark { --background-primary: #123456; --text-normal: #fedcba; --h1-color: #abcdef; }'], 'Native.css', { type: 'text/css' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => await browser.execute(() => getComputedStyle(document.body).backgroundColor) === 'rgb(18, 52, 86)');
    expect(await browser.execute(() => getComputedStyle(document.querySelector('#document h1')!).color)).toBe('rgb(171, 205, 239)');
    await browser.keys('Escape');
    await browser.keys(['Control', 'e']);
    await $('.cm-content').waitForDisplayed();
    expect(await browser.execute(() => getComputedStyle(document.querySelector('.cm-gutters')!).borderRightWidth)).toBe('0px');
    expect(readFileSync(state.fixture!.docPath).equals(original)).toBe(true);
    await browser.reloadSession();
    await $('#document h1').waitForDisplayed();
    expect(await browser.execute(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(18, 52, 86)');
    expect(await browser.execute(() => getComputedStyle(document.querySelector('#document h1')!).color)).toBe('rgb(171, 205, 239)');
    await $('.appearance-toggle').click();
    await $('//dialog//button[normalize-space(.)="Reset appearance"]').click();
    expect(await $('[aria-label="Theme"]').getValue()).toBe('');
    expect(readFileSync(state.fixture!.docPath).equals(original)).toBe(true);
  });
});
