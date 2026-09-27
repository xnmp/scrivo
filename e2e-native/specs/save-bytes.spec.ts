import { $, browser, expect } from '@wdio/globals';
import { readFileSync, writeFileSync } from 'node:fs';
import type { SaveBytesFixture } from '../fixtures';
import { state } from '../state';

describe('edit and save preserves bytes', () => {
  it('writes original bytes + typed text, keeping CRLF line endings and the UTF-8 BOM', async () => {
    const fixture = state.fixture as SaveBytesFixture;
    const content = $('.cm-content');
    await content.waitForDisplayed({ timeout: 15_000 });
    await content.click();
    await browser.keys(['Control', 'End']);

    const appended = 'typed';
    await browser.keys(appended);
    await browser.waitUntil(() => content.getText().then((text) => text.includes(appended)), {
      timeout: 5_000,
      timeoutMsg: 'typed text never appeared in the editor',
    });
    await browser.keys(['Control', 's']);

    const expected = Buffer.concat([fixture.original, Buffer.from(appended, 'utf8')]);
    try {
      await browser.waitUntil(
        () => {
          try {
            return readFileSync(fixture.docPath).equals(expected);
          } catch {
            return false;
          }
        },
        { timeout: 10_000, interval: 200, timeoutMsg: 'file on disk never matched original bytes + typed text' },
      );
    } catch (error) {
      const actual = readFileSync(fixture.docPath);
      const visible = await content.getText();
      const diagnostic = await browser.execute(() => ({
        focus: document.hasFocus(),
        active: (document.activeElement as Element | null)?.className,
        mode: document.body.dataset.mode,
        modal: document.querySelector('.modal')?.textContent,
        toast: document.querySelector('.toast-stack')?.textContent,
      }));
      throw new Error(`${String(error)}; path=${fixture.docPath}; expected=${expected.toString('hex')}; actual=${actual.toString('hex')}; editor=${JSON.stringify(visible)}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
  });

  it('asks before replacing an externally changed file and can load theirs', async () => {
    const fixture = state.fixture as SaveBytesFixture;
    const content = $('.cm-content');
    await content.click();
    await browser.keys(['Control', 'End']);
    await browser.keys(' mine');
    await browser.waitUntil(() => content.getText().then((text) => text.includes('mine')), {
      timeout: 5_000,
      timeoutMsg: 'local edit never appeared in the editor',
    });

    const theirs = Buffer.from('\ufeffExternal change\r\n', 'utf8');
    writeFileSync(fixture.docPath, theirs);
    await browser.keys(['Control', 's']);
    const prompt = $('.modal h2');
    await prompt.waitForDisplayed({ timeout: 10_000 });
    expect(['doc.md changed on disk', 'doc.md conflicts with disk']).toContain(await prompt.getText());
    expect(readFileSync(fixture.docPath).equals(theirs)).toBe(true);
    await $('button[data-choice="reload"]').click();
    await browser.waitUntil(() => $('.cm-content').getText().then((text) => text.includes('External change')), {
      timeout: 10_000,
      timeoutMsg: 'loading the external version did not update the editor',
    });
    expect(readFileSync(fixture.docPath).equals(theirs)).toBe(true);
  });
});
