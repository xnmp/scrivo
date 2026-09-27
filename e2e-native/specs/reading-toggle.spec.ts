import { $, browser, expect } from '@wdio/globals';
import { activeWindowTitle } from '../native-window';

describe('switching between the reading view and the editor', () => {
  it('Ctrl+E edits the same document, typing marks it dirty, and Ctrl+E back shows the edit', async () => {
    const heading = $('#document h1');
    await heading.waitForExist({ timeout: 15_000 });
    expect(await heading.getText()).toBe('Hello World');

    await browser.keys(['Control', 'e']);
    const content = $('.cm-content');
    await content.waitForExist({ timeout: 15_000 });
    expect(await browser.execute(() => document.body.dataset.mode)).toBe('edit');
    expect(await content.getText()).toContain('Hello World');

    await content.click();
    await browser.keys(['Control', 'End']);
    // Avoid consecutive repeated characters: WebKitWebDriver's key-action replay
    // can coalesce back-to-back identical keydown/keyup pairs into one keystroke.
    const appended = 'edited';
    await browser.keys(appended);

    await browser.waitUntil(() => activeWindowTitle().includes('•'), {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: () => `window title never showed the dirty marker; last seen: ${JSON.stringify(activeWindowTitle())}`,
    });

    await browser.keys(['Control', 'e']);
    const doc = $('#document');
    await browser.waitUntil(() => browser.execute(() => document.body.dataset.mode === 'view'), {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: 'did not switch back to the reading view',
    });
    await browser.waitUntil(
      async () => (await doc.getText()).includes(appended),
      { timeout: 10_000, interval: 200, timeoutMsg: 'reading view never showed the edited text' },
    );
  });
});
