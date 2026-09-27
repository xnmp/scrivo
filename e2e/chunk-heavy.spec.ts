import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

// These fixtures each create megabytes of DOM. Running them together measures
// contention between test processes rather than one reader's frame budget.
test.describe.configure({ mode: 'serial' });

test('large code blocks remain complete and searchable after background parsing', async ({ page }) => {
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async () => {
    const line = '0123456789'.repeat(10).concat('\n').repeat(300);
    const markdown = Array.from({ length: 32 }, (_, i) => `\`\`\`\n${line}${i}\n\`\`\`\n`).join('\n') + '\n# Tail\n';
    const response = await fetch('/__scrivo/render', { method: 'POST', body: markdown });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    const frameGaps: number[] = [];
    let previous = 0;
    let sampling = true;
    const frame = (time: number) => {
      if (previous) frameGaps.push(time - previous);
      previous = time;
      if (sampling) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    await new Promise(requestAnimationFrame);
    await viewer.show(rendered);
    await viewer.settled();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    sampling = false;
    const codes = [...document.querySelectorAll('#document pre > code')];
    return {
      exact: codes.length === 32 && codes.every((code, i) => code.textContent === `${line}${i}\n`),
      maxFrameGap: Math.max(...frameGaps),
      chunks: rendered.chunkEnds.length + 1,
      tail: viewer.scrollToAnchor('tail'),
    };
  });
  expect(result.exact).toBe(true);
  expect(result.tail).toBe(true);
  expect(result.maxFrameGap).toBeLessThan(200);
  await expect(page.locator('#document h1')).toHaveText('Tail');
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find in document' }).fill('Tail');
  await expect(page.locator('.find-count')).toHaveText('1 of 1');
  console.log(`heavy-chunk diagnostic: ${result.chunks} chunks, max frame gap ${result.maxFrameGap.toFixed(1)} ms`);
});

test('one oversized code block stays complete and responsive', async ({ page }) => {
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async () => {
    const line = '0123456789'.repeat(10).concat('\n');
    const code = line.repeat(10_000);
    const markdown = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}\n\n`).join('') + `\n\`\`\`\n${code}\`\`\`\n\n# Tail\n`;
    const response = await fetch('/__scrivo/render', { method: 'POST', body: markdown });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    const gaps: number[] = [];
    let previous = 0;
    let sampling = true;
    const frame = (time: number) => {
      if (previous) gaps.push(time - previous);
      previous = time;
      if (sampling) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    await new Promise(requestAnimationFrame);
    await viewer.show(rendered);
    await viewer.settled();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    sampling = false;
    return {
      maxFrameGap: Math.max(...gaps),
      exact: document.querySelector('#document pre > code')?.textContent === code,
      tail: viewer.scrollToAnchor('tail'),
      chunks: rendered.chunkEnds.length + 1,
    };
  });
  console.log(`oversized-block diagnostic: ${result.chunks} chunks, max frame gap ${result.maxFrameGap.toFixed(1)} ms`);
  expect(result.exact).toBe(true);
  expect(result.tail).toBe(true);
  expect(result.maxFrameGap).toBeLessThan(200);
});

