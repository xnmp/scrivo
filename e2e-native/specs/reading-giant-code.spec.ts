import { $, browser, expect } from '@wdio/globals';

describe('giant code block in the native reading view', () => {
  it('keeps all text and reveals a middle search result', async () => {
    await $('#document p').waitForExist({ timeout: 20_000 });
    await $('#document h1').waitForExist({ timeout: 30_000 });
    const state = await browser.execute(() => {
      const code = document.querySelector('#document pre > code');
      return {
        segments: code?.querySelectorAll('.code-segment').length,
        codeLength: code?.textContent?.length,
        children: code?.childNodes.length,
        firstType: code?.firstChild?.nodeType,
        contentVisibility: CSS.supports('content-visibility', 'auto'),
        intrinsicHeight: CSS.supports('contain-intrinsic-height', 'auto 100px'),
      };
    });
    if (!state.segments || state.segments <= 100) throw new Error(`giant code state: ${JSON.stringify(state)}`);
    const result = await browser.execute(() => {
      const code = document.querySelector('#document pre > code')!;
      const line = '0123456789'.repeat(10) + '\n';
      const expected = line.repeat(25_000) + 'unique-middle-code-marker\n'
        + `\t${'W'.repeat(1000)}far-right-marker\n` + line.repeat(25_000);
      const tail = document.querySelector('#document h1');
      return {
        exact: code.textContent === expected,
        segments: code.querySelectorAll('.code-segment').length,
        height: code.getBoundingClientRect().height,
        tail: tail?.textContent,
      };
    });
    expect(result.exact).toBe(true);
    expect(result.segments).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(1_000_000);
    expect(result.tail).toBe('Tail');

    await browser.keys(['Control', 'f']);
    const find = $('input[aria-label="Find in document"]');
    await find.waitForDisplayed();
    await find.setValue('unique-middle-code-marker');
    await browser.waitUntil(async () => (await $('.find-count').getText()) === '1 of 1', {
      timeout: 20_000,
      timeoutMsg: 'Find did not locate the marker in the giant code block',
    });
    const position = await browser.execute(() => {
      const code = document.querySelector('#document pre > code')!;
      const scroller = document.querySelector('#viewer')!;
      const segment = [...code.querySelectorAll('.code-segment')]
        .find((node) => node.textContent?.includes('unique-middle-code-marker'))!;
      const segmentBox = segment.getBoundingClientRect();
      const viewerBox = scroller.getBoundingClientRect();
      const text = segment.firstChild!;
      const offset = text.textContent!.indexOf('unique-middle-code-marker');
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 25);
      const markerBox = range.getBoundingClientRect();
      return { scrollTop: scroller.scrollTop, segmentTop: segmentBox.top, segmentBottom: segmentBox.bottom,
        viewerTop: viewerBox.top, viewerBottom: viewerBox.bottom, markerTop: markerBox.top, markerBottom: markerBox.bottom };
    });
    if (!(position.scrollTop > 400_000 && position.markerBottom > position.viewerTop
      && position.markerTop < position.viewerBottom)) throw new Error(`Find position: ${JSON.stringify(position)}`);

    const horizontal = await browser.execute(() => {
      const pre = document.querySelector<HTMLPreElement>('#document pre')!;
      const segment = [...pre.querySelectorAll('.code-segment')]
        .find((node) => node.textContent?.includes('W'.repeat(1000)))!;
      const text = segment.firstChild!;
      const end = text.textContent!.indexOf('W'.repeat(1000)) + 1000;
      pre.scrollLeft = pre.scrollWidth - pre.clientWidth;
      const range = document.createRange();
      range.setStart(text, end - 10);
      range.setEnd(text, end);
      const box = range.getBoundingClientRect();
      const viewport = pre.getBoundingClientRect();
      return { width: pre.scrollWidth, viewport: pre.clientWidth, scrollLeft: pre.scrollLeft,
        boxLeft: box.left, boxRight: box.right, preLeft: viewport.left, preRight: viewport.right,
        visible: box.right <= viewport.right + 1 && box.left >= viewport.left - 1 };
    });
    expect(horizontal.width).toBeGreaterThan(horizontal.viewport * 4);
    if (!horizontal.visible) throw new Error(`Horizontal code position: ${JSON.stringify(horizontal)}`);

    await browser.execute(() => { document.querySelector<HTMLPreElement>('#document pre')!.scrollLeft = 0; });
    await find.setValue('far-right-marker');
    await browser.waitUntil(async () => (await $('.find-count').getText()) === '1 of 1', {
      timeout: 20_000,
      timeoutMsg: 'Find did not locate the far-right marker',
    });
    const farRight = await browser.execute(() => {
      const pre = document.querySelector<HTMLPreElement>('#document pre')!;
      const segment = [...pre.querySelectorAll('.code-segment')]
        .find((node) => node.textContent?.includes('far-right-marker'))!;
      const text = segment.firstChild!;
      const start = text.textContent!.indexOf('far-right-marker');
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 'far-right-marker'.length);
      const box = range.getBoundingClientRect();
      const clip = pre.getBoundingClientRect();
      return { scrollLeft: pre.scrollLeft, width: pre.clientWidth,
        visible: box.left >= clip.left - 1 && box.right <= clip.right + 1 };
    });
    expect(farRight.scrollLeft).toBeGreaterThan(farRight.width * 4);
    expect(farRight.visible).toBe(true);

    const maxScrollGap = await browser.execute(async () => {
      const scroller = document.querySelector<HTMLElement>('#viewer')!;
      const gaps: number[] = [];
      let previous = 0;
      let sampling = true;
      const tick = (time: number) => {
        if (previous) gaps.push(time - previous);
        previous = time;
        if (sampling) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await frame();
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * fraction;
        await frame();
        await frame();
      }
      sampling = false;
      return Math.max(...gaps);
    });
    console.log(`native giant-code scroll max frame gap: ${maxScrollGap.toFixed(1)}ms`);
    expect(maxScrollGap).toBeLessThan(200);
  });
});
