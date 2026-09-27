import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { median, minimumPairs } from '../bench/stats.mjs';
import { READY, diff, firstContentTime, loadReference, signature } from '../bench/visual.mjs';

const root = path.resolve(import.meta.dirname, '..');

describe('reviewed startup screen', () => {
  it('rejects a stable blank screen instead of reporting document content', () => {
    const fixture = readFileSync(path.join(root, 'bench/fixtures/medium.md'));
    const reviewed = loadReference(path.join(root, 'bench/references/scrivo-medium.json'), fixture);
    const header = Buffer.from('P6\n1280 720\n255\n');
    const blank = Buffer.concat([header, Buffer.alloc(1280 * 720 * 3, 31)]);
    expect(diff(signature(blank), reviewed)).toBeGreaterThan(READY);
  });

  it('rejects a reference when fixture bytes have changed', () => {
    const referenceFile = path.join(root, 'bench/references/typora-large.json');
    expect(() => loadReference(referenceFile, Buffer.from('# A different document'))).toThrow(/does not match fixture/);
  });

  it('distinguishes the visible medium and large fixture labels', () => {
    for (const app of ['scrivo', 'typora']) {
      const medium = loadReference(path.join(root, `bench/references/${app}-medium.json`), readFileSync(path.join(root, 'bench/fixtures/medium.md')));
      const large = loadReference(path.join(root, `bench/references/${app}-large.json`), readFileSync(path.join(root, 'bench/fixtures/large.md')));
      expect(diff(medium, large)).toBeGreaterThan(READY);
    }
  });

  it('rejects a reviewed screen with its heading or lower content missing', () => {
    for (const app of ['scrivo', 'typora']) {
      const reviewed = loadReference(path.join(root, `bench/references/${app}-medium.json`), readFileSync(path.join(root, 'bench/fixtures/medium.md')));
      for (const [firstRow, lastRow] of [[app === 'scrivo' ? 6 : 3, app === 'scrivo' ? 11 : 7], [34, 45], [41, 45]]) {
        const incomplete = Buffer.from(reviewed);
        for (let row = firstRow; row < lastRow; row++) incomplete.fill(reviewed[row * 80], row * 80, (row + 1) * 80);
        expect(diff(incomplete, reviewed)).toBeGreaterThan(READY);
      }
    }
  });

  it('times the first reviewed document frame, not an incomplete earlier viewport', () => {
    const reviewed = loadReference(path.join(root, 'bench/references/scrivo-medium.json'), readFileSync(path.join(root, 'bench/fixtures/medium.md')));
    const incomplete = Buffer.from(reviewed);
    for (let row = 6; row < 11; row++) incomplete.fill(reviewed[row * 80], row * 80, (row + 1) * 80);
    expect(firstContentTime([{ t: 100, sig: incomplete }, { t: 120, sig: reviewed }], 90, reviewed)).toBe(120);
  });
});

describe('benchmark results', () => {
  it('uses the conventional median for odd and even observations', () => {
    expect(median([10, 2, 6])).toBe(6);
    expect(median([10, 2, 6, 4])).toBe(5);
  });

  it('requires at least 80% valid paired rounds', () => {
    expect(minimumPairs(1)).toBe(1);
    expect(minimumPairs(12)).toBe(10);
  });

});