test('a five-megabyte code block scrolls and searches without a long frame', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async () => {
    const line = '0123456789'.repeat(10).concat('\n');
    const marker = 'unique-middle-code-marker\n';
    const wideLine = '\t' + 'W'.repeat(1000) + 'far-right-marker\n';
    const code = line.repeat(25_000) + marker + wideLine + line.repeat(25_000);
    const markdown = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}\n\n`).join('')
      + `\n\`\`\`\n${code}\`\`\`\n\n# Tail\n`;
    const response = await fetch('/__scrivo/render', { method: 'POST', body: markdown });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    const gaps: number[] = [];
    let previous = 0;
    let sampling = true;
    const frame = (time: number) => {
      if (previous) gaps.push(time - previous);
      previous = time;
      if (sampling) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    await new Promise(requestAnimationFrame);
    await viewer.show(rendered);
    await viewer.settled();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    sampling = false;
    const pre = document.querySelector<HTMLPreElement>('#document pre')!;
    const height = pre.getBoundingClientRect().height;
    const segments = pre.querySelectorAll('.code-segment').length;
    const exact = pre.querySelector('code')?.textContent === code;
    const tail = viewer.scrollToAnchor('tail');
    return { maxFrameGap: Math.max(...gaps), segments, exact, tail, height };
  });
  console.log(`five-megabyte block: ${result.segments} segments, ${result.height.toFixed(0)}px, max frame gap ${result.maxFrameGap.toFixed(1)}ms`);
  expect(result.segments).toBeGreaterThan(100);
  expect(result.exact).toBe(true);
  expect(result.tail).toBe(true);
  expect(result.maxFrameGap).toBeLessThan(200);
  await expect(page.locator('#document h1')).toHaveText('Tail');
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find in document' }).fill('unique-middle-code-marker');
  await expect(page.locator('.find-count')).toHaveText('1 of 1');
  const middleVisible = await page.evaluate(() => {
    const scroller = document.querySelector('#viewer')!.getBoundingClientRect();
    const segment = [...document.querySelectorAll('.code-segment')]
      .find((node) => node.textContent?.includes('unique-middle-code-marker'));
    if (!segment) return false;
    const text = segment.firstChild!;
    const offset = text.textContent!.indexOf('unique-middle-code-marker');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + 'unique-middle-code-marker'.length);
    const box = range.getBoundingClientRect();
    return box.bottom > scroller.top && box.top < scroller.bottom;
  });
  expect(middleVisible).toBe(true);
  const horizontal = await page.evaluate(() => {
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
    return { width: pre.scrollWidth, viewport: pre.clientWidth,
      visible: box.right <= viewport.right + 1 && box.left >= viewport.left - 1 };
  });
  expect(horizontal.width).toBeGreaterThan(horizontal.viewport * 4);
  expect(horizontal.visible).toBe(true);
  await page.evaluate(() => { document.querySelector<HTMLPreElement>('#document pre')!.scrollLeft = 0; });
  await page.getByRole('textbox', { name: 'Find in document' }).fill('far-right-marker');
  await expect(page.locator('.find-count')).toHaveText('1 of 1');
  const farRightVisible = await page.evaluate(() => {
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
    return pre.scrollLeft > pre.clientWidth * 4
      && box.left >= clip.left - 1 && box.right <= clip.right + 1;
  });
  expect(farRightVisible).toBe(true);
});

test('a giant block with a wide Unicode line keeps its text and horizontal reach', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async () => {
    const line = '0123456789'.repeat(10) + '\n';
    const wideLine = `\t${'漢'.repeat(350)}\t${'漢'.repeat(350)}unicode-right-marker\n`;
    const code = line.repeat(25_000) + wideLine + line.repeat(25_000);
    const markdown = `# Before\n\n\`\`\`\n${code}\`\`\`\n\n# Tail\n`;
    const response = await fetch('/__scrivo/render', { method: 'POST', body: markdown });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    const gaps: number[] = [];
    let previous = 0;
    let sampling = true;
    const frame = (time: number) => {
      if (previous) gaps.push(time - previous);
      previous = time;
      if (sampling) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    await new Promise(requestAnimationFrame);
    await viewer.show(rendered);
    await viewer.settled();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    sampling = false;
    const pre = document.querySelector<HTMLPreElement>('#document pre')!;
    return {
      exact: pre.querySelector('code')?.textContent === code,
      segments: pre.querySelectorAll('.code-segment').length,
      maxFrameGap: Math.max(...gaps),
      scrollWidth: pre.scrollWidth,
      clientWidth: pre.clientWidth,
      tail: viewer.scrollToAnchor('tail'),
    };
  });
  console.log(`unicode giant block: ${result.segments} segments, max frame gap ${result.maxFrameGap.toFixed(1)}ms`);
  expect(result.exact).toBe(true);
  expect(result.segments).toBeGreaterThan(100);
  // The full suite also runs other browser processes; the isolated gate above is 200 ms.
  expect(result.maxFrameGap).toBeLessThan(250);
  expect(result.scrollWidth).toBeGreaterThan(result.clientWidth * 8);
  expect(result.tail).toBe(true);
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find in document' }).fill('unicode-right-marker');
  await expect(page.locator('.find-count')).toHaveText('1 of 1');
  const visible = await page.evaluate(() => {
    const pre = document.querySelector<HTMLPreElement>('#document pre')!;
    const segment = [...pre.querySelectorAll('.code-segment')]
      .find((node) => node.textContent?.includes('unicode-right-marker'))!;
    const text = segment.firstChild!;
    const start = text.textContent!.indexOf('unicode-right-marker');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 'unicode-right-marker'.length);
    const box = range.getBoundingClientRect();
    const clip = pre.getBoundingClientRect();
    const viewer = document.querySelector('#viewer')!.getBoundingClientRect();
    return pre.scrollLeft > pre.clientWidth * 8 && box.left >= clip.left - 1
      && box.right <= clip.right + 1 && box.top >= viewer.top - 1 && box.bottom <= viewer.bottom + 1;
  });
  expect(visible).toBe(true);
});

