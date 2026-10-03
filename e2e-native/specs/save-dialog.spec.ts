import { $, browser, expect } from '@wdio/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { state } from '../state';

describe('native app save modal', () => {
  it('cancels without writing, then saves an untitled tab through its own modal and saves directly thereafter', async () => {
    await $('#document h1').waitForDisplayed(); await browser.keys(['Control', 't']);
    const content = $('.document-session:not([hidden]) .cm-content'); await content.waitForDisplayed(); await content.click();
    await browser.keys('Native modal text'); await browser.keys(['Control', 's']);
    const modal = $('dialog[aria-label="Save document"]'); await modal.waitForDisplayed();
    expect(await modal.$('input').getValue()).toBe('Untitled.md');
    await browser.keys('Escape'); await browser.waitUntil(() => browser.execute(() => !document.querySelector('dialog[open]')));
    const target = path.join(state.fixture!.dir, 'modal note.md'); expect(existsSync(target)).toBe(false);
    await browser.keys(['Control', 's']); await modal.waitForDisplayed();
    const fields = await modal.$$('input'); await fields[0].setValue('modal note.md'); await fields[1].setValue(path.join(state.fixture!.dir, 'missing-folder'));
    await modal.$('button=Save').click(); await modal.$('[role="status"]').waitForDisplayed();
    expect(await fields[0].getValue()).toBe('modal note.md'); expect(existsSync(target)).toBe(false);
    await fields[1].setValue(state.fixture!.dir);
    await modal.$('button=Save').click();
    await browser.waitUntil(() => existsSync(target) && readFileSync(target, 'utf8') === 'Native modal text');
    await content.click(); await browser.keys(['Control', 'End']); await browser.keys('!'); await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(target, 'utf8') === 'Native modal text!');
    expect(await browser.execute(() => Boolean(document.querySelector('dialog[open]')))).toBe(false);
  });
});
