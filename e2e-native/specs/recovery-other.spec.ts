import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';

describe('recovery while viewing another file', () => {
  it('shows the accepted recovery in the editor instead of leaving it hidden', async () => {
    const fixture = state.fixture!;
    await $('#viewer').waitForDisplayed({ timeout: 15_000 });
    const prompt = $('.modal h2');
    await prompt.waitForDisplayed({ timeout: 15_000 });
    expect(await prompt.getText()).toBe('Recover edits to deleted.md?');
    await $('button[data-choice="restore"]').click();
    await browser.waitUntil(async () => (await $('.cm-content').isDisplayed())
      && (await $('.cm-content').getText()).includes('Recovered other file'), {
      timeout: 10_000,
      timeoutMsg: 'the recovered document was not visible in the editor',
    });
    expect(await $('.save-status-action').isDisplayed()).toBe(true);
    expect(readFileSync(fixture.docPath, 'utf8')).toBe('# Original reading view\n');
  });
});
