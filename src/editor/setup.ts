// Editor composition: builds the CodeMirror view and exposes it through EditorPort.
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
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

  return { view, port, sourceMode: () => source, toggleSourceMode };
}
