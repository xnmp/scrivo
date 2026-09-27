import { $, browser, expect } from '@wdio/globals';
import { existsSync } from 'node:fs';
import { state } from '../state';

describe('named recovery without an open file', () => {
  it('offers a deleted named file copy on an untitled launch', async () => {
    const fixture = state.fixture!;
    const prompt = $('.modal h2');
    await prompt.waitForDisplayed({ timeout: 15_000 });
    expect(await prompt.getText()).toBe('Recover edits to deleted.md?');
    await $('button[data-choice="restore"]').click();
    await browser.waitUntil(() => $('.cm-content').getText().then((text) => text.includes('Recovered missing file')), {
      timeout: 10_000,
      timeoutMsg: 'the named recovery did not appear in the editor',
    });
    expect(await $('.save-status-action').isDisplayed()).toBe(true);
    expect(existsSync(fixture.docPath)).toBe(false);
  });
});
