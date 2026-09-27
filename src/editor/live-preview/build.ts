// Pure decoration builders: (EditorState, selection, visible ranges) → decorations.
//
// - `buildInline` handles everything that stays within a line (hiding marks, styling
//   lines, inline widgets). It only walks the visible ranges, so its cost is
//   proportional to the viewport, not the document.
// - `buildBlocks` handles widgets that replace whole multi-line blocks (tables, display
//   math). CodeMirror requires those to come from state, not a view plugin; it walks
//   only top-level blocks and defers all rendering work to the widgets' toDOM.
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { reachesPrefix, touches, type Span } from '../../domain/reveal';
import { parseAlignments, splitRow } from '../../domain/table';
import { imageUrl, type PreviewEnv } from './env';
import { inlineAst, type InlineNode } from './inline-ast';
import { BulletWidget, CheckboxWidget, ImageWidget, MathWidget, TableWidget, type TableAction, type TableModel } from './widgets';

const hidden = Decoration.replace({});
const markCache = new Map<string, Decoration>();
const lineCache = new Map<string, Decoration>();
const markDeco = (cls: string) => markCache.get(cls) ?? markCache.set(cls, Decoration.mark({ class: cls })).get(cls)!;
const lineDeco = (cls: string) => lineCache.get(cls) ?? lineCache.set(cls, Decoration.line({ class: cls })).get(cls)!;

const INLINE_STYLE: Record<string, { cls: string; mark: string }> = {
  StrongEmphasis: { cls: 'cm-lp-strong', mark: 'EmphasisMark' },
  Emphasis: { cls: 'cm-lp-em', mark: 'EmphasisMark' },
  Strikethrough: { cls: 'cm-lp-strike', mark: 'StrikethroughMark' },
  Subscript: { cls: 'cm-lp-sub', mark: 'SubscriptMark' },
  Superscript: { cls: 'cm-lp-sup', mark: 'SuperscriptMark' },
  InlineCode: { cls: 'cm-lp-code-inline', mark: 'CodeMark' },
};

export interface InlineDecorations {
  readonly decorations: DecorationSet;
  /** Hidden line prefixes the caret should skip over (and Backspace delete whole). */
  readonly atomic: DecorationSet;
}

class Collector {
  readonly decos: Range<Decoration>[] = [];
  readonly atomic: Range<Decoration>[] = [];
  private readonly lines = new Set<string>();

  hide(from: number, to: number, atomic = false) {
    if (from >= to) return;
    this.decos.push(hidden.range(from, to));
    if (atomic) this.atomic.push(hidden.range(from, to));
  }
  replace(from: number, to: number, deco: Decoration) {
    this.decos.push(deco.range(from, to));
  }
  mark(from: number, to: number, cls: string) {
    if (from < to) this.decos.push(markDeco(cls).range(from, to));
  }
  widget(pos: number, deco: Decoration) {
    this.decos.push(deco.range(pos));
  }
  lineWith(lineStart: number, deco: Decoration) {
    this.decos.push(deco.range(lineStart));
  }
  line(lineStart: number, cls: string) {
    const key = `${lineStart}:${cls}`;
    if (this.lines.has(key)) return;
    this.lines.add(key);
    this.decos.push(lineDeco(cls).range(lineStart));
  }
}

const childrenNamed = (node: SyntaxNode, name: string): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c);
  return out;
};

const isSpaceAt = (state: EditorState, pos: number) => {
  const c = state.sliceDoc(pos, pos + 1);
  return c === ' ' || c === '\t';
};

const listLineCache = new Map<string, Decoration>();
/** Line decoration carrying the list depth, for hanging indents in CSS. */
function listLine(depth: number, continuation: boolean): Decoration {
  const key = `${depth}:${continuation}`;
  let deco = listLineCache.get(key);
  if (!deco) {
    deco = Decoration.line({ class: continuation ? 'cm-lp-li-cont' : 'cm-lp-li', attributes: { style: `--lp-depth: ${depth}` } });
    listLineCache.set(key, deco);
  }
  return deco;
}

function listDepth(node: SyntaxNode): number {
  let depth = -1;
  for (let p: SyntaxNode | null = node; p; p = p.parent) {
    if (p.name === 'BulletList' || p.name === 'OrderedList') depth++;
  }
  return Math.max(0, depth);
}

