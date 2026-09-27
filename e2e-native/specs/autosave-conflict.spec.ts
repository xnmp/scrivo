import { $, browser, expect } from '@wdio/globals';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { state } from '../state';

describe('native autosave conflict', () => {
  it('keeps the competing file and a recovery copy until the user resolves it', async () => {
    const fixture = state.fixture!;
    const content = $('.cm-content');
    await content.waitForDisplayed({ timeout: 15_000 });
    await content.click();
    await browser.keys(['Control', 'End']);
    await browser.keys(' mine');
    await browser.waitUntil(() => content.getText().then((text) => text.includes('mine')), {
      timeout: 5_000,
      timeoutMsg: 'the local edit never appeared',
    });

    writeFileSync(fixture.docPath, 'Theirs\n');
    const prompt = $('.modal h2');
    const action = $('.save-status-action');
    await browser.waitUntil(async () => (await prompt.isDisplayed()) || (await action.isDisplayed()), {
      timeout: 10_000,
      timeoutMsg: 'the competing edit did not produce a conflict state',
    });
    if (await prompt.isDisplayed()) await $('button[data-choice="keep"]').click();
    await action.waitForDisplayed({ timeout: 10_000 });
    expect(await action.getAttribute('aria-label')).toContain('changed on disk');
    await browser.pause(2200);
    expect(readFileSync(fixture.docPath, 'utf8')).toBe('Theirs\n');

    const recoveryDir = path.join(fixture.dir, 'data', 'dev.scrivo.editor', 'recovery');
    const copies = readdirSync(recoveryDir).filter((name) => name.endsWith('.json'));
    expect(copies.length).toBe(1);
    const copy = JSON.parse(readFileSync(path.join(recoveryDir, copies[0]!), 'utf8'));
    expect(copy.text).toBe('Start\n mine');
    expect(copy.path).toBe(fixture.docPath);
  });
});
