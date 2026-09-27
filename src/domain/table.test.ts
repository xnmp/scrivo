import { describe, expect, it } from 'vitest';
import { deleteTableColumn, emptyTableRow, escapeCellPipes, insertTableColumn, parseAlignments, replaceCell, splitRow } from './table';

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

describe('table cell edits', () => {
  it('changes only the chosen cell and keeps row spacing', () => {
    expect(replaceCell('| Ann  | 10    |', 1, '25')).toBe('| Ann  | 25    |');
    expect(replaceCell('| Ann  | 10    |', 0, '')).toBe('|   | 10    |');
    expect(replaceCell('|  |  |', 0, 'Cy')).toBe('| Cy |  |');
  });

  it('adds a missing cell without dropping existing data', () => {
    expect(replaceCell('| Ann |', 1, '25')).toBe('| Ann | 25 |');
    expect(replaceCell('Ann', 2, '25')).toBe('| Ann |  | 25 |');
  });

  it('escapes pipes while keeping existing escapes', () => {
    expect(escapeCellPipes('a|b')).toBe('a\\|b');
    expect(escapeCellPipes('a\\|b')).toBe('a\\|b');
    expect(escapeCellPipes('a\\\\|b')).toBe('a\\\\\\|b');
    expect(splitRow(replaceCell('| old | next |', 0, 'a|b'))).toHaveLength(2);
    expect(replaceCell('|Ann|10|', 0, 'abc\\')).toBe('|abc\\ |10|');
    expect(splitRow(replaceCell('|Ann|10|', 0, 'abc\\'))).toHaveLength(2);
  });

  it('creates an empty row with the table width', () => {
    expect(emptyTableRow(2)).toBe('|  |  |');
  });

  it('inserts and deletes columns while preserving cell Markdown and delimiter alignment', () => {
    expect(insertTableColumn('| Name | **Score** |', 1, 2, false)).toBe('| Name |  | **Score** |');
    expect(insertTableColumn('| :--- | ---: |', 1, 2, true)).toBe('| :--- | --- | ---: |');
    expect(deleteTableColumn('| Name |  | **Score** |', 1, 3)).toBe('| Name | **Score** |');
    expect(insertTableColumn('| a\\|b |', 1, 2, false)).toBe('| a\\|b |  |  |');
    expect(insertTableColumn('| a | b | hidden |', 1, 2, false)).toBe('| a |  | b | hidden |');
    expect(deleteTableColumn('| a | b | hidden |', 1, 2)).toBe('| a | hidden |');
  });
});
