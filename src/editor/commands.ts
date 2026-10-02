// Formatting commands (Typora-compatible shortcuts). Each keybinding runs a pure
// helper `(state) => TransactionSpec | null` so the logic is testable headlessly;
// the `StateCommand` wrapper just dispatches the spec (or returns false to let the
// key fall through). Every dispatched transaction carries `userEvent: 'input.format'`
// so it collapses into a single undo step.
import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Line,
  type SelectionRange,
  type StateCommand,
  type Text,
  type TransactionSpec,
} from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/** Wraps a pure helper into a `StateCommand`: dispatch the spec, or fall through. */
function command(fn: (state: EditorState) => TransactionSpec | null): StateCommand {
  return ({ state, dispatch }) => {
    const spec = fn(state);
    if (!spec) return false;
    dispatch(state.update({ ...spec, userEvent: 'input.format' }));
    return true;
  };
}

// ---------------------------------------------------------------------------
// Inline toggle marks (bold, italic, underline, code, strikethrough)

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_]/u.test(c);

/** The word touching `pos` (caret just before/after counts), or null if there isn't one. */
function wordAt(doc: Text, pos: number): { from: number; to: number } | null {
  const line = doc.lineAt(pos);
  const text = line.text;
  const offset = pos - line.from;
  if (!isWordChar(text[offset - 1]) && !isWordChar(text[offset])) return null;
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isWordChar(text[end])) end++;
  return { from: line.from + start, to: line.from + end };
}

const isHomogeneous = (marker: string): boolean => marker.length > 0 && [...marker].every((c) => c === marker[0]);

/** `text` starts with `marker`, and it isn't just the prefix of a longer run of the same char. */
function startsWithMarker(text: string, marker: string): boolean {
  if (!text.startsWith(marker)) return false;
  return !isHomogeneous(marker) || text[marker.length] !== marker[marker.length - 1];
}

/** `text` ends with `marker`, and it isn't just the suffix of a longer run of the same char. */
function endsWithMarker(text: string, marker: string): boolean {
  if (!text.endsWith(marker)) return false;
  const idx = text.length - marker.length - 1;
  return !isHomogeneous(marker) || idx < 0 || text[idx] !== marker[marker.length - 1];
}

function flankedByMarker(doc: Text, from: number, to: number, open: string, close: string): boolean {
  const before = doc.sliceString(Math.max(0, from - open.length - 1), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + close.length + 1));
  return endsWithMarker(before, open) && startsWithMarker(after, close);
}

/** The innermost `nodeName` node (with `markName` open/close children) enclosing `[from, to]`. */
function findEnclosingMarks(
  state: EditorState,
  from: number,
  to: number,
  nodeName: string,
  markName: string,
): { open: SyntaxNode; close: SyntaxNode } | null {
  const tree = syntaxTree(state);
  const mid = from === to ? from : (from + to) >> 1;
  let node: SyntaxNode | null = tree.resolveInner(mid, 1);
  while (node) {
    if (node.name === nodeName && node.from <= from && node.to >= to) {
      const marks: SyntaxNode[] = [];
      for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === markName) marks.push(c);
      if (marks.length >= 2) return { open: marks[0]!, close: marks[marks.length - 1]! };
    }
    node = node.parent;
  }
  return null;
}

interface MarkSpec {
  readonly open: string;
  readonly close: string;
  /** Syntax node/mark names used to detect (and cleanly unwrap) an already-wrapped range. */
  readonly node?: { readonly name: string; readonly mark: string };
}

function toggleMarkRange(
  state: EditorState,
  range: SelectionRange,
  spec: MarkSpec,
): { changes: ChangeSpec; range: SelectionRange } {
  const doc = state.doc;
  let { from, to } = range;
  if (from === to) {
    const w = wordAt(doc, from);
    if (w) ({ from, to } = w);
  }
  const { open, close, node } = spec;
  const text = doc.sliceString(from, to);

  // The selection itself includes the markers (e.g. the user selected "**bold**").
  if (text.length >= open.length + close.length && startsWithMarker(text, open) && endsWithMarker(text, close)) {
    const inner = text.slice(open.length, text.length - close.length);
    return { changes: { from, to, insert: inner }, range: EditorSelection.range(from, from + inner.length) };
  }

  // The markers sit just outside the selection.
  if (flankedByMarker(doc, from, to, open, close)) {
    return {
      changes: [
        { from: from - open.length, to: from, insert: '' },
        { from: to, to: to + close.length, insert: '' },
      ],
      range: EditorSelection.range(from - open.length, to - open.length),
    };
  }

  // The caret/selection sits inside a matching syntax node (handles nested emphasis).
  if (node) {
    const match = findEnclosingMarks(state, from, to, node.name, node.mark);
    if (match) {
      const shift = match.open.to - match.open.from;
      return {
        changes: [
          { from: match.open.from, to: match.open.to, insert: '' },
          { from: match.close.from, to: match.close.to, insert: '' },
        ],
        range: EditorSelection.range(from - shift, to - shift),
      };
    }
  }

  // Not wrapped: apply the markers.
  return {
    changes: [{ from, insert: open }, { from: to, insert: close }],
    range:
      from === to
        ? EditorSelection.cursor(from + open.length)
        : EditorSelection.range(from + open.length, to + open.length),
  };
}

