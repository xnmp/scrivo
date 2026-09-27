// Live preview: Typora-style rendering of markdown source in place.
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { Facet, StateField, type ChangeSpec, type EditorState, type Extension, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { deleteTableColumn, emptyTableRow, insertTableColumn, moveTableColumn, pasteTableCells, replaceCell, setColumnAlignment, sortTableRows } from '../../domain/table';
import { buildBlocks, buildInline, type BlockCallbacks } from './build';
import { imageUrl, previewEnv, refreshPreview } from './env';
import type { InlineNode } from './inline-ast';
import type { TableAction } from './widgets';
import { renderMath } from './math';

function renderInline(nodes: readonly InlineNode[], parent: HTMLElement, view: EditorView): void {
  const env = view.state.facet(previewEnv);
  for (const node of nodes) {
    switch (node.t) {
      case 'text':
        parent.append(node.text);
        break;
      case 'code': {
        const el = document.createElement('code');
        el.className = 'cm-lp-code-inline';
        el.textContent = node.text;
        parent.append(el);
        break;
      }
      case 'math': {
        const el = document.createElement('span');
        el.className = 'cm-lp-math';
        renderMath(el, node.tex, false, () => view.requestMeasure());
        parent.append(el);
        break;
      }
      case 'image': {
        const src = imageUrl(env, node.src);
        const el = document.createElement('img');
        el.className = 'cm-lp-image';
        el.alt = node.alt;
        if (src) el.src = src;
        parent.append(el);
        break;
      }
      case 'link': {
        const el = document.createElement('a');
        el.className = 'cm-lp-link';
        el.title = node.href;
        renderInline(node.children, el, view);
        parent.append(el);
        break;
      }
      default: {
        const tag = { strong: 'strong', em: 'em', strike: 's', sub: 'sub', sup: 'sup' }[node.t];
        const el = document.createElement(tag);
        renderInline(node.children, el, view);
        parent.append(el);
      }
    }
  }
}

/** Cell edits change only the Markdown source; the table widget is a view of it. */
export const tablePasteNotice = Facet.define<(message: string) => void, (message: string) => void>({
  combine: (values) => values[values.length - 1] ?? (() => {}),
});

const structuralTableEdit = (view: EditorView, changes: ChangeSpec): void => {
  view.dispatch({ changes, userEvent: 'input.table', annotations: isolateHistory.of('full') });
};

function onTableCellInput(view: EditorView, tableFrom: number, row: number, col: number, value: string): void {
  const doc = view.state.doc;
  const first = doc.lineAt(tableFrom).number;
  const lineNo = row === 0 ? first : first + row + 1; // skip the delimiter row
  if (lineNo > doc.lines) return;
  const line = doc.line(lineNo);
  const next = replaceCell(line.text, col, value);
  if (next !== line.text) view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: 'input.table' });
}

function onTablePaste(view: EditorView, tableFrom: number, row: number, col: number, rows: number, text: string): { row: number; col: number } | null {
  const doc = view.state.doc;
  const first = doc.lineAt(tableFrom).number;
  if (first + rows > doc.lines) return null;
  const source = Array.from({ length: rows + 1 }, (_, offset) => doc.line(first + offset).text);
  const pasted = pasteTableCells(source, row, col, text);
  if (!pasted) {
    view.state.facet(tablePasteNotice)('Could not paste table cells: grid too large, or a cell contains tabs or line breaks.');
    return null;
  }
  structuralTableEdit(view, { from: doc.line(first).from, to: doc.line(first + rows).to, insert: pasted.lines.join('\n') });
  return { row: pasted.lastRow, col: pasted.lastColumn };
}

function onTableAppendRow(view: EditorView, tableFrom: number, rows: number, columns: number): void {
  const doc = view.state.doc;
  const lastLineNo = doc.lineAt(tableFrom).number + rows;
  if (lastLineNo > doc.lines) return;
  const last = doc.line(lastLineNo);
  structuralTableEdit(view, { from: last.to, insert: `\n${emptyTableRow(columns)}` });
}

