import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { state } from '../state';
import { openSettings, runCommand } from '../commands';
import { execFileSync } from 'node:child_process';

describe('native settings, substitutions and final-tab close', () => {
  it('dismisses surfaces with Escape, selects occurrences, substitutes typing, persists and protects final close', async () => {
    const path = state.fixture!.docPath;
    await $('#document h1').waitForDisplayed();
    await browser.keys(['Control', 'p']); await $('[aria-label="Search commands"]').waitForDisplayed();
    await browser.keys('Escape'); await browser.waitUntil(() => browser.execute(() => !document.querySelector('dialog[open]')));
    await openSettings('Substitutions'); await browser.keys('Escape');
    await browser.waitUntil(() => browser.execute(() => !document.querySelector('dialog[open]')));
    await runCommand('Document properties'); await $('.properties-panel').waitForDisplayed(); await browser.keys('Escape');
    await browser.waitUntil(() => browser.execute(() => (document.querySelector('.properties-panel') as HTMLElement).hidden));
    await runCommand('Toggle contents'); await $('#outline-panel').waitForDisplayed(); await browser.keys('Escape');
    await browser.waitUntil(() => browser.execute(() => (document.querySelector('#outline-panel') as HTMLElement).hidden));
    await $('.cm-content').waitForDisplayed();
    await $('.cm-content').click();
    await browser.keys(['Control', 'End']); await browser.keys('Enter'); await browser.keys('one one');
    await browser.keys(['Control', 'ArrowLeft']);
    await browser.keys(['Control', 'd']); await browser.keys(['Control', 'd']);
    await browser.keys('two');
    expect(await browser.execute(() => document.querySelectorAll('.tab-select').length)).toBe(1);
    expect(await $('.cm-content').getText()).toContain('two two');
    await browser.keys(['Control', 'End']); await browser.keys(' !='); await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(path, 'utf8').endsWith('two two ≠'));
    await openSettings('Substitutions'); await $('button=Add substitution').click();
    const row = $('.substitution-row:last-child');
    await row.$('[aria-label="Replace this"]').setValue('brb'); await row.$('[aria-label="With this"]').setValue('be right back');
    await browser.keys('Escape'); await browser.reloadSession(); await $('#document h1').waitForDisplayed();
    await browser.keys(['Control', 'e']); await $('.cm-content').waitForDisplayed(); await browser.keys(['Control', 'End']); await browser.keys(' brb');
    await browser.keys(['Control', 'w']); await $('.modal h2').waitForDisplayed(); await $('button[data-choice="cancel"]').click();
    expect(await browser.execute(() => document.querySelectorAll('.tab-select').length)).toBe(1);
    await browser.keys(['Control', 's']); await browser.waitUntil(() => readFileSync(path, 'utf8').endsWith('be right back'));
    // The reloaded WebKit session can lack _NET_ACTIVE_WINDOW; find its app in
    // this isolated driver's process group instead of relying on X11 focus.
    const appProcess = execFileSync('ps', ['-eo', 'pid=,pgid=,comm='], { encoding: 'utf8' }).split('\n')
      .map(line => line.trim().split(/\s+/))
      .find(([, group, command]) => Number(group) === state.driverPid && command === 'scrivo');
    const pid = Number(appProcess?.[0]);
    if (!pid) throw new Error('No app process in private test driver group');
    // Closing the real app invalidates WebDriver's window; verify its native process exited.
    let closeError: unknown;
    try { await browser.keys(['Control', 'w']); } catch (error) { closeError = error; }
    await browser.waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } },
      { timeout: 10_000, timeoutMsg: `Final Ctrl+W did not close app: ${String(closeError ?? '')}` });
  });
});
