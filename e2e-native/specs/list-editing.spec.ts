import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';

describe('native list editing', () => {
  it('ends an empty list item with Enter and saves the resulting Markdown', async () => {
    const fixture = state.fixture!;
    await $('.cm-content').waitForDisplayed({ timeout: 15_000 });
    await $('.cm-content').click();
    await browser.keys(['Control', 'End']);
    await browser.keys(['Enter']);
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(fixture.docPath, 'utf8') !== '- first\n- ', {
      timeout: 10_000,
      timeoutMsg: 'the Enter edit did not reach the file',
    });
    expect(readFileSync(fixture.docPath, 'utf8')).toBe('- first\n');
  });

  it('continues a new item in source mode and saves the exact markers', async () => {
    const fixture = state.fixture!;
    await browser.keys(['Control', '/']);
    await $('.cm-source-mode').waitForExist({ timeout: 5_000 });
    await browser.keys('- second');
    await browser.keys(['Enter']);
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(fixture.docPath, 'utf8') === '- first\n- second\n- ', {
      timeout: 10_000,
      timeoutMsg: 'source-mode list continuation did not save the expected Markdown',
    });
  });
});
