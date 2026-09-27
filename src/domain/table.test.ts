import { describe, expect, it } from 'vitest';
import { deleteTableColumn, emptyTableRow, escapeCellPipes, insertTableColumn, moveTableColumn, parseAlignments, pasteTableCells, replaceCell, setColumnAlignment, sortTableRows, splitRow } from './table';

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

describe('pasting spreadsheet cells', () => {
  const source = ['| Name | Score |', '| :--- | ---: |', '| Ann | 10 |', '| Bo | 20 |'];

  it('fills a rectangle, expands the table, and keeps untouched cells and alignment', () => {
    const pasted = pasteTableCells(source, 1, 1, '25\tnew|value\r\n30\tlast\r\n');
    expect(pasted?.lines).toEqual([
      '| Name | Score |  |',
      '| :--- | ---: | --- |',
      '| Ann | 25 | new\\|value |',
      '| Bo | 30 | last |',
    ]);
    expect(source[2]).toBe('| Ann | 10 |');
  });

  it('adds body rows when a one-column clipboard block starts in the last row', () => {
    expect(pasteTableCells(source, 2, 0, 'Cy\nDee')?.lines).toEqual([
      '| Name | Score |', '| :--- | ---: |', '| Ann | 10 |', '| Cy | 20 |', '| Dee |  |',
    ]);
  });

  it('unquotes spreadsheet fields and rejects cells that cannot fit in Markdown tables', () => {
    expect(pasteTableCells(source, 1, 0, '"Ana ""A"""\t"25"')?.lines[2]).toBe('| Ana "A" | 25 |');
    expect(pasteTableCells(source, 1, 0, '"hello\nworld"\t42')).toBeNull();
    expect(pasteTableCells(source, 1, 0, '"hello\tworld"\t42')).toBeNull();
  });

  it('rejects plain text, out-of-range targets and excessively large grids', () => {
    expect(pasteTableCells(source, 1, 0, 'plain text')).toBeNull();
    expect(pasteTableCells(source, 9, 0, 'a\tb')).toBeNull();
    expect(pasteTableCells(source, 1, 0, `${'x\t'.repeat(20_001)}x`)).toBeNull();
    const tall = [source[0]!, source[1]!, ...Array(1_000).fill('| a | b |')];
    expect(pasteTableCells(tall, 1, 0, Array(101).fill('x').join('\t'))).toBeNull();
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
