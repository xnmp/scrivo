import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { state } from '../state';

describe('rich clipboard paste', () => {
  it('converts X11 clipboard HTML into saved portable Markdown', async () => {
    const fixture = state.fixture!;
    const content = $('.cm-content');
    await content.waitForDisplayed({ timeout: 15_000 });
    await content.click();
    await browser.keys(['Control', 'End']);

    const html = '<h2>Imported</h2><p><strong>Bold</strong> and <a href="https://example.com">link</a>.</p><ul><li>One</li><li>Two</li></ul>';
    // xclip forks a clipboard owner; close stdout/stderr so spawnSync does not
    // wait for inherited pipes held by that long-lived owner.
    const copied = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'text/html', '-i'], {
      input: html, stdio: ['pipe', 'ignore', 'ignore'],
    });
    expect(copied.status).toBe(0);
    await browser.keys(['Control', 'v']);
    const expected = '# Rich Paste\n\n## Imported\n\n**Bold** and [link](https://example.com/).\n\n- One\n- Two';
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector('.cm-content')?.textContent ?? '')).includes('Imported'), {
      timeout: 10_000,
      timeoutMsg: 'clipboard HTML was not pasted into the native editor',
    });
    await browser.keys(['Control', '/']);
    await $('.cm-source-mode').waitForExist({ timeout: 5_000 });
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(fixture.docPath, 'utf8') !== '# Rich Paste\n\n', {
      timeout: 10_000,
      timeoutMsg: 'rich native paste did not save as Markdown',
    });
    expect(readFileSync(fixture.docPath, 'utf8')).toBe(expected);
  });
});
