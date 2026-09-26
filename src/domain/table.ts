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
