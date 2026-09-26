import { describe, expect, it } from 'vitest';
import { parseAlignments, splitRow } from './table';

const cells = (row: string) => splitRow(row).map(({ from, to }) => row.slice(from, to));

describe('splitRow', () => {
  it.each([
    ['| a | b |', ['a', 'b']],
    ['a | b', ['a', 'b']],
    ['| a | b', ['a', 'b']],
    ['a | b |', ['a', 'b']],
    ['| a |  | c |', ['a', '', 'c']],
    ['| | |', ['', '']],
    ['| a \\| b | c |', ['a \\| b', 'c']],
    ['| `x|y` |', ['`x', 'y`']], // GFM: pipes split even inside code spans
    ['|a|', ['a']],
    ['| **bold** |', ['**bold**']],
  ])('%s', (row, expected) => {
    expect(cells(row)).toEqual(expected);
  });

  it('returns offsets into the original row', () => {
    expect(splitRow('|  ab  |')).toEqual([{ from: 3, to: 5 }]);
  });
});

describe('parseAlignments', () => {
  it('reads colons on the delimiter row', () => {
    expect(parseAlignments('| --- | :-- | :-: | --: |')).toEqual([null, 'left', 'center', 'right']);
    expect(parseAlignments(':-|-:')).toEqual(['left', 'right']);
  });
});
