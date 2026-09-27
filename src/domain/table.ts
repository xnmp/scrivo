// GFM table row helpers (pure). Cells are found by splitting on unescaped pipes rather
// than from the syntax tree, because the parser emits no node for an empty cell.

export type Align = 'left' | 'center' | 'right' | null;

export interface CellSpan {
  /** Offsets into the row text, trimmed of surrounding whitespace. */
  readonly from: number;
  readonly to: number;
}

/** Cell spans of one table row, in order. Leading/trailing pipes are optional. */
export function splitRow(text: string): CellSpan[] {
  const bounds: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === '|') bounds.push(i);
  }
  const starts = [-1, ...bounds];
  const ends = [...bounds, text.length];
  const cells: CellSpan[] = [];
  for (let k = 0; k < starts.length; k++) {
    let from = starts[k]! + 1;
    let to = ends[k]!;
    const isEdge = (k === 0 && bounds[0] !== undefined && text.slice(0, bounds[0]).trim() === '') ||
      (k === starts.length - 1 && bounds.length > 0 && text.slice(from).trim() === '');
    if (isEdge) continue;
    while (from < to && /\s/.test(text[from]!)) from++;
    while (to > from && /\s/.test(text[to - 1]!)) to--;
    cells.push({ from, to });
  }
  return cells;
}

/** Column alignments from the delimiter row, e.g. `|:--|:-:|--:|`. */
export function parseAlignments(delimiterRow: string): Align[] {
  return splitRow(delimiterRow).map(({ from, to }) => {
    const cell = delimiterRow.slice(from, to);
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
}

/** Keep a typed pipe inside its Markdown cell, including after an even backslash run. */
export function escapeCellPipes(text: string): string {
  let escaped = '';
  let slashes = 0;
  for (const char of text) {
    if (char === '|' && slashes % 2 === 0) escaped += '\\';
    escaped += char;
    slashes = char === '\\' ? slashes + 1 : 0;
  }
  return escaped;
}

/** Replace one cell without reformatting its neighbors. Missing cells are added. */
export function replaceCell(row: string, column: number, value: string): string {
  if (column < 0) return row;
  const cells = splitRow(row);
  const escaped = escapeCellPipes(value);
  const cell = cells[column];
  if (cell && cell.from === cell.to && escaped) {
    const left = row.lastIndexOf('|', cell.from - 1) + 1;
    const nextPipe = row.indexOf('|', cell.to);
    const right = nextPipe < 0 ? row.length : nextPipe;
    return row.slice(0, left) + ` ${escaped} ` + row.slice(right);
  }
  if (cell) {
    const suffix = row.slice(cell.to);
    let trailingSlashes = 0;
    for (let i = escaped.length - 1; i >= 0 && escaped[i] === '\\'; i--) trailingSlashes++;
    const separator = suffix.startsWith('|') && trailingSlashes % 2 === 1 ? ' ' : '';
    return row.slice(0, cell.from) + escaped + separator + suffix;
  }
  const values = cells.map(({ from, to }) => row.slice(from, to));
  while (values.length <= column) values.push('');
  values[column] = escaped;
  return `| ${values.join(' | ')} |`;
}

export function emptyTableRow(columns: number): string {
  return `| ${Array(columns).fill('').join(' | ')} |`;
}

/** Structural edits use a consistent pipe layout and keep each cell's Markdown. */
export function insertTableColumn(row: string, at: number, columns: number, delimiter: boolean): string {
  const values = splitRow(row).map(({ from, to }) => row.slice(from, to));
  while (values.length < columns) values.push('');
  values.splice(at, 0, delimiter ? '---' : '');
  return `| ${values.join(' | ')} |`;
}

export function deleteTableColumn(row: string, at: number, columns: number): string {
  const values = splitRow(row).map(({ from, to }) => row.slice(from, to));
  while (values.length < columns) values.push('');
  values.splice(at, 1);
  return `| ${values.join(' | ')} |`;
}