function toggleMark(spec: MarkSpec) {
  return (state: EditorState): TransactionSpec | null => {
    const { changes, selection } = state.changeByRange((range) => toggleMarkRange(state, range, spec));
    return { changes, selection };
  };
}

const toggleBold = toggleMark({ open: '**', close: '**', node: { name: 'StrongEmphasis', mark: 'EmphasisMark' } });
const toggleItalic = toggleMark({ open: '*', close: '*', node: { name: 'Emphasis', mark: 'EmphasisMark' } });
const toggleUnderline = toggleMark({ open: '<u>', close: '</u>' });
const toggleInlineCode = toggleMark({ open: '`', close: '`', node: { name: 'InlineCode', mark: 'CodeMark' } });
const toggleStrikethrough = toggleMark({
  open: '~~',
  close: '~~',
  node: { name: 'Strikethrough', mark: 'StrikethroughMark' },
});

// ---------------------------------------------------------------------------
// Links

/** A bare URL, as opposed to prose the user wants to turn into link text. */
const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i;

function insertLink(state: EditorState): TransactionSpec | null {
  const { changes, selection } = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    if (text && URL_LIKE.test(text)) {
      const insert = `[](${text})`;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}](url)`;
    const urlFrom = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlFrom, urlFrom + 3),
    };
  });
  return { changes, selection };
}

// ---------------------------------------------------------------------------
// Line-prefix commands shared machinery
//
// Headings, blockquote and lists all work by replacing a line's leading marker.
// Editing only the marker (never the rest of the line) keeps everything after it
// at a fixed offset from the line start, so mapping the selection through the
// edit is just "shift by the marker's length delta" instead of collapsing to
// the edit boundary the way a whole-line replace would.

const ATX_HEADING = /^(#{1,6})[ \t]+/;
const QUOTE_PREFIX = /^>[ \t]?/;
const BULLET_PREFIX = /^[-*+][ \t]+/;
const ORDERED_PREFIX = /^\d+\.[ \t]+/;

function headingLevel(lineText: string): { level: number; prefixLength: number } {
  const m = ATX_HEADING.exec(lineText);
  return m ? { level: m[1]!.length, prefixLength: m[0].length } : { level: 0, prefixLength: 0 };
}

/** Line numbers touched by any selection range, deduplicated and ascending. */
function selectedLineNumbers(state: EditorState): number[] {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number;
    const end = state.doc.lineAt(range.to).number;
    for (let n = start; n <= end; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Runs `prefixFor` over every line touched by `range` and replaces just that
 * line's leading marker, returning the range mapped through those (and only
 * those) edits — so a multi-cursor selection maps each range through its own
 * changes, as `state.changeByRange` expects.
 */
function editLinePrefixes(
  state: EditorState,
  range: SelectionRange,
  prefixFor: (line: Line) => { oldLength: number; text: string } | null,
): { changes: ChangeSpec; range: SelectionRange } {
  const doc = state.doc;
  const startLine = doc.lineAt(range.from).number;
  const endLine = doc.lineAt(range.to).number;
  const localChanges: ChangeSpec[] = [];
  for (let n = startLine; n <= endLine; n++) {
    const line = doc.line(n);
    const next = prefixFor(line);
    if (!next || line.text.slice(0, next.oldLength) === next.text) continue;
    localChanges.push({ from: line.from, to: line.from + next.oldLength, insert: next.text });
  }
  const local = state.changes(localChanges);
  // A caret (empty range) must map both ends the same way, or it could turn into an
  // inverted range; bias forward, past any marker inserted right at its position.
  const toAssoc = range.empty ? 1 : -1;
  return {
    changes: localChanges,
    range: EditorSelection.range(local.mapPos(range.from, 1), local.mapPos(range.to, toAssoc)),
  };
}

function editEveryLinePrefix(
  state: EditorState,
  prefixFor: (line: Line) => { oldLength: number; text: string } | null,
): TransactionSpec | null {
  let changed = false;
  const { changes, selection } = state.changeByRange((range) =>
    editLinePrefixes(state, range, (line) => {
      const next = prefixFor(line);
      if (next && line.text.slice(0, next.oldLength) !== next.text) changed = true;
      return next;
    }),
  );
  return changed ? { changes, selection } : null;
}

// ---------------------------------------------------------------------------
// Headings

/** Pressing the same heading level again turns the line back into a paragraph. */
function setHeading(level: number) {
  return (state: EditorState): TransactionSpec | null =>
    editEveryLinePrefix(state, (line) => {
      const { level: current, prefixLength } = headingLevel(line.text);
      const next = current === level ? 0 : level;
      return { oldLength: prefixLength, text: next === 0 ? '' : `${'#'.repeat(next)} ` };
    });
}

// Typora: increase goes paragraph -> h6 -> h5 -> ... -> h1 (clamped at h1);
// decrease goes h1 -> h2 -> ... -> h6 -> paragraph (clamped at paragraph).
const increaseLevel = (level: number) => (level === 0 ? 6 : Math.max(1, level - 1));
const decreaseLevel = (level: number) => (level === 6 ? 0 : level === 0 ? 0 : level + 1);

function adjustHeading(dir: 'increase' | 'decrease') {
  const step = dir === 'increase' ? increaseLevel : decreaseLevel;
  return (state: EditorState): TransactionSpec | null =>
    editEveryLinePrefix(state, (line) => {
      const { level: current, prefixLength } = headingLevel(line.text);
      const next = step(current);
      return { oldLength: prefixLength, text: next === 0 ? '' : `${'#'.repeat(next)} ` };
    });
}

// ---------------------------------------------------------------------------
// Blockquote

function toggleBlockquote(state: EditorState): TransactionSpec | null {
  const lineNumbers = selectedLineNumbers(state);
  if (lineNumbers.length === 0) return null;
  const allQuoted = lineNumbers.every((n) => QUOTE_PREFIX.test(state.doc.line(n).text));
  return editEveryLinePrefix(state, (line) => {
    const m = QUOTE_PREFIX.exec(line.text);
    if (allQuoted) return m ? { oldLength: m[0].length, text: '' } : null;
    if (m) return null; // already quoted: leave it, don't stack a second ">"
    return { oldLength: 0, text: '> ' };
  });
}

// ---------------------------------------------------------------------------
// Lists

function listPrefixLength(text: string): number {
  const b = BULLET_PREFIX.exec(text);
  if (b) return b[0].length;
  const o = ORDERED_PREFIX.exec(text);
  return o ? o[0].length : 0;
}

/** Converting between list types replaces the marker rather than stacking a new one. */
function toggleList(kind: 'ordered' | 'bullet') {
  return (state: EditorState): TransactionSpec | null => {
    const lineNumbers = selectedLineNumbers(state);
    if (lineNumbers.length === 0) return null;
    const isTarget = (text: string) => (kind === 'ordered' ? ORDERED_PREFIX.test(text) : BULLET_PREFIX.test(text));
    const allTarget = lineNumbers.every((n) => isTarget(state.doc.line(n).text));
    // Ordered-list numbering is sequential across every touched line, computed up
    // front so each range's local edit (see editLinePrefixes) can look its own up.
    let counter = 1;
    const markerFor = new Map<number, string>();
    for (const n of lineNumbers) markerFor.set(n, allTarget ? '' : kind === 'ordered' ? `${counter++}. ` : '- ');
    return editEveryLinePrefix(state, (line) => {
      const marker = markerFor.get(line.number);
      if (marker === undefined) return null;
      return { oldLength: listPrefixLength(line.text), text: marker };
    });
  };
}

// ---------------------------------------------------------------------------
// Block inserts (fenced code, math, table)

/** Newline padding needed before `pos` so the inserted block starts on its own blank line. */
function leadingGap(doc: Text, pos: number): string {
  if (pos === 0) return '';
  const before = doc.sliceString(Math.max(0, pos - 2), pos);
  if (before.endsWith('\n\n')) return '';
  return before.endsWith('\n') ? '\n' : '\n\n';
}

/** Newline padding needed after `pos` so following content stays separated from the block. */
function trailingGap(doc: Text, pos: number): string {
  if (pos === doc.length) return '';
  const after = doc.sliceString(pos, Math.min(doc.length, pos + 2));
  if (after.startsWith('\n\n')) return '';
  return after.startsWith('\n') ? '\n' : '\n\n';
}

function insertFence(state: EditorState): TransactionSpec | null {
  const { changes, selection } = state.changeByRange((range) => {
    const doc = state.doc;
    if (range.empty) {
      const before = leadingGap(doc, range.from);
      const after = trailingGap(doc, range.from);
      const insert = `${before}\`\`\`\n\n\`\`\`${after}`;
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.cursor(range.from + before.length + 4),
      };
    }
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(range.to);
    const before = leadingGap(doc, startLine.from);
    const after = trailingGap(doc, endLine.to);
    const content = doc.sliceString(startLine.from, endLine.to);
    const insert = `${before}\`\`\`\n${content}\n\`\`\`${after}`;
    const contentFrom = startLine.from + before.length + 4;
    return {
      changes: { from: startLine.from, to: endLine.to, insert },
      range: EditorSelection.range(contentFrom, contentFrom + content.length),
    };
  });
  return { changes, selection };
}

