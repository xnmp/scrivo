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

export interface TablePaste {
  readonly lines: readonly string[];
  readonly lastRow: number;
  readonly lastColumn: number;
}

/** Spreadsheet TSV quoting follows CSV rules; a Markdown cell cannot contain a line break or tab. */
function parseTableClipboard(text: string): string[][] | null {
  const rows: string[][] = [];
  let cells: string[] = [];
  let value = '';
  let quoted = false;
  let afterQuote = false;
  let atStart = true;
  let width = 0;
  const addCell = () => {
    cells.push(value);
    value = '';
    atStart = true;
    afterQuote = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else if (char === '\t' || char === '\n') return null;
      else value += char;
    } else if (char === '\t' || char === '\n') {
      addCell();
      if (cells.length > 20_000) return null;
      if (char === '\n') {
        width = Math.max(width, cells.length);
        rows.push(cells);
        if (rows.length * width > 20_000) return null;
        cells = [];
      }
    } else if (char === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (afterQuote) {
      return null;
    } else {
      value += char;
      atStart = false;
    }
  }
  if (quoted) return null;
  addCell();
  width = Math.max(width, cells.length);
  rows.push(cells);
  return rows.length * width > 20_000 ? null : rows;
}

/** Paste a TSV rectangle into a rendered table while preserving untouched source rows. */
export function pasteTableCells(source: readonly string[], row: number, column: number, clipboard: string): TablePaste | null {
  if (source.length < 2 || row < 0 || column < 0 || clipboard.length > 1_000_000 || !/[\t\r\n]/.test(clipboard)) return null;
  const text = clipboard.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (!text) return null;
  const values = parseTableClipboard(text);
  if (!values) return null;
  const width = Math.max(...values.map((cells) => cells.length));
  const result = [...source];
  let columns = parseAlignments(result[1]!).length;
  if (columns === 0 || column >= columns || row >= source.length - 1) return null;
  const finalColumns = Math.max(columns, column + width);
  const finalRows = Math.max(source.length - 1, row + values.length);
  if (finalColumns * finalRows > 100_000) return null;
  if (finalColumns > columns) {
    const added = finalColumns - columns;
    for (let i = 0; i < result.length; i++) result[i] = insertTableColumn(result[i]!, columns, columns, i === 1, added);
    columns = finalColumns;
  }
  while (result.length - 1 < row + values.length) result.push(emptyTableRow(columns));
  for (let r = 0; r < values.length; r++) {
    const line = row + r === 0 ? 0 : row + r + 1;
    const cells = splitRow(result[line]!).map(({ from, to }) => result[line]!.slice(from, to));
    while (cells.length < columns) cells.push('');
    for (let c = 0; c < values[r]!.length; c++) cells[column + c] = escapeCellPipes(values[r]![c]!);
    result[line] = `| ${cells.join(' | ')} |`;
  }
  return { lines: result, lastRow: row + values.length - 1, lastColumn: column + values[values.length - 1]!.length - 1 };
}

/** Structural edits use a consistent pipe layout and keep each cell's Markdown. */
export function insertTableColumn(row: string, at: number, columns: number, delimiter: boolean, count = 1): string {
  const values = splitRow(row).map(({ from, to }) => row.slice(from, to));
  while (values.length < columns) values.push('');
  values.splice(at, 0, ...Array(count).fill(delimiter ? '---' : ''));
  return `| ${values.join(' | ')} |`;
}

export function deleteTableColumn(row: string, at: number, columns: number): string {
  const values = splitRow(row).map(({ from, to }) => row.slice(from, to));
  while (values.length < columns) values.push('');
  values.splice(at, 1);
  return `| ${values.join(' | ')} |`;
}

/** Move a column without discarding extra source cells in irregular body rows. */
export function moveTableColumn(row: string, from: number, to: number, columns: number): string {
  const values = splitRow(row).map(({ from: start, to: end }) => row.slice(start, end));
  while (values.length < columns) values.push('');
  if (from < 0 || from >= columns || to < 0 || to >= columns || from === to) return row;
  values.splice(to, 0, values.splice(from, 1)[0]!);
  return `| ${values.join(' | ')} |`;
}

/** Change only one delimiter cell, retaining its dash count and surrounding layout. */
export function setColumnAlignment(row: string, column: number, alignment: Align): string {
  const cell = splitRow(row)[column];
  if (!cell) return row;
  const width = Math.max(3, (row.slice(cell.from, cell.to).match(/-+/)?.[0].length ?? 0));
  const dashes = '-'.repeat(width);
  const marker = alignment === 'left' ? `:${dashes}`
    : alignment === 'center' ? `:${dashes}:`
      : alignment === 'right' ? `${dashes}:` : dashes;
  return row.slice(0, cell.from) + marker + row.slice(cell.to);
}

/** Stable, human-friendly sort of body rows by the selected source cell. */
export function sortTableRows(rows: readonly string[], column: number, descending = false): string[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base', ignorePunctuation: true });
  const keyOf = (source: string): string => {
    const cell = splitRow(source)[column];
    if (!cell) return '';
    return source.slice(cell.from, cell.to)
      .replace(/\\([\\|*_~`\[\]])/g, '$1')
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`]/g, '')
      .trim();
  };
  const numberOf = (key: string): number | null => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(key)) return null;
    const value = Number(key);
    return Number.isFinite(value) ? value : null;
  };
  return rows.map((source, index) => ({
    source,
    index,
    key: keyOf(source),
  })).sort((a, b) => {
    if (!a.key) return b.key ? 1 : a.index - b.index;
    if (!b.key) return -1;
    const left = numberOf(a.key);
    const right = numberOf(b.key);
    const order = left !== null && right !== null
      ? Math.sign(left - right)
      : collator.compare(a.key, b.key);
    return (descending ? -1 : 1) * order || a.index - b.index;
  }).map(({ source }) => source);
}
