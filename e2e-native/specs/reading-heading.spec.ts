import { $, browser, expect } from '@wdio/globals';

describe('launch with a markdown file', () => {
  it('opens it in the reading view, not the editor', async () => {
    const heading = $('#document h1');
    await heading.waitForExist({ timeout: 15_000 });
    expect(await heading.getText()).toBe('Hello World');

    expect(await $('.cm-editor').isExisting()).toBe(false);
    expect(await browser.execute(() => document.body.dataset.mode)).toBe('view');
    expect(await $('#viewer').isDisplayed()).toBe(true);
  });
});
