import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { checkBundle } from '../scripts/check-bundle.mjs';

test('startup budget includes nested static imports without preload links', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bundle-test-'));
  try {
    const assets = path.join(dist, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/entry.js"></script>');
    writeFileSync(path.join(assets, 'entry.js'), 'import "./shims-a.js";');
    writeFileSync(path.join(assets, 'shims-a.js'), 'import "./hidden.js";');
    writeFileSync(path.join(assets, 'hidden.js'), `/*${'x'.repeat(45 * 1024)}*/`);

    const { failures } = checkBundle(dist);
    expect(failures.join('\n')).toContain('startup bundle is');
    expect(failures.join('\n')).toContain('hidden.js');
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('CSS imports count toward startup while referenced fonts are reported separately', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bundle-css-test-'));
  try {
    const assets = path.join(dist, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/entry.js"></script><link rel="stylesheet" href="/assets/main.css">');
    writeFileSync(path.join(assets, 'entry.js'), 'import "./shims-a.js";');
    writeFileSync(path.join(assets, 'shims-a.js'), '');
    writeFileSync(path.join(assets, 'main.css'), '@import url("./nested.css");');
    writeFileSync(path.join(assets, 'nested.css'), `@font-face { src: url('./font.ttf'); }/*${'x'.repeat(45 * 1024)}*/`);
    writeFileSync(path.join(assets, 'font.ttf'), Buffer.alloc(123));

    const result = checkBundle(dist);
    expect(result.failures.join('\n')).toContain('nested.css');
    expect(result.conditional).toEqual([['assets/font.ttf', 123]]);
    expect(result.conditionalBytes).toBe(123);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