export function buildInline(
  state: EditorState,
  visible: readonly Span[],
  selection: readonly Span[],
  env: PreviewEnv,
): InlineDecorations {
  const out = new Collector();
  const tree = syntaxTree(state);
  const doc = state.doc;

  for (const range of visible) {
    // Line decorations for a block are limited to the visible part of it.
    const eachLine = (from: number, to: number, fn: (line: { from: number; to: number; number: number }) => void) => {
      const start = Math.max(from, range.from);
      const end = Math.min(to, range.to);
      if (start > end) return;
      for (let pos = start; pos <= end; ) {
        const line = doc.lineAt(pos);
        fn(line);
        pos = line.to + 1;
      }
    };

    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (ref: SyntaxNodeRef): boolean | void => {
        const name = ref.name;
        const { from, to } = ref;

        if (name.startsWith('ATXHeading')) {
          const level = name.charAt(10);
          const line = doc.lineAt(from);
          out.line(line.from, `cm-lp-h cm-lp-h${level}`);
          const marks = childrenNamed(ref.node, 'HeaderMark');
          const open = marks[0];
          if (open && open.from === from) {
            let end = open.to;
            while (end < line.to && isSpaceAt(state, end)) end++;
            // Keep a bare `#` visible while it's being typed; hide once followed by a space.
            // Hide from the marker, not the line start: in `> # x` the quote owns `> `.
            if (end > open.to && !reachesPrefix(selection, open.from, end)) out.hide(open.from, end, true);
          }
          const close = marks.length > 1 ? marks[marks.length - 1] : undefined;
          if (close && close !== open) {
            let start = close.from;
            while (start > (open?.to ?? from) && isSpaceAt(state, start - 1)) start--;
            if (!touches(selection, start, line.to)) out.hide(start, close.to);
          }
          return;
        }

        if (name === 'SetextHeading1' || name === 'SetextHeading2') {
          const underline = ref.node.getChild('HeaderMark');
          const cls = `cm-lp-h cm-lp-h${name.charAt(13)}`;
          eachLine(from, underline ? underline.from - 1 : to, (l) => out.line(l.from, cls));
          if (underline) {
            const line = doc.lineAt(underline.from);
            if (!touches(selection, line.from, line.to)) {
              out.line(line.from, 'cm-lp-setext-underline');
              out.hide(underline.from, underline.to);
            }
          }
          return;
        }

        const inline = INLINE_STYLE[name];
        if (inline) {
          out.mark(from, to, inline.cls);
          if (!touches(selection, from, to)) {
            for (const m of childrenNamed(ref.node, inline.mark)) out.hide(m.from, m.to);
          }
          return name === 'InlineCode' ? false : undefined;
        }

        switch (name) {
          case 'Link': {
            const node = ref.node;
            const marks = childrenNamed(node, 'LinkMark');
            const url = node.getChild('URL');
            const label = node.getChild('LinkLabel');
            const open = marks[0];
            const close = marks[1];
            if (!open || !close || (!url && !label)) return; // `[text]` with no target is text
            out.mark(open.to, close.from, 'cm-lp-link');
            if (!touches(selection, from, to)) {
              out.hide(from, open.to);
              out.hide(close.from, to);
            } else if (url) {
              out.mark(url.from, url.to, 'cm-lp-url');
            }
            return;
          }

          case 'Image': {
            const node = ref.node;
            const marks = childrenNamed(node, 'LinkMark');
            const url = node.getChild('URL');
            const alt = marks.length >= 2 ? state.sliceDoc(marks[0]!.to, marks[1]!.from) : '';
            const src = url ? imageUrl(env, state.sliceDoc(url.from, url.to)) : null;
            const widget = new ImageWidget(src, alt);
            if (!touches(selection, from, to)) {
              out.replace(from, to, Decoration.replace({ widget }));
            } else {
              out.mark(from, to, 'cm-lp-image-src');
              out.widget(to, Decoration.widget({ widget, side: 1 }));
            }
            return false;
          }

          case 'Autolink': {
            const marks = childrenNamed(ref.node, 'LinkMark');
            out.mark(from, to, 'cm-lp-link');
            if (!touches(selection, from, to)) for (const m of marks) out.hide(m.from, m.to);
            return false;
          }

          case 'URL': {
            const parent = ref.node.parent?.name;
            if (parent !== 'Link' && parent !== 'Image' && parent !== 'Autolink' && parent !== 'LinkReference') {
              out.mark(from, to, 'cm-lp-link cm-lp-bare-url');
            }
            return;
          }

          case 'Blockquote':
            eachLine(from, to, (l) => out.line(l.from, 'cm-lp-quote'));
            return;

          case 'QuoteMark': {
            const line = doc.lineAt(from);
            const end = isSpaceAt(state, to) ? to + 1 : to;
            if (!reachesPrefix(selection, line.from, end)) out.hide(from, end, true);
            return;
          }

          case 'ListMark': {
            const item = ref.node.parent;
            const list = item?.parent;
            const depth = listDepth(ref.node);
            const line = doc.lineAt(from);
            // Indent by nesting depth rather than by the source's leading spaces, which
            // are only a few pixels wide in a proportional font.
            if (from > line.from && /^[ \t]+$/.test(state.sliceDoc(line.from, from))) {
              if (!reachesPrefix(selection, line.from, from)) out.hide(line.from, from, true);
            }
            if (line.from >= range.from) out.lineWith(line.from, listLine(depth, false));
            for (let child = item?.firstChild; child; child = child.nextSibling) {
              if (child.name !== 'Paragraph') continue;
              eachLine(child.from, child.to, (l) => {
                if (l.from === line.from) return;
                out.lineWith(l.from, listLine(depth, true));
                const indent = /^[ \t]*/.exec(state.sliceDoc(l.from, l.to))![0].length;
                if (indent > 0 && !reachesPrefix(selection, l.from, l.from + indent)) out.hide(l.from, l.from + indent, true);
              });
            }
            if (list?.name === 'BulletList') {
              if (item?.getChild('Task')) {
                // Task items show just the checkbox, like Typora.
                const end = isSpaceAt(state, to) ? to + 1 : to;
                if (!touches(selection, from, end)) out.hide(from, end);
              } else if (!touches(selection, from, to)) {
                out.replace(from, to, Decoration.replace({ widget: new BulletWidget(listDepth(ref.node)) }));
              }
            } else {
              out.mark(from, to, 'cm-lp-ol-mark');
            }
            return;
          }

          case 'TaskMarker': {
            const checked = /x/i.test(state.sliceDoc(from + 1, to - 1));
            if (!touches(selection, from, to)) {
              out.replace(from, to, Decoration.replace({ widget: new CheckboxWidget(checked) }));
            }
            if (checked) {
              const task = ref.node.parent;
              if (task) out.mark(to, task.to, 'cm-lp-task-done');
            }
            return;
          }

          case 'HorizontalRule': {
            const line = doc.lineAt(from);
            if (!touches(selection, line.from, line.to)) {
              out.line(line.from, 'cm-lp-hr');
              out.hide(from, to);
            }
            return false;
          }

          case 'FencedCode': {
            const node = ref.node;
            const first = doc.lineAt(from);
            const last = doc.lineAt(to);
            const marks = childrenNamed(node, 'CodeMark');
            const closed = marks.length > 1;
            const info = node.getChild('CodeInfo');
            const revealed = touches(selection, first.from, last.to);
            eachLine(first.from, last.to, (l) => {
              let cls = 'cm-lp-codeblock';
              if (l.number === first.number) cls += ' cm-lp-codeblock-begin';
              if (closed && l.number === last.number) cls += ' cm-lp-codeblock-end';
              out.line(l.from, cls);
            });
            if (!revealed) {
              // From the fence marks, not line starts: container prefixes (`> `) own those.
              const open = marks[0];
              const close = closed ? marks[marks.length - 1] : undefined;
              if (open) out.hide(open.from, first.to);
              if (close) out.hide(close.from, last.to);
            }
            if (info && !revealed && first.from >= range.from) {
              const lang = state.sliceDoc(info.from, info.to).trim().split(/\s/)[0] ?? '';
              out.lineWith(first.from, Decoration.line({ attributes: { 'data-lang': lang } }));
            }
            return false;
          }

          case 'CodeBlock':
            eachLine(from, to, (l) => out.line(l.from, 'cm-lp-codeblock cm-lp-codeblock-indented'));
            return false;

          case 'HTMLBlock':
            eachLine(from, to, (l) => out.line(l.from, 'cm-lp-html-block'));
            return false;

          case 'HTMLTag':
          case 'Comment':
            out.mark(from, to, 'cm-lp-html');
            return false;

          case 'Escape':
            if (!touches(selection, from, to)) out.hide(from, from + 1);
            return false;

          case 'InlineMath': {
            if (!touches(selection, from, to)) {
              const marks = childrenNamed(ref.node, 'InlineMathMark');
              const tex = state.sliceDoc(marks[0]?.to ?? from, marks[1]?.from ?? to);
              out.replace(from, to, Decoration.replace({ widget: new MathWidget(tex, false) }));
            } else {
              out.mark(from, to, 'cm-lp-math-src');
            }
            return false;
          }

          case 'BlockMath':
            eachLine(from, to, (l) => out.line(l.from, 'cm-lp-math-block-src'));
            return false;

          case 'Table':
            eachLine(from, to, (l) => out.line(l.from, 'cm-lp-table-src'));
            return;

          case 'FrontMatter':
            eachLine(from, to, (l) => out.line(l.from, 'cm-lp-frontmatter'));
            return false;

          case 'LinkReference':
            out.mark(from, to, 'cm-lp-linkref');
            return false;
        }
        return;
      },
    });
  }

  return { decorations: Decoration.set(out.decos, true), atomic: Decoration.set(out.atomic, true) };
}

