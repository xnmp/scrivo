import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findAll, firstFrom, locate, step } from './find';

const slices = (text: string, query: string) => findAll(text, query).map((m) => text.slice(m.start, m.end));

describe('findAll', () => {
  it('finds every occurrence, ignoring case', () => {
    expect(slices('Cat, cat and CAT scatter', 'cat')).toEqual(['Cat', 'cat', 'CAT', 'cat']);
  });

  it('matches literally: regular expression syntax is just text', () => {
    expect(slices('a.b axb (x) [y] $1 ^ \\d', '.')).toEqual(['.']);
    expect(slices('a.b axb (x) [y]', '(x)')).toEqual(['(x)']);
    expect(slices('price $1 or \\d', '\\d')).toEqual(['\\d']);
  });

  it('does not overlap matches', () => {
    expect(findAll('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('keeps offsets right when case mapping changes length', () => {
    // 'İ'.toLowerCase() is 'i̇' (two code units): offsets must still point into the original.
    const text = 'İstanbul and istanbul';
    const found = findAll(text, 'and');
    expect(found).toEqual([{ start: 9, end: 12 }]);
  });

  it('handles astral characters and combining marks', () => {
    expect(slices('😀 smile 😀', '😀')).toEqual(['😀', '😀']);
    expect(slices('Straße STRASSE', 'straße')).toEqual(['Straße']);
  });

  it('matches nothing for an empty query or text', () => {
    expect(findAll('abc', '')).toEqual([]);
    expect(findAll('', 'a')).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(findAll('a'.repeat(100), 'a', 10)).toHaveLength(10);
  });

  it('every match is the query, case-insensitively, in order and disjoint', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.string({ minLength: 1, maxLength: 4 }), (text, query) => {
        const found = findAll(text, query);
        found.forEach((m, i) => {
          expect(text.slice(m.start, m.end).toLowerCase()).toBe(query.toLowerCase()); // ASCII strings
          expect(m.end).toBeGreaterThan(m.start);
          if (i > 0) expect(m.start).toBeGreaterThanOrEqual(found[i - 1]!.end);
        });
        // Anything that equals the query exactly is found (its start is covered by some match).
        let from = text.indexOf(query);
        while (from !== -1) {
          const at = from;
          expect(found.some((m) => m.start <= at && at < m.end)).toBe(true);
          from = text.indexOf(query, from + 1);
        }
      }),
    );
  });

  it('is fast on large text', () => {
    const text = 'lorem ipsum dolor sit amet '.repeat(40_000); // ~1 MB
    const t = performance.now();
    expect(findAll(text, 'dolor')).toHaveLength(10_000); // capped
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('locate', () => {
  const starts = [0, 5, 5, 12]; // segments: "hello", "", "world!!", ...

  it('maps offsets to a segment and an offset inside it', () => {
    expect(locate(starts, 0)).toEqual({ index: 0, offset: 0 });
    expect(locate(starts, 4)).toEqual({ index: 0, offset: 4 });
    expect(locate(starts, 13)).toEqual({ index: 3, offset: 1 });
  });

  it('puts a boundary offset in the (last) segment starting there', () => {
    expect(locate(starts, 5)).toEqual({ index: 2, offset: 0 });
    expect(locate(starts, 12)).toEqual({ index: 3, offset: 0 });
  });

  it('agrees with a linear scan', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(20), { minLength: 1, maxLength: 30 }), fc.nat(700), (lengths, raw) => {
        const s = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
        const total = s.at(-1)! + lengths.at(-1)!;
        const offset = raw % (total + 1);
        let expected = 0;
        s.forEach((start, i) => {
          if (start <= offset) expected = i;
        });
        expect(locate(s, offset)).toEqual({ index: expected, offset: offset - s[expected]! });
      }),
    );
  });
});

describe('navigation', () => {
  const matches = [
    { start: 10, end: 12 },
    { start: 50, end: 52 },
    { start: 90, end: 92 },
  ];

  it('starts at the first match from a position, wrapping to the top', () => {
    expect(firstFrom(matches, 0)).toBe(0);
    expect(firstFrom(matches, 11)).toBe(1);
    expect(firstFrom(matches, 50)).toBe(1);
    expect(firstFrom(matches, 91)).toBe(0);
    expect(firstFrom([], 0)).toBe(-1);
  });

  it('steps forwards and backwards with wrap-around', () => {
    expect(step(0, 3, 1)).toBe(1);
    expect(step(2, 3, 1)).toBe(0);
    expect(step(0, 3, -1)).toBe(2);
    expect(step(-1, 3, 1)).toBe(0);
    expect(step(-1, 3, -1)).toBe(2);
    expect(step(0, 0, 1)).toBe(-1);
  });
});
