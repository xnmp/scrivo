import { $, browser, expect } from '@wdio/globals';
import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { state } from '../state';

describe('external file changes', () => {
  it('reloads an atomically replaced document without refocusing the window', async () => {
    const heading = $('#document h1');
    await heading.waitForExist({ timeout: 15_000 });
    expect(await heading.getText()).toBe('Before');

    const fixture = state.fixture!;
    const replacement = path.join(fixture.dir, 'replacement.md');
    writeFileSync(replacement, '# After\n\nUpdated text.\n');
    renameSync(replacement, fixture.docPath);

    await browser.waitUntil(async () => (await $('#document h1').getText()) === 'After', {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: 'reading view did not reload after an atomic external replacement',
    });
    expect(await $('#document').getText()).toContain('Updated text.');
  });
});
