import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';

describe('missing file path', () => {
  it('starts with an empty document and creates the file on first save', async () => {
    const fixture = state.fixture!;
    const content = $('.cm-content');
    await content.waitForExist({ timeout: 15_000 });
    expect((await content.getText()).trim()).toBe('');

    await content.click();
    // Avoid consecutive repeated characters: WebKitWebDriver's key-action replay
    // can coalesce back-to-back identical keydown/keyup pairs into one keystroke.
    const text = 'created';
    await browser.keys(text);
    await browser.keys(['Control', 's']);

    await browser.waitUntil(
      () => {
        try {
          return readFileSync(fixture.docPath, 'utf8') === text;
        } catch {
          return false;
        }
      },
      { timeout: 10_000, interval: 200, timeoutMsg: 'file was never created with the typed content' },
    );
  });
});