// ---------------------------------------------------------------------------
// Block widgets

export interface BlockCallbacks {
  readonly onTableCellInput: (view: EditorView, tableFrom: number, row: number, col: number, value: string) => void;
  readonly onTableAppendRow: (view: EditorView, tableFrom: number, rows: number, columns: number) => void;
  readonly onTableAction: (view: EditorView, tableFrom: number, row: number, col: number, rows: number, columns: number, action: TableAction) => void;
  readonly renderInline: (nodes: readonly InlineNode[], parent: HTMLElement, view: EditorView) => void;
}

/** Row lines of a table: header, delimiter, then body rows. */
export function tableModel(state: EditorState, table: SyntaxNode): TableModel {
  const doc = state.doc;
  const firstLine = doc.lineAt(table.from).number;
  const lastLine = doc.lineAt(table.to).number;
  const align = parseAlignments(doc.line(firstLine + 1).text);
  const sourceCells: string[][] = [];
  const rowLines: number[] = [];
  const rowNodes: (SyntaxNode | null)[] = [];
  for (let n = firstLine; n <= lastLine; n++) {
    if (n === firstLine + 1) continue; // delimiter row
    const line = doc.line(n);
    const cells = splitRow(line.text).slice(0, align.length);
    sourceCells.push(cells.map(({ from, to }) => line.text.slice(from, to)));
    rowLines.push(n);
    rowNodes.push(table.childAfter(line.from));
  }
  return {
    align,
    sourceCells,
    inlineNodes(row: number, col: number): readonly InlineNode[] {
      const lineNo = rowLines[row];
      if (lineNo === undefined) return [];
      const line = doc.line(lineNo);
      const cell = splitRow(line.text)[col];
      if (!cell) return [];
      const rowNode = rowNodes[row];
      return rowNode
        ? inlineAst(state, rowNode, line.from + cell.from, line.from + cell.to)
        : [{ t: 'text', text: line.text.slice(cell.from, cell.to) }];
    },
  };
}

