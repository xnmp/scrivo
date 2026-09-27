import { $, browser, expect } from '@wdio/globals';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { state } from '../state';

describe('native document tabs', () => {
  it('deduplicates symlink aliases, saves independently, and reloads an inactive file on activation', async () => {
    const fixture = state.fixture!;
    await $('#document h1').waitForDisplayed({ timeout: 15_000 });
    await $('#document a[href="second.md"]').click();
    await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('.tab-select').length === 2), { timeout: 10_000 });
    const activeHeading = $('.document-session:not([hidden]) .markdown-body h1');
    await activeHeading.waitForDisplayed({ timeout: 10_000 });
    expect(await activeHeading.getText()).toBe('Second');

    await $('.tab-select[title="first.md"]').click();
    await $('#document a[href="alias.md"]').click();
    expect(await browser.execute(() => document.querySelectorAll('.tab-select').length)).toBe(2);
    expect(await activeHeading.getText()).toBe('Second');

    await browser.keys(['Control', 'e']);
    const content = $('.document-session:not([hidden]) .cm-content');
    await content.waitForDisplayed({ timeout: 10_000 });
    await content.click();
    await browser.keys(['Control', 'End']);
    await browser.keys(' native edit');
    await browser.keys(['Control', 's']);
    const secondPath = path.join(fixture.dir, 'second.md');
    await browser.waitUntil(() => readFileSync(secondPath, 'utf8').includes('native edit'), { timeout: 10_000 });

    await $('.tab-select[title="first.md"]').click();
    expect(await $('#document h1').getText()).toBe('First');
    await browser.keys(['Control', 'e']);
    const firstContent = $('#session-initial .cm-content');
    await firstContent.waitForDisplayed({ timeout: 10_000 });
    await firstContent.click();
    await browser.keys(['Control', 'End']);
    await browser.keys(' first edit');
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(fixture.docPath, 'utf8').includes('first edit'), { timeout: 10_000 });
    await browser.keys(['Control', 'e']);
    const replacement = path.join(fixture.dir, 'replacement.md');
    writeFileSync(replacement, '# External change\n');
    renameSync(replacement, secondPath);
    await $('.tab-select[title="second.md"]').click();
    await browser.waitUntil(async () => (await $('.document-session:not([hidden]) .cm-content').getText()).includes('External change'), {
      timeout: 10_000,
      timeoutMsg: 'inactive document did not reload after external replacement',
    });
    expect(readFileSync(fixture.docPath, 'utf8')).toContain('first edit');
    expect(readFileSync(secondPath, 'utf8')).toBe('# External change\n');

    await $('.document-session:not([hidden]) .cm-content').click();
    await browser.keys(['Control', 'End']);
    await browser.keys(' unsaved');
    await $('.tab-close[title="Close second.md"]').click();
    await $('.modal h2').waitForDisplayed({ timeout: 10_000 });
    expect(await $('.modal h2').getText()).toContain('second.md');
    await $('button[data-choice="discard"]').click();
    await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('.tab-select').length === 1), { timeout: 10_000 });
    expect(readFileSync(secondPath, 'utf8')).toBe('# External change\n');

    await browser.reloadSession();
    await $('#document h1').waitForDisplayed({ timeout: 15_000 });
    expect(await $('#document').getText()).toContain('first edit');
    await $('#document a[href="second.md"]').click();
    await $('.document-session:not([hidden]) .markdown-body h1').waitForDisplayed({ timeout: 10_000 });
    expect(await $('.document-session:not([hidden]) .markdown-body h1').getText()).toBe('External change');
    expect(readFileSync(fixture.docPath, 'utf8')).toContain('first edit');
    expect(readFileSync(secondPath, 'utf8')).toBe('# External change\n');
  });
});
