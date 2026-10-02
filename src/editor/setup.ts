// Editor composition: builds the CodeMirror view and exposes it through EditorPort.
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { foldCode, unfoldCode, foldedRanges, syntaxHighlighting, unfoldEffect } from '@codemirror/language';
import { Compartment, EditorSelection, EditorState, Prec, Transaction, type Extension, type Text } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap, lineNumbers, type KeyBinding, type ViewUpdate } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import type { EditorPort } from '../app/ports';
import { documentDir } from '../domain/document';
import { attachmentEvents, type FileTransfer, type Insertion } from './attachments';
import { richPaste } from './clipboard';
import { formattingCommands, formattingKeymap } from './commands';
import { markdownEditingKeymap } from './editing';
import { accessibleFoldGutter } from './folding';
import { livePreview, previewEnv, tablePasteNotice } from './live-preview';
import { markdownSupport } from './syntax';
import { editorTheme } from './theme';
import type { EditorPreferences } from '../domain/editor-preferences';
import { defaultEditorPreferences } from '../domain/editor-preferences';
import { indentationGuides } from './indentation-guides';

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
  readonly onDocChanged: (update: ViewUpdate) => void;
  readonly onDocumentReset?: () => void;
  readonly onSelectionChanged?: () => void;
  readonly onTablePasteRejected?: (message: string) => void;
  readonly onFileTransfer?: (transfer: FileTransfer) => void;
  readonly onNativeImagePaste?: (insertion: Insertion) => void;
  readonly domFileDrop?: boolean;
  readonly preferences?: EditorPreferences;
  readonly externalShortcuts?: boolean;
}

export interface Editor {
  readonly view: EditorView;
  readonly port: EditorPort<Text>;
  readonly sourceMode: () => boolean;
  toggleSourceMode(): void;
  runCommand(id: string): Promise<void>;
  setPreferences(preferences: EditorPreferences): void;
  /** 1-based line at the top of the viewport. */
  topLine(): number;
  /** Scroll `line` to the top of the viewport and put the caret at its start. */
  revealLine(line: number): void;
  beginInsertion(at?: { readonly x: number; readonly y: number }): EditorInsertion | null;
}

export type EditorInsertion = Insertion;

/** Start typing after a leading heading marker rather than in front of it. */
export function initialCursor(text: string): number {
  return /^#{1,6}[ \t]+/.exec(text)?.[0].length ?? 0;
}

// Search is loaded on first use.
const searchCompartment = new Compartment();
async function openSearch(view: EditorView, replace: boolean, external = false) {
  const search = await import('@codemirror/search');
  if (!search.searchPanelOpen(view.state)) {
    view.dispatch({ effects: searchCompartment.reconfigure([search.search({ top: true }), keymap.of(external ? search.searchKeymap.filter(binding => binding.key === 'Escape') : search.searchKeymap)]) });
  }
  search.openSearchPanel(view);
  if (replace) {
    view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus();
  }
}

