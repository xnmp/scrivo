import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';

describe('native editor folding', () => {
  it('folds a heading with an accessible button without changing the file', async () => {
    const fixture = state.fixture!;
    const original = readFileSync(fixture.docPath, 'utf8');
    const content = $('.cm-content');
    await content.waitForDisplayed({ timeout: 15_000 });
    const fold = $('.cm-fold-toggle[aria-label="Fold heading First (line 1)"]');
    await fold.waitForDisplayed({ timeout: 15_000 });
    await fold.click();
    await browser.waitUntil(() => content.getText().then((text) => !text.includes('body')), {
      timeout: 5_000,
      timeoutMsg: 'the heading section did not collapse',
    });
    expect(readFileSync(fixture.docPath, 'utf8')).toBe(original);
    const unfold = $('.cm-fold-toggle[aria-label="Unfold heading First (line 1)"]');
    await unfold.waitForDisplayed({ timeout: 5_000 });
    await unfold.click();
    await browser.waitUntil(() => content.getText().then((text) => text.includes('body')), {
      timeout: 5_000,
      timeoutMsg: 'the section did not expand again',
    });
    expect(readFileSync(fixture.docPath, 'utf8')).toBe(original);
  });
});
