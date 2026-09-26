import { $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { INVALID_UTF8_BYTES } from '../fixtures';
import { state } from '../state';

describe('invalid UTF-8 file', () => {
  it('shows an error toast mentioning UTF-8 and leaves the file untouched', async () => {
    const fixture = state.fixture!;
    const toast = $('.toast');
    await toast.waitForExist({ timeout: 15_000 });
    const message = await toast.getText();
    expect(message.toLowerCase()).toContain('utf-8');

    // The app must not have crashed or lost the window.
    expect(await $('#editor').isExisting()).toBe(true);

    expect(readFileSync(fixture.docPath).equals(INVALID_UTF8_BYTES)).toBe(true);
  });
});
