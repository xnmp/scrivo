import { $, browser, expect } from '@wdio/globals';

describe('local image', () => {
  it('renders a sibling PNG through the asset protocol', async () => {
    const img = $('img.cm-lp-image');
    await img.waitForExist({ timeout: 15_000 });
    expect(await img.getAttribute('class')).not.toContain('cm-lp-image-broken');

    await browser.waitUntil(
      async () => {
        const width = await img.getProperty('naturalWidth');
        return typeof width === 'number' && width > 0;
      },
      { timeout: 10_000, interval: 200, timeoutMsg: 'image never finished loading (naturalWidth stayed 0)' },
    );
  });
});
