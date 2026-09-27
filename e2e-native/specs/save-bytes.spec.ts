import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import type { SaveBytesFixture } from '../fixtures';
import { state } from '../state';

describe('edit and save preserves bytes', () => {
  it('writes original bytes + typed text, keeping CRLF line endings and the UTF-8 BOM', async () => {
    const fixture = state.fixture as SaveBytesFixture;
    const content = $('.cm-content');
    await content.waitForDisplayed({ timeout: 15_000 });
    await content.click();
    await browser.keys(['Control', 'End']);

    const appended = 'typed';
    await browser.keys(appended);
    await browser.waitUntil(() => content.getText().then((text) => text.includes(appended)), {
      timeout: 5_000,
      timeoutMsg: 'typed text never appeared in the editor',
    });
    await browser.keys(['Control', 's']);

    const expected = Buffer.concat([fixture.original, Buffer.from(appended, 'utf8')]);
    try {
      await browser.waitUntil(
        () => {
          try {
            return readFileSync(fixture.docPath).equals(expected);
          } catch {
            return false;
          }
        },
        { timeout: 10_000, interval: 200, timeoutMsg: 'file on disk never matched original bytes + typed text' },
      );
    } catch (error) {
      const actual = readFileSync(fixture.docPath);
      const visible = await content.getText();
      throw new Error(`${String(error)}; expected=${expected.toString('hex')}; actual=${actual.toString('hex')}; editor=${JSON.stringify(visible)}`);
    }
  });
});
