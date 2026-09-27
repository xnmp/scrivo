import { $, browser, expect } from '@wdio/globals';

describe('local images in the reading view', () => {
  it('loads a sibling image through the asset protocol and flags an unresolvable one', async () => {
    const img = $('#document img[alt="alt"]');
    await img.waitForExist({ timeout: 15_000 });

    await browser.waitUntil(
      async () => {
        const width = await img.getProperty('naturalWidth');
        return typeof width === 'number' && width > 0;
      },
      { timeout: 10_000, interval: 200, timeoutMsg: 'sibling image never finished loading (naturalWidth stayed 0)' },
    );

    const missing = $('#document .image-missing');
    await missing.waitForExist({ timeout: 5_000 });
    expect(await missing.getText()).toBe('missing');
  });
});