function onTableAction(view: EditorView, tableFrom: number, row: number, col: number, rows: number, columns: number, action: TableAction): void {
  const doc = view.state.doc;
  const first = doc.lineAt(tableFrom).number;
  const lineNo = row === 0 ? first : first + row + 1;
  if (first + rows > doc.lines || col >= columns) return;

  if (action.startsWith('align-')) {
    const delimiter = doc.line(first + 1);
    const alignment = action === 'align-default' ? null : action.slice('align-'.length) as 'left' | 'center' | 'right';
    const insert = setColumnAlignment(delimiter.text, col, alignment);
    if (insert !== delimiter.text) structuralTableEdit(view, { from: delimiter.from, to: delimiter.to, insert });
    return;
  }

  if (action.startsWith('sort-')) {
    if (rows <= 2) return;
    const body = Array.from({ length: rows - 1 }, (_, index) => doc.line(first + index + 2));
    const sorted = sortTableRows(body.map((line) => line.text), col, action === 'sort-descending');
    if (sorted.every((source, index) => source === body[index]!.text)) return;
    structuralTableEdit(view, { from: body[0]!.from, to: body[body.length - 1]!.to, insert: sorted.join('\n') });
    return;
  }

  if (action.startsWith('move-row-')) {
    const destination = row + (action === 'move-row-up' ? -1 : 1);
    if (row === 0 || destination < 1 || destination >= rows) return;
    const a = doc.line(lineNo);
    const b = doc.line(first + destination + 1);
    if (a.text === b.text) return;
    structuralTableEdit(view, [
      { from: a.from, to: a.to, insert: b.text },
      { from: b.from, to: b.to, insert: a.text },
    ]);
    return;
  }

  if (action.startsWith('insert-column') || action === 'delete-column' || action.startsWith('move-column')) {
    if (action === 'delete-column' && columns <= 1) return;
    const at = action === 'insert-column-right' ? col + 1 : col;
    const changes = Array.from({ length: rows + 1 }, (_, offset) => {
      const line = doc.line(first + offset);
      const insert = action === 'delete-column'
        ? deleteTableColumn(line.text, at, columns)
        : action.startsWith('move-column')
          ? moveTableColumn(line.text, col, col + (action === 'move-column-right' ? 1 : -1), columns)
          : insertTableColumn(line.text, at, columns, offset === 1);
      return { from: line.from, to: line.to, insert };
    });
    if (changes.every((change) => doc.sliceString(change.from, change.to) === change.insert)) return;
    structuralTableEdit(view, changes);
    return;
  }

  if (action === 'delete-row') {
    if (row === 0 || lineNo > doc.lines) return;
    const line = doc.line(lineNo);
    const from = line.to < doc.length ? line.from : line.from - 1;
    const to = line.to < doc.length ? line.to + 1 : line.to;
    structuralTableEdit(view, { from, to });
    return;
  }

  if (action === 'insert-row-above' && row === 0) return;
  const line = doc.line(action === 'insert-row-below' && row === 0 ? first + 1 : lineNo);
  const change = action === 'insert-row-above'
    ? { from: line.from, insert: `${emptyTableRow(columns)}\n` }
    : { from: line.to, insert: `\n${emptyTableRow(columns)}` };
  structuralTableEdit(view, change);
}

const callbacks: BlockCallbacks = { onTableCellInput, onTablePaste, onTableAppendRow, onTableAction, renderInline };

const envChanged = (a: EditorState, b: EditorState) => a.facet(previewEnv) !== b.facet(previewEnv);
const refreshed = (trs: readonly Transaction[]) => trs.some((tr) => tr.effects.some((e) => e.is(refreshPreview)));

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      ({ decorations: this.decorations, atomic: this.atomic } = this.build(view));
    }

    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        envChanged(u.startState, u.state) ||
        refreshed(u.transactions)
      ) {
        ({ decorations: this.decorations, atomic: this.atomic } = this.build(u.view));
      }
    }

    build(view: EditorView) {
      const { state } = view;
      return buildInline(state, view.visibleRanges, state.selection.ranges, state.facet(previewEnv));
    }
  },
  {
    decorations: (p) => p.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

const blockField = StateField.define<DecorationSet>({
  create: (state) => buildBlocks(state, state.selection.ranges, callbacks),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      envChanged(tr.startState, tr.state) ||
      refreshed([tr])
    ) {
      return buildBlocks(tr.state, tr.state.selection.ranges, callbacks);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const livePreview = (): Extension => [inlinePlugin, blockField, EditorView.editorAttributes.of({ class: 'cm-live-preview' })];

export { previewEnv, refreshPreview } from './env';
