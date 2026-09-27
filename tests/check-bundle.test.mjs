import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { checkBundle } from '../scripts/check-bundle.mjs';

function writeManifest(dist, manifest) {
  const vite = path.join(dist, '.vite');
  mkdirSync(vite);
  writeFileSync(path.join(vite, 'manifest.json'), JSON.stringify(manifest));
}

test('startup budget includes nested static imports without preload links', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bundle-test-'));
  try {
    const assets = path.join(dist, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/entry.js"></script>');
    writeFileSync(path.join(assets, 'entry.js'), 'import "./shims-a.js";');
    writeFileSync(path.join(assets, 'shims-a.js'), 'import "./hidden.js";');
    writeFileSync(path.join(assets, 'hidden.js'), `/*${'x'.repeat(45 * 1024)}*/`);
    writeManifest(dist, {
      'index.html': { file: 'assets/entry.js', isEntry: true, imports: ['_shims-a.js'] },
      '_shims-a.js': { file: 'assets/shims-a.js', imports: ['_hidden.js'] },
      '_hidden.js': { file: 'assets/hidden.js' },
    });

    const { failures } = checkBundle(dist, { prepaintDynamicRoots: [] });
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
    writeManifest(dist, {
      'index.html': { file: 'assets/entry.js', isEntry: true, imports: ['_shims-a.js'], css: ['assets/main.css'] },
      '_shims-a.js': { file: 'assets/shims-a.js' },
    });

    const result = checkBundle(dist, { prepaintDynamicRoots: [] });
    expect(result.failures.join('\n')).toContain('nested.css');
    expect(result.conditional).toEqual([['assets/font.ttf', 123]]);
    expect(result.conditionalBytes).toBe(123);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('declared dynamic chunks are reported outside the startup budget', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bundle-dynamic-test-'));
  try {
    const assets = path.join(dist, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/entry.js"></script>');
    writeFileSync(path.join(assets, 'entry.js'), 'import "./shims-a.js"; void import("./lazy.js");');
    writeFileSync(path.join(assets, 'shims-a.js'), '');
    writeFileSync(path.join(assets, 'lazy.js'), 'x'.repeat(50 * 1024));
    writeManifest(dist, {
      'index.html': { file: 'assets/entry.js', isEntry: true, imports: ['_shims-a.js'], dynamicImports: ['src/lazy.js'] },
      '_shims-a.js': { file: 'assets/shims-a.js' },
      'src/lazy.js': { file: 'assets/lazy.js', isDynamicEntry: true },
    });

    const result = checkBundle(dist, { prepaintDynamicRoots: [] });
    expect(result.failures).toEqual([]);
    expect(result.deferred).toEqual(['assets/lazy.js']);
    expect(result.deferredBytes).toBe(50 * 1024);
    expect(result.dynamicRoots).toEqual(['src/lazy.js']);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('known dynamic imports requested during boot count toward the prepaint budget', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bundle-prepaint-test-'));
  try {
    const assets = path.join(dist, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/entry.js"></script>');
    writeFileSync(path.join(assets, 'entry.js'), 'import "./shims-a.js"; void import("./window.js");');
    writeFileSync(path.join(assets, 'shims-a.js'), '');
    writeFileSync(path.join(assets, 'window.js'), 'x'.repeat(57 * 1024));
    writeManifest(dist, {
      'index.html': { file: 'assets/entry.js', isEntry: true, imports: ['_shims-a.js'], dynamicImports: ['window'] },
      '_shims-a.js': { file: 'assets/shims-a.js' },
      window: { file: 'assets/window.js', isDynamicEntry: true },
    });

    const result = checkBundle(dist, { prepaintDynamicRoots: ['window'] });
    expect(result.prepaintBytes).toBe(57 * 1024);
    expect(result.failures.join('\n')).toContain('prepaint JS/CSS is');
    expect(result.failures.join('\n')).not.toContain('startup bundle is');
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('manifest assets are validated for static and dynamic chunks', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bundle-assets-test-'));
  try {
    const assets = path.join(dist, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/entry.js"></script>');
    writeFileSync(path.join(assets, 'entry.js'), 'import "./shims-a.js"; void import("./lazy.js");');
    writeFileSync(path.join(assets, 'shims-a.js'), '');
    writeFileSync(path.join(assets, 'lazy.js'), '');
    writeManifest(dist, {
      'index.html': { file: 'assets/entry.js', isEntry: true, imports: ['_shims-a.js'],
        dynamicImports: ['lazy'], assets: ['assets/missing-static.png'] },
      '_shims-a.js': { file: 'assets/shims-a.js' },
      lazy: { file: 'assets/lazy.js', isDynamicEntry: true, assets: ['assets/missing-lazy.png'] },
    });

    const result = checkBundle(dist, { prepaintDynamicRoots: [] });
    expect(result.failures).toEqual(expect.arrayContaining([
      'startup-referenced asset is missing: assets/missing-static.png',
      'deferred asset is missing: assets/missing-lazy.png',
    ]));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('deferred CSS imports and URL assets are validated and included in dynamic size', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bundle-deferred-css-test-'));
  try {
    const assets = path.join(dist, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/entry.js"></script>');
    writeFileSync(path.join(assets, 'entry.js'), 'import "./shims-a.js"; void import("./lazy.js");');
    writeFileSync(path.join(assets, 'shims-a.js'), '');
    writeFileSync(path.join(assets, 'lazy.js'), '');
    writeFileSync(path.join(assets, 'lazy.css'), '@import "./missing.css"; .x { background: url("./missing.png") }');
    writeManifest(dist, {
      'index.html': { file: 'assets/entry.js', isEntry: true, imports: ['_shims-a.js'], dynamicImports: ['lazy'] },
      '_shims-a.js': { file: 'assets/shims-a.js' },
      lazy: { file: 'assets/lazy.js', isDynamicEntry: true, css: ['assets/lazy.css'] },
    });

    const missing = checkBundle(dist, { prepaintDynamicRoots: [] });
    expect(missing.failures).toEqual(expect.arrayContaining([
      'deferred asset is missing: assets/missing.css',
      'deferred asset is missing: assets/missing.png',
    ]));
    writeFileSync(path.join(assets, 'missing.css'), 'h1 {}');
    writeFileSync(path.join(assets, 'missing.png'), Buffer.alloc(31));
    const complete = checkBundle(dist, { prepaintDynamicRoots: [] });
    expect(complete.failures).toEqual([]);
    expect(complete.deferred).toEqual(expect.arrayContaining(['assets/lazy.css', 'assets/missing.css', 'assets/missing.png']));
    expect(complete.deferredBytes).toBe(Buffer.byteLength('@import "./missing.css"; .x { background: url("./missing.png") }') + 5 + 31);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('standalone CSS manifest entries are validated despite missing dynamic import edges', () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bundle-standalone-css-test-'));
  try {
    const assets = path.join(dist, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/entry.js"></script>');
    writeFileSync(path.join(assets, 'entry.js'), 'import "./shims-a.js";');
    writeFileSync(path.join(assets, 'shims-a.js'), '');
    writeFileSync(path.join(assets, 'math.css'), '@font-face { src: url("./missing.woff2") }');
    writeManifest(dist, {
      'index.html': { file: 'assets/entry.js', isEntry: true, imports: ['_shims-a.js'] },
      '_shims-a.js': { file: 'assets/shims-a.js' },
      'math.css': { file: 'assets/math.css' },
    });

    const result = checkBundle(dist, { prepaintDynamicRoots: [] });
    expect(result.standaloneCssRoots).toEqual(['math.css']);
    expect(result.failures).toContain('deferred asset is missing: assets/missing.woff2');
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
