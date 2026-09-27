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