export function createEditor(options: EditorOptions): Editor {
  const mode = new Compartment();
  const env = new Compartment();
  const preferenceCompartment = new Compartment();
  let preferences = options.preferences ?? defaultEditorPreferences;
  const preferenceExtensions = (): Extension => [
    ...(preferences.lineNumbers ? [lineNumbers()] : []),
    ...(preferences.indentationGuides ? [indentationGuides] : []),
    ...(preferences.lineWrapping ? [EditorView.lineWrapping] : []),
    EditorState.tabSize.of(preferences.tabSize),
    EditorView.contentAttributes.of({ spellcheck: String(preferences.spellcheck) }),
  ];
  let source = false;
  interface PendingInsertion { ranges: Array<{ from: number; to: number }>; valid: boolean }
  const pendingInsertions = new Set<PendingInsertion>();
  const invalidateInsertions = () => {
    for (const pending of pendingInsertions) pending.valid = false;
    pendingInsertions.clear();
  };

  const envFor = (path: string | null) => previewEnv.of({ docDir: documentDir(path), fileUrl: options.fileUrl });
  const modeExtension = () => (source ? EditorView.editorAttributes.of({ class: 'cm-source-mode' }) : livePreview());
  // CodeMirror hides gutters from assistive technology by default. This gutter
  // contains named buttons, so expose them after view construction and updates.
  const exposeFoldGutter = (view: EditorView) => view.dom.querySelector('.cm-gutters')?.removeAttribute('aria-hidden');

  const appKeys: KeyBinding[] = [
    { key: 'Mod-s', run: () => (options.commands.save(), true), preventDefault: true },
    { key: 'Mod-Shift-s', run: () => (options.commands.saveAs(), true), preventDefault: true },
    { key: 'Mod-o', run: () => (options.commands.open(), true), preventDefault: true },
    { key: 'Mod-n', run: () => (options.commands.newDocument(), true), preventDefault: true },
    { key: 'Mod-e', run: () => (options.commands.toggleReading(), true), preventDefault: true },
    { key: 'Mod-/', run: () => (toggleSourceMode(), true), preventDefault: true },
    { key: 'Mod-f', run: (v) => (void openSearch(v, false), true), preventDefault: true },
    { key: 'Mod-h', run: (v) => (void openSearch(v, true), true), preventDefault: true },
  ];

  const extensions = (path: string | null): Extension => [
    ...(options.onFileTransfer ? [attachmentEvents((at) => beginInsertion(at), options.onFileTransfer, options.domFileDrop ?? true, options.onNativeImagePaste)] : []),
    richPaste,
    markdownSupport(),
    EditorState.allowMultipleSelections.of(true),
    editorTheme,
    history(),
    drawSelection(),
    dropCursor(),
    closeBrackets(),
    accessibleFoldGutter(),
    preferenceCompartment.of(preferenceExtensions()),
    syntaxHighlighting(classHighlighter),
    // Some platforms send a lowercase character even with Shift held. The
    // default character keymap tries the unshifted command first in that case.
    // Resolve these distinct shifted document commands from modifier state.
    Prec.highest(EditorView.domEventHandlers({ keydown(event, view) {
      if (options.externalShortcuts || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return false;
      const key = event.key.toLowerCase();
      if (key === 'z') redo(view);
      else if (key === 's') options.commands.saveAs();
      else return false;
      return true;
    } })),
    keymap.of([...(options.externalShortcuts ? [] : appKeys), ...closeBracketsKeymap, ...(options.externalShortcuts ? [] : formattingKeymap), ...markdownEditingKeymap.filter(binding => !options.externalShortcuts || !binding.key?.startsWith('Mod-')), ...defaultKeymap.filter(binding => !options.externalShortcuts || !['Mod-i', 'Shift-Mod-k', 'Mod-/'].includes(binding.key ?? '')), ...(options.externalShortcuts ? [] : historyKeymap)]),
    searchCompartment.of([]),
    mode.of(modeExtension()),
    env.of(envFor(path)),
    tablePasteNotice.of(options.onTablePasteRejected ?? (() => {})),
    EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', 'aria-label': 'Document' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) for (const pending of pendingInsertions) {
        for (const range of pending.ranges) {
          if (range.from !== range.to && u.changes.touchesRange(range.from, range.to)) pending.valid = false;
          const from = u.changes.mapPos(range.from, range.from === range.to ? 1 : -1);
          const to = u.changes.mapPos(range.to, 1);
          range.from = from;
          range.to = to;
        }
      }
      exposeFoldGutter(u.view);
      if (u.docChanged) options.onDocChanged(u);
      if (u.selectionSet || u.docChanged) options.onSelectionChanged?.();
    }),
  ];

  const stateFor = (text: string, path: string | null) =>
    EditorState.create({ doc: text, selection: EditorSelection.cursor(initialCursor(text)), extensions: extensions(path) });

  const view = new EditorView({ parent: options.parent, state: stateFor('', null) });
  exposeFoldGutter(view);

  // Table cells live inside a CodeMirror widget, so its keymap does not receive
  // their events. Keep document shortcuts available while the table has focus.
  view.dom.addEventListener('keydown', (event) => {
    if (options.externalShortcuts || !(event.target instanceof HTMLElement) || !event.target.closest('.cm-lp-table')) return;
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
      invalidateInsertions();
      view.setState(stateFor(text, path));
      exposeFoldGutter(view);
      options.onDocumentReset?.();
      return view.state.doc;
    },
    replace(text) {
      invalidateInsertions();
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
    const unfold: Array<ReturnType<typeof unfoldEffect.of>> = [];
    foldedRanges(view.state).between(target.from, target.from, (from, to) => {
      if (from < target.from && to >= target.from) unfold.push(unfoldEffect.of({ from, to }));
    });
    view.dispatch({
      selection: EditorSelection.cursor(target.from),
      effects: [...unfold, EditorView.scrollIntoView(target.from, { y: 'start' })],
    });
  };

  const beginInsertion = (at?: { readonly x: number; readonly y: number }): EditorInsertion | null => {
    const position = at ? view.posAtCoords(at) : null;
    if (at && position === null) return null;
    const ranges = position === null
      ? view.state.selection.ranges.map(({ from, to }) => ({ from, to }))
      : [{ from: position, to: position }];
    const pending: PendingInsertion = { ranges, valid: true };
    pendingInsertions.add(pending);
    return {
      insert(markdown) {
        pendingInsertions.delete(pending);
        if (!pending.valid) return false;
        try {
          const changes = view.state.changes(pending.ranges.map(({ from, to }) => ({ from, to, insert: markdown })));
          const selection = EditorSelection.create(pending.ranges.map(({ to }) =>
            EditorSelection.cursor(changes.mapPos(to, 1))));
          view.dispatch({ changes, selection, annotations: Transaction.userEvent.of('input.paste'), scrollIntoView: true });
          view.focus();
          return true;
        } catch {
          return false;
        }
      },
      cancel() { pendingInsertions.delete(pending); },
    };
  };

  async function runCommand(id: string) {
    if (id === 'source') { toggleSourceMode(); return; }
    if (id === 'find' || id === 'replace') { await openSearch(view, id === 'replace', options.externalShortcuts); return; }
    if (id === 'findNext' || id === 'findPrevious') {
      const search = await import('@codemirror/search');
      (id === 'findNext' ? search.findNext : search.findPrevious)(view); return;
    }
    // Commit an active table cell before document history/formatting actions.
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && focused.closest('.cm-lp-table')) focused.blur();
    const run = { ...formattingCommands, undo, redo, fold: foldCode, unfold: unfoldCode }[id as keyof typeof formattingCommands | 'undo' | 'redo' | 'fold' | 'unfold'];
    if (run) { run(view); view.focus(); }
  }
  return { runCommand, view, port, sourceMode: () => source, toggleSourceMode, topLine, revealLine, beginInsertion,
    setPreferences(next) {
      preferences = next;
      view.dispatch({ effects: preferenceCompartment.reconfigure(preferenceExtensions()) });
    },
  };
}
