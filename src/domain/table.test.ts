import { describe, expect, it } from 'vitest';
import { deleteTableColumn, emptyTableRow, escapeCellPipes, insertTableColumn, moveTableColumn, parseAlignments, replaceCell, setColumnAlignment, sortTableRows, splitRow } from './table';

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

  it('moves columns while keeping alignment markers and irregular extra cells', () => {
    expect(moveTableColumn('| A | B | C |', 0, 1, 3)).toBe('| B | A | C |');
    expect(moveTableColumn('| :--- | ---: |', 0, 1, 2)).toBe('| ---: | :--- |');
    expect(moveTableColumn('| A | B | hidden |', 0, 1, 2)).toBe('| B | A | hidden |');
    expect(moveTableColumn('| A | B |', 0, 3, 2)).toBe('| A | B |');
  });

  it('changes column alignment without rewriting other delimiter cells', () => {
    expect(setColumnAlignment('| :---- | --: |', 1, 'center')).toBe('| :---- | :---: |');
    expect(setColumnAlignment('| :---- | --: |', 0, null)).toBe('| ---- | --: |');
    expect(setColumnAlignment('|---|---|', 1, 'left')).toBe('|---|:---|');
  });

  it('sorts body rows naturally and stably, with empty cells last', () => {
    const rows = ['| Ann | 10 |', '| Bo | 2 |', '| Cy | 2 |', '| Dee |  |'];
    expect(sortTableRows(rows, 1)).toEqual([rows[1], rows[2], rows[0], rows[3]]);
    expect(sortTableRows(rows, 1, true)).toEqual([rows[0], rows[1], rows[2], rows[3]]);
    expect(rows[0]).toBe('| Ann | 10 |');
    expect(sortTableRows(['| -10 |', '| -2 |', '| 1 |'], 0)).toEqual(['| -10 |', '| -2 |', '| 1 |']);
    expect(sortTableRows(['| **Z** |', '| A |', '| B |'], 0)).toEqual(['| A |', '| B |', '| **Z** |']);
    expect(sortTableRows(['| 2e309 |', '| 1e309 |'], 0)).toEqual(['| 1e309 |', '| 2e309 |']);
  });
});
