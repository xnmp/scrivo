import { $, browser, expect } from '@wdio/globals';

describe('large file in the native reading view', () => {
  it('renders the fixture-specific tail and can scroll it into view', async () => {
    const heading = $('#document h1');
    await heading.waitForExist({ timeout: 15_000 });
    expect(await heading.getText()).toBe('Benchmark Large Document');

    await browser.waitUntil(async () => browser.execute(() =>
      document.getElementById('end-of-large-benchmark-document')?.textContent === 'End of Large Benchmark Document',
    ), { timeout: 20_000, timeoutMsg: 'the large document tail did not render' });
    await browser.execute(() => document.getElementById('end-of-large-benchmark-document')!.scrollIntoView());
    const visible = await browser.execute(() => {
      const tail = document.getElementById('end-of-large-benchmark-document')!;
      const viewer = document.querySelector('#viewer')!;
      const tailBox = tail.getBoundingClientRect();
      const viewerBox = viewer.getBoundingClientRect();
      return tailBox.top >= viewerBox.top && tailBox.bottom <= viewerBox.bottom;
    });
    expect(visible).toBe(true);
  });
});
