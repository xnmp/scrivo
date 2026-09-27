import { $, browser, expect } from '@wdio/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { state } from '../state';

function testAppPid(): number {
  const group = state.driverPid;
  if (group === undefined) throw new Error('native driver PID is missing');
  const application = path.resolve('src-tauri/target/debug/scrivo');
  const processes = execFileSync('ps', ['-eo', 'pid=,pgid=,args='], { encoding: 'utf8' });
  for (const line of processes.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match && Number(match[2]) === group && (match[3] === application || match[3]?.startsWith(`${application} `))) {
      return Number(match[1]);
    }
  }
  throw new Error('could not identify the isolated Scrivo process');
}

describe('native crash recovery', () => {
  it('restores exact untitled Markdown after the app is killed and relaunched', async () => {
    const fixture = state.fixture!;
    const content = $('.cm-content');
    await content.waitForDisplayed({ timeout: 15_000 });
    await content.click();
    await browser.keys('# Crash draft');
    await browser.keys(['Enter']);
    await browser.keys('Unicode 漢 and | pipes');

    const recoveryDir = path.join(fixture.dir, 'data', 'dev.scrivo.editor', 'recovery');
    await browser.waitUntil(() => {
      try {
        const files = readdirSync(recoveryDir).filter((name) => name.endsWith('.json'));
        if (files.length !== 1) return false;
        const copy = JSON.parse(readFileSync(path.join(recoveryDir, files[0]!), 'utf8'));
        return copy.path === null && copy.text === '# Crash draft\nUnicode 漢 and | pipes';
      } catch { return false; }
    }, { timeout: 10_000, interval: 100, timeoutMsg: 'the native app did not persist the untitled recovery copy' });

    process.kill(testAppPid(), 'SIGKILL');
    await browser.reloadSession();
    const prompt = $('.modal h2');
    await prompt.waitForDisplayed({ timeout: 15_000 });
    expect(await prompt.getText()).toBe('Recover edits to Untitled?');
    await $('button[data-choice="restore"]').click();
    await browser.waitUntil(() => $('.cm-content').getText().then((text) => text.includes('Unicode 漢 and | pipes')), {
      timeout: 10_000,
      timeoutMsg: 'restored Markdown did not appear in the editor',
    });
    expect(await $('.cm-content').getText()).toContain('Crash draft');
    expect(readdirSync(recoveryDir).some((name) => name.endsWith('.json'))).toBe(true);
  });
});
