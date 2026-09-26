import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FileStamp } from './document';
import { decideExternalChange } from './external';

const stamp = (mtimeMs: number, size: number): FileStamp => ({ mtimeMs, size });

describe('decideExternalChange', () => {
  it('does nothing while the disk matches our last read or write', () => {
    expect(decideExternalChange({ known: stamp(1, 10), observed: stamp(1, 10), dirty: false })).toBe('unchanged');
    expect(decideExternalChange({ known: stamp(1, 10), observed: stamp(1, 10), dirty: true })).toBe('unchanged');
  });

  it('reloads an external change when there is nothing to lose', () => {
    expect(decideExternalChange({ known: stamp(1, 10), observed: stamp(2, 10), dirty: false })).toBe('reload');
    expect(decideExternalChange({ known: stamp(1, 10), observed: stamp(1, 11), dirty: false })).toBe('reload');
  });

  it('asks when both sides changed', () => {
    expect(decideExternalChange({ known: stamp(1, 10), observed: stamp(2, 12), dirty: true })).toBe('ask');
  });

  it('reports deletion regardless of local edits', () => {
    expect(decideExternalChange({ known: stamp(1, 10), observed: null, dirty: false })).toBe('deleted');
    expect(decideExternalChange({ known: stamp(1, 10), observed: null, dirty: true })).toBe('deleted');
  });

  it('ignores the disk for a document we never read or wrote', () => {
    expect(decideExternalChange({ known: null, observed: stamp(5, 5), dirty: true })).toBe('unchanged');
    expect(decideExternalChange({ known: null, observed: null, dirty: false })).toBe('unchanged');
  });

  it('never discards unsaved edits without asking', () => {
    const arbStamp = fc.option(fc.record({ mtimeMs: fc.double({ noNaN: true }), size: fc.nat() }), { nil: null });
    fc.assert(
      fc.property(arbStamp, arbStamp, (known, observed) => {
        expect(decideExternalChange({ known, observed, dirty: true })).not.toBe('reload');
      }),
    );
  });
});
