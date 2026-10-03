import { $, browser, expect } from '@wdio/globals';

const selection = () => browser.execute(() => ({
  text: getSelection()?.toString() ?? '', highlight: CSS.highlights?.has('scrivo-selection') ?? false,
}));
const selectText = async () => {
  const points = await browser.execute(() => {
    const text = document.querySelector('#document p')!.firstChild!;
    const range = document.createRange(); range.selectNodeContents(text);
    const box = range.getBoundingClientRect();
    return { x: Math.round(box.x + 2), y: Math.round(box.y + box.height / 2), end: Math.round(box.right - 2) };
  });
  await browser.performActions([{ type: 'pointer', id: 'reader-mouse', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', duration: 0, x: points.x, y: points.y }, { type: 'pointerDown', button: 0 },
    { type: 'pointerMove', duration: 150, x: points.end, y: points.y }, { type: 'pointerUp', button: 0 },
  ] }]);
  await browser.releaseActions();
  await browser.waitUntil(async () => { const result = await selection(); return result.text.length > 0 && result.highlight; });
};

describe('native reader selection dismissal', () => {
  it('clears reader selection on tab click and repaints after Settings focus without breaking drag selection', async () => {
    await $('#document h1').waitForDisplayed({ timeout: 15000 });
    await selectText();
    await $('[role=tab][aria-selected=true]').click();
    await browser.waitUntil(async () => { const result = await selection(); return !result.text && !result.highlight; });
    await selectText();
    await browser.keys(['Control', ',']);
    await $('#scrivo-settings').waitForDisplayed();
    await browser.waitUntil(async () => !(await selection()).highlight);
    await browser.keys('Escape');
    await selectText();
    await $('#document h1').click();
    await browser.waitUntil(async () => { const result = await selection(); return !result.text && !result.highlight; });
    expect(await $('#document h1').getText()).toBe('Before');
  });
});
