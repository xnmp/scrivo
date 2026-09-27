import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
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
});
