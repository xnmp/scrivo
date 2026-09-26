import { $, expect } from '@wdio/globals';

describe('launch with a markdown file', () => {
  it('renders the first line as a heading with the marker hidden', async () => {
    const heading = $('.cm-line.cm-lp-h1');
    await heading.waitForExist({ timeout: 15_000 });
    const text = await heading.getText();
    expect(text).toBe('Hello World');
    expect(text).not.toContain('#');
  });
});
