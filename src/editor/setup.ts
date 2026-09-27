// Editor composition: builds the CodeMirror view and exposes it through EditorPort.
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { markdownKeymap } from '@codemirror/lang-markdown';
import { Compartment, EditorSelection, EditorState, Transaction, type Extension, type Text } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap, type KeyBinding } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import type { EditorPort } from '../app/ports';
import { documentDir } from '../domain/document';
import { formattingKeymap } from './commands';
import { livePreview, previewEnv } from './live-preview';
import { markdownSupport } from './syntax';
import { editorTheme } from './theme';

export interface EditorCommands {
  save(): void;
  saveAs(): void;
  open(): void;
  newDocument(): void;
  /** Switch to the reading view. */
  toggleReading(): void;
}

export interface EditorOptions {
  readonly parent: HTMLElement;
  readonly commands: EditorCommands;
  /** Turns an absolute file path into a URL the webview may load. */
  readonly fileUrl: (path: string) => string;
  readonly onDocChanged: () => void;
  readonly onSelectionChanged?: () => void;
}

export interface Editor {
  readonly view: EditorView;
  readonly port: EditorPort<Text>;
  readonly sourceMode: () => boolean;
  toggleSourceMode(): void;
  /** 1-based line at the top of the viewport. */
  topLine(): number;
  /** Scroll `line` to the top of the viewport and put the caret at its start. */
  revealLine(line: number): void;
}

/** Start typing after a leading heading marker rather than in front of it. */
export function initialCursor(text: string): number {
  return /^#{1,6}[ \t]+/.exec(text)?.[0].length ?? 0;
}

// Search is loaded on first use.
const searchCompartment = new Compartment();
async function openSearch(view: EditorView, replace: boolean) {
  const search = await import('@codemirror/search');
  if (!search.searchPanelOpen(view.state)) {
    view.dispatch({ effects: searchCompartment.reconfigure([search.search({ top: true }), keymap.of(search.searchKeymap)]) });
  }
  search.openSearchPanel(view);
  if (replace) {
    view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus();
  }
}

export function createEditor(options: EditorOptions): Editor {
  const mode = new Compartment();
  const env = new Compartment();
  let source = false;

  const envFor = (path: string | null) => previewEnv.of({ docDir: documentDir(path), fileUrl: options.fileUrl });
  const modeExtension = () => (source ? EditorView.editorAttributes.of({ class: 'cm-source-mode' }) : livePreview());

  const appKeys: KeyBinding[] = [
    { key: 'Mod-s', run: () => (options.commands.save(), true), preventDefault: true },
    { key: 'Mod-Shift-s', run: () => (options.commands.saveAs(), true), preventDefault: true },
    { key: 'Mod-o', run: () => (options.commands.open(), true), preventDefault: true },
    { key: 'Mod-n', run: () => (options.commands.newDocument(), true), preventDefault: true },
    { key: 'Mod-e', run: () => (options.commands.toggleReading(), true), preventDefault: true },
    { key: 'Mod-/', run: () => (toggleSourceMode(), true), preventDefault: true },
    { key: 'Mod-f', run: (v) => (void openSearch(v, false), true), preventDefault: true },
    { key: 'Mod-h', run: (v) => (void openSearch(v, true), true), preventDefault: true },
    { key: 'Tab', run: indentMore, shift: indentLess },
  ];

  const extensions = (path: string | null): Extension => [
    markdownSupport(),
    EditorState.allowMultipleSelections.of(true),
    editorTheme,
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    syntaxHighlighting(classHighlighter),
    keymap.of([...appKeys, ...formattingKeymap, ...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
    searchCompartment.of([]),
    mode.of(modeExtension()),
    env.of(envFor(path)),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off', 'aria-label': 'Document' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) options.onDocChanged();
      if (u.selectionSet || u.docChanged) options.onSelectionChanged?.();
    }),
  ];

  const stateFor = (text: string, path: string | null) =>
    EditorState.create({ doc: text, selection: EditorSelection.cursor(initialCursor(text)), extensions: extensions(path) });

  const view = new EditorView({ parent: options.parent, state: stateFor('', null) });

  // Table cells live inside a CodeMirror widget, so its keymap does not receive
  // their events. Keep document shortcuts available while the table has focus.
  view.dom.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest('.cm-lp-table')) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's' && !event.shiftKey) options.commands.save();
    else if (key === 's' && event.shiftKey) options.commands.saveAs();
    else if (key === 'o' && !event.shiftKey) options.commands.open();
    else if (key === 'n' && !event.shiftKey) options.commands.newDocument();
    else if (key === 'z' || key === 'y') {
      if (event.target instanceof HTMLInputElement) event.target.blur();
      (key === 'y' || event.shiftKey ? redo : undo)(view);
      view.focus();
    } else if (key === 'e' && !event.shiftKey) options.commands.toggleReading();
    else if (key === '/' && !event.shiftKey) toggleSourceMode();
    else if (key === 'f' && !event.shiftKey) void openSearch(view, false);
    else if (key === 'h' && !event.shiftKey) void openSearch(view, true);
    else return;
    event.preventDefault();
  }, true);

  function toggleSourceMode() {
    source = !source;
    view.dispatch({ effects: mode.reconfigure(modeExtension()) });
    view.focus();
  }

  const port: EditorPort<Text> = {
    snapshot: () => view.state.doc,
    toText: (doc) => doc.toString(),
    reset(text, path) {
      view.setState(stateFor(text, path));
      return view.state.doc;
    },
    replace(text) {
      const { main } = view.state.selection;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: EditorSelection.cursor(Math.min(main.head, text.length)),
        annotations: Transaction.userEvent.of('input.reload'),
      });
      return view.state.doc;
    },
    setDocumentPath(path) {
      view.dispatch({ effects: env.reconfigure(envFor(path)) });
    },
  };

  const topLine = () => {
    const scrolled = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
    return view.state.doc.lineAt(view.lineBlockAtHeight(Math.max(0, scrolled)).from).number;
  };

  const revealLine = (line: number) => {
    const { doc } = view.state;
    const target = doc.line(Math.min(Math.max(1, Math.round(line)), doc.lines));
    view.dispatch({
      selection: EditorSelection.cursor(target.from),
      effects: EditorView.scrollIntoView(target.from, { y: 'start' }),
    });
  };

  return { view, port, sourceMode: () => source, toggleSourceMode, topLine, revealLine };
}
