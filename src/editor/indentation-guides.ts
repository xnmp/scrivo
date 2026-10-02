import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { indentationColumns } from '../domain/editor-preferences';

function guides(view: EditorView): DecorationSet {
  const ranges = [];
  const tabSize = view.state.tabSize;
  let previousLine = -1;
  for (const { from, to } of view.visibleRanges) {
    for (let position = from; position <= to;) {
      const line = view.state.doc.lineAt(position);
      const columns = indentationColumns(view.state.doc.sliceString(line.from, Math.min(line.to, line.from + 80)), tabSize);
      if (columns && line.from !== previousLine) ranges.push(Decoration.line({ attributes: {
        class: 'cm-indent-guides', style: `--indent-step:${tabSize}ch;--indent-width:${columns}ch`,
      } }).range(line.from));
      previousLine = line.from;
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

export const indentationGuides = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = guides(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.state.tabSize !== update.startState.tabSize) {
      this.decorations = guides(update.view);
    }
  }
}, { decorations: (plugin) => plugin.decorations });
