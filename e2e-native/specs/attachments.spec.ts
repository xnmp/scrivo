import { $, browser, expect } from '@wdio/globals';
import { cpSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { state } from '../state';

describe('local attachments', () => {
  it('pastes an X11 PNG clipboard into a collision-safe asset and saves its relative link', async () => {
    const fixture = state.fixture!;
    const source = readFileSync(path.join(fixture.dir, 'source.png'));
    const content = $('.cm-content');
    await content.waitForDisplayed({ timeout: 15_000 });
    await content.click();
    await browser.keys(['Control', 'End']);
    const textCopy = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'UTF8_STRING', '-i'], {
      input: 'native text\n', stdio: ['pipe', 'ignore', 'ignore'],
    });
    expect(textCopy.status).toBe(0);
    await browser.keys(['Control', 'v']);
    await browser.waitUntil(async () => (await content.getText()).includes('native text'), {
      timeout: 10_000,
      timeoutMsg: 'native plain-text paste was lost',
    });
    await browser.keys(['Control', 'End']);
    const copied = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i'], {
      input: source, stdio: ['pipe', 'ignore', 'ignore'],
    });
    expect(copied.status).toBe(0);
    await browser.keys(['Control', 'v']);
    const assets = path.join(fixture.dir, 'assets');
    await browser.waitUntil(() => readdirSync(assets).length > 1, {
      timeout: 10_000,
      timeoutMsg: 'native image paste did not create a local asset',
    });
    const imported = readdirSync(assets).filter((name) => name !== 'image.png');
    expect(imported).toHaveLength(1);
    expect(readFileSync(path.join(assets, 'image.png')).toString()).toBe('old');
    const importedBytes = readFileSync(path.join(assets, imported[0]!));
    expect(importedBytes.subarray(0, 8)).toEqual(source.subarray(0, 8));
    expect(importedBytes.length).toBeGreaterThan(32);
    await browser.keys(['Control', 's']);
    await browser.waitUntil(() => readFileSync(fixture.docPath, 'utf8').includes(`assets/${encodeURIComponent(imported[0]!)}`), {
      timeout: 10_000,
      timeoutMsg: 'native image link was not saved to Markdown',
    });
    await browser.keys(['Control', 'e']);
    await $('#document img').waitForDisplayed({ timeout: 10_000 });
    const movedDir = `${fixture.dir}-moved`;
    mkdirSync(movedDir);
    cpSync(fixture.docPath, path.join(movedDir, 'note.md'));
    cpSync(assets, path.join(movedDir, 'assets'), { recursive: true });
    const movedImageLoaded = await browser.execute(async (documentPath) => {
      const rendered = await (window as any).__TAURI_INTERNALS__.invoke('render_file', { path: documentPath });
      const fragment = new DOMParser().parseFromString(rendered.html, 'text/html');
      const source = fragment.querySelector('img')?.getAttribute('src');
      if (!source) return false;
      const image = new Image();
      return new Promise<boolean>((resolve) => {
        image.onload = () => resolve(image.naturalWidth === 1);
        image.onerror = () => resolve(false);
        image.src = source;
      });
    }, path.join(movedDir, 'note.md'));
    expect(movedImageLoaded).toBe(true);
  });
});