export function buildBlocks(state: EditorState, selection: readonly Span[], callbacks: BlockCallbacks): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const doc = state.doc;
  const cursor = syntaxTree(state).topNode.cursor();
  if (!cursor.firstChild()) return Decoration.none;
  do {
    const name = cursor.name;
    if (name !== 'Table' && name !== 'BlockMath') continue;
    const node = cursor.node;
    const from = doc.lineAt(node.from).from;
    const to = doc.lineAt(node.to).to;
    const revealed = touches(selection, from, to);

    if (name === 'Table') {
      if (revealed || doc.lineAt(node.from).number + 1 > doc.lines) continue;
      const source = state.sliceDoc(from, to);
      const widget = new TableWidget(source, () => tableModel(state, node), callbacks.onTableCellInput, callbacks.onTableAppendRow, callbacks.onTableAction, callbacks.renderInline);
      decos.push(Decoration.replace({ widget, block: true }).range(from, to));
    } else {
      const marks = childrenNamed(node, 'BlockMathMark');
      const closed = marks.length > 1;
      const tex = state.sliceDoc(marks[0]?.to ?? node.from, closed ? marks[marks.length - 1]!.from : node.to).trim();
      const widget = new MathWidget(tex, true);
      if (!revealed) decos.push(Decoration.replace({ widget, block: true }).range(from, to));
      else decos.push(Decoration.widget({ widget, block: true, side: 1 }).range(to));
    }
  } while (cursor.nextSibling());
  return Decoration.set(decos);
}
