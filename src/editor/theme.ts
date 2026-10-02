import { EditorView } from '@codemirror/view';

/**
 * Overrides of CodeMirror's base theme. These must go through `EditorView.theme` to
 * out-rank the base rules; colours and sizes come from the CSS custom properties in
 * styles/app.css so themes only touch variables.
 */
export const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-body)',
    lineHeight: 'var(--line-height)',
    overflowAnchor: 'none',
  },
  '.cm-content': {
    maxWidth: 'var(--content-width)',
    margin: '0 auto',
    padding: '48px 32px 40vh',
    caretColor: 'var(--caret)',
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { border: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--caret)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--selection)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '&.cm-source-mode .cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '0.92em' },
});
