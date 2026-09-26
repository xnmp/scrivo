import { $, browser } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';

describe('checkbox toggle then save', () => {
  it('writes [x] to disk after clicking the task checkbox and saving', async () => {
    const fixture = state.fixture!;
    const box = $('input.cm-lp-checkbox');
    await box.waitForExist({ timeout: 15_000 });
    await box.click();
    await browser.keys(['Control', 's']);

    let lastSeen = '<never read>';
    await browser.waitUntil(
      () => {
        try {
          lastSeen = readFileSync(fixture.docPath, 'utf8');
          return lastSeen.includes('[x]');
        } catch (e) {
          lastSeen = `<read error: ${e}>`;
          return false;
        }
      },
      { timeout: 10_000, interval: 200, timeoutMsg: () => `file on disk never showed the checked task; last seen: ${JSON.stringify(lastSeen)}` },
    );
  });
});