function insertMathBlock(state: EditorState): TransactionSpec | null {
  const { changes, selection } = state.changeByRange((range) => {
    const doc = state.doc;
    const before = leadingGap(doc, range.from);
    const after = trailingGap(doc, range.from);
    const insert = `${before}$$\n\n$$${after}`;
    return {
      changes: { from: range.from, insert },
      range: EditorSelection.cursor(range.from + before.length + 3),
    };
  });
  return { changes, selection };
}

function insertTable(state: EditorState): TransactionSpec | null {
  const { changes, selection } = state.changeByRange((range) => {
    const doc = state.doc;
    const insertAt = doc.lineAt(range.head).to;
    const before = leadingGap(doc, insertAt);
    const after = trailingGap(doc, insertAt);
    const header = '| Column 1 | Column 2 | Column 3 |';
    const delimiter = '| --- | --- | --- |';
    const body = '|  |  |  |';
    const insert = `${before}${header}\n${delimiter}\n${body}${after}`;
    const cellFrom = insertAt + before.length + 2;
    return {
      changes: { from: insertAt, insert },
      range: EditorSelection.range(cellFrom, cellFrom + 'Column 1'.length),
    };
  });
  return { changes, selection };
}

// ---------------------------------------------------------------------------
// Keymap

export const formattingCommands = {
  bold: command(toggleBold), italic: command(toggleItalic), underline: command(toggleUnderline),
  inlineCode: command(toggleInlineCode), strike: command(toggleStrikethrough), link: command(insertLink),
  paragraph: command(setHeading(0)),
  heading1: command(setHeading(1)), heading2: command(setHeading(2)), heading3: command(setHeading(3)),
  heading4: command(setHeading(4)), heading5: command(setHeading(5)), heading6: command(setHeading(6)),
  increaseHeading: command(adjustHeading('increase')), decreaseHeading: command(adjustHeading('decrease')),
  quote: command(toggleBlockquote), orderedList: command(toggleList('ordered')), bulletList: command(toggleList('bullet')),
  codeBlock: command(insertFence), mathBlock: command(insertMathBlock), table: command(insertTable),
} as const;
export const formattingKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: formattingCommands.bold, preventDefault: true },
  { key: 'Mod-i', run: formattingCommands.italic, preventDefault: true },
  { key: 'Mod-u', run: formattingCommands.underline, preventDefault: true },
  { key: 'Mod-Shift-`', run: formattingCommands.inlineCode, preventDefault: true },
  { key: 'Alt-Shift-5', run: formattingCommands.strike, preventDefault: true },
  { key: 'Mod-k', run: formattingCommands.link, preventDefault: true },
  { key: 'Mod-0', run: formattingCommands.paragraph, preventDefault: true },
  { key: 'Mod-1', run: formattingCommands.heading1, preventDefault: true },
  { key: 'Mod-2', run: formattingCommands.heading2, preventDefault: true },
  { key: 'Mod-3', run: formattingCommands.heading3, preventDefault: true },
  { key: 'Mod-4', run: formattingCommands.heading4, preventDefault: true },
  { key: 'Mod-5', run: formattingCommands.heading5, preventDefault: true },
  { key: 'Mod-6', run: formattingCommands.heading6, preventDefault: true },
  { key: 'Mod-=', run: formattingCommands.increaseHeading, preventDefault: true },
  { key: 'Mod--', run: formattingCommands.decreaseHeading, preventDefault: true },
  { key: 'Mod-Shift-q', run: formattingCommands.quote, preventDefault: true },
  { key: 'Mod-Shift-[', run: formattingCommands.orderedList, preventDefault: true },
  { key: 'Mod-Shift-]', run: formattingCommands.bulletList, preventDefault: true },
  { key: 'Mod-Shift-k', run: formattingCommands.codeBlock, preventDefault: true },
  { key: 'Mod-Shift-m', run: formattingCommands.mathBlock, preventDefault: true },
  { key: 'Mod-Shift-t', run: formattingCommands.table, preventDefault: true },
];
