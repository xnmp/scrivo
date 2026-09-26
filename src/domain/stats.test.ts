import { describe, expect, it } from 'vitest';
import { textStats } from './stats';

describe('textStats', () => {
  it.each([
    ['', 0],
    ['   \n\t', 0],
    ['one', 1],
    ['one two  three\nfour', 4],
    ["don't stop-me now", 3],
    ['# Heading **bold** - [ ] task', 3],
    ['2026 was 1 year', 4],
    ['--- *** ___', 0],
    ['中文字', 3],
    ['hello 世界', 3],
    ['naïve café', 2],
  ])('%j has %i words', (text, words) => {
    expect(textStats(text).words).toBe(words);
  });

  it('counts non-whitespace characters, including astral symbols once', () => {
    expect(textStats('a b\nc😀').characters).toBe(4);
  });

  it('gives the same result for chunked input as for the joined string', () => {
    const text = "Héllo wörld — don't stop\n中文 and 😀 emoji\n- [x] task";
    const chunks = text.match(/[\s\S]{1,3}/g)!;
    expect(textStats(chunks)).toEqual(textStats(text));
  });

  it('does not split words at chunk boundaries inside a word', () => {
    expect(textStats(['hel', 'lo wo', 'rld']).words).toBe(2);
  });

  it('treats punctuation-only runs and emoji as non-words', () => {
    expect(textStats('— … “” 😀 ***').words).toBe(0);
  });

  it('handles large documents', () => {
    const text = 'lorem ipsum dolor sit amet '.repeat(100_000);
    expect(textStats(text).words).toBe(500_000);
  });
});