test('a Unicode tab near a tab stop remains reachable after segmentation', async ({ page }) => {
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async () => {
    const prefix = '漢'.repeat(19);
    const code = `${prefix}\tZ\n` + '0123456789abcdefghij\n'.repeat(50_000);
    const response = await fetch('/__scrivo/render', { method: 'POST', body: `\`\`\`\n${code}\`\`\`\n` });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    await viewer.show(rendered);
    await viewer.settled();
    const pre = document.querySelector<HTMLPreElement>('#document pre')!;
    pre.style.width = '150px';
    pre.scrollLeft = pre.scrollWidth - pre.clientWidth;
    const text = pre.querySelector('.code-segment')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, prefix.length + 1);
    range.setEnd(text, prefix.length + 2);
    const glyph = range.getBoundingClientRect();
    const viewport = pre.getBoundingClientRect();
    return {
      exact: pre.querySelector('code')?.textContent === code,
      segments: pre.querySelectorAll('.code-segment').length,
      tabSize: getComputedStyle(pre).tabSize,
      visible: glyph.left >= viewport.left - 1 && glyph.right <= viewport.right + 1,
    };
  });
  expect(result.exact).toBe(true);
  expect(result.segments).toBeGreaterThan(100);
  expect(result.tabSize).toBe('8');
  expect(result.visible).toBe(true);
});

test('an extreme Unicode line retains native horizontal sizing', async ({ page }) => {
  await openApp(page, { mode: 'view' });
  const result = await page.evaluate(async () => {
    const prefix = '漢'.repeat(10_001);
    const code = `${prefix}\tunicode-tail\n` + '0123456789abcdefghij\n'.repeat(50_000);
    const response = await fetch('/__scrivo/render', { method: 'POST', body: `\`\`\`\n${code}\`\`\`\n` });
    if (!response.ok) throw new Error(await response.text());
    const rendered = { ...(await response.json()), path: null, stamp: null };
    const viewer = (window as any).__scrivo.viewer;
    await viewer.show(rendered);
    await viewer.settled();
    const pre = document.querySelector<HTMLPreElement>('#document pre')!;
    pre.style.width = '150px';
    pre.scrollLeft = pre.scrollWidth - pre.clientWidth;
    const text = pre.querySelector('code')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, prefix.length + 1);
    range.setEnd(text, prefix.length + 1 + 'unicode-tail'.length);
    const marker = range.getBoundingClientRect();
    const viewport = pre.getBoundingClientRect();
    return {
      exact: pre.querySelector('code')?.textContent === code,
      segments: pre.querySelectorAll('.code-segment').length,
      visible: marker.left >= viewport.left - 1 && marker.right <= viewport.right + 1,
    };
  });
  expect(result.exact).toBe(true);
  expect(result.segments).toBe(0);
  expect(result.visible).toBe(true);
});
