import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { state } from '../state';

describe('live table editing', () => {
  it('edits a rendered cell and saves the resulting Markdown', async () => {
    const fixture = state.fixture!;
    const content = $('.cm-content');
    await content.waitForDisplayed({ timeout: 15_000 });
    await content.click();
    await browser.keys(['Control', 'End']);
    const cell = $('.cm-lp-table tbody tr:first-child td:first-child');
    await cell.waitForDisplayed({ timeout: 15_000 });
    await cell.click();
    const input = $('.cm-lp-table-input');
    await input.waitForDisplayed();
    await browser.keys(['Control', 'a']);
    await browser.keys('Alex');
    expect(await $('.cm-lp-table').isDisplayed()).toBe(true);
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(fixture.docPath, 'utf8').includes('| Alex | 10 |'), {
      timeout: 10_000,
      timeoutMsg: 'edited table cell was not saved to Markdown',
    });
    await browser.keys(['Escape']);
    await browser.keys(['Shift', 'F10']);
    const align = $('button=Align center');
    await align.waitForDisplayed();
    await align.click();
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(fixture.docPath, 'utf8').includes('| :---: | ---: |'), {
      timeout: 10_000,
      timeoutMsg: 'table alignment was not saved to Markdown',
    });
  });

  it('pastes an X11 spreadsheet block into the table and saves every cell', async () => {
    const fixture = state.fixture!;
    await $('.cm-lp-table tbody tr:first-child td:first-child').click();
    await $('.cm-lp-table-input').waitForDisplayed();
    const copied = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'text/plain', '-i'], {
      input: 'Ana\t25\nBo\t30\n', stdio: ['pipe', 'ignore', 'ignore'],
    });
    expect(copied.status).toBe(0);
    await browser.keys(['Control', 'v']);
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => {
      const saved = readFileSync(fixture.docPath, 'utf8');
      return saved.includes('| Ana | 25 |') && saved.includes('| Bo | 30 |');
    }, { timeout: 10_000, timeoutMsg: 'pasted spreadsheet cells were not saved to Markdown' });
  });
});
