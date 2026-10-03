// The editor surface: CodeMirror live preview wired to the document controller.
// Loaded on demand by boot.ts (and preloaded when the page is idle), so none of it is
// on the reading view's startup path.
import './styles/editor.css';
import { createDocumentController, type ImportOutcome } from './app/controller';
import type { Platform, Prompter, RecoveryScope, RecoveryCopy, Heading } from './app/ports';
import type { EditorHandle } from './app/workspace';
import { createEditor, type Editor } from './editor/setup';
import type { FileTransfer } from './editor/attachments';
import { checkClipboardFileSize } from './domain/attachment';
import { wordCounter, type StatusBar } from './ui/status-bar';
import { createSaveIndicator } from './ui/save-status';
import { createPropertiesPanel, type PropertiesPanel } from './ui/properties';
import { isolateHistory } from '@codemirror/commands';
import { Transaction, type ChangeDesc, type Text } from '@codemirror/state';
import { createHeadingObserver } from './editor/heading-observer';
import { indexHeadings } from './editor/heading-worker-client';
import { editorPreferencesStore } from './platform/editor-preferences';
import { substitutionsStore } from './platform/substitutions';

export interface EditorAppOptions {
  readonly platform: Platform;
  readonly prompter: Prompter;
  readonly parent: HTMLElement;
  readonly status: StatusBar;
  /** Turns an absolute file path into a URL the webview may load. */
  readonly fileUrl: (path: string) => string;
  readonly domFileDrop: boolean;
  readonly onDocumentPathChanged: (path: string | null) => void;
  readonly onStateChanged?: () => void;
  readonly onHeadingsChanged?: (headings: readonly Heading[]) => void;
  readonly recoveryScope?: RecoveryScope | (() => RecoveryScope);
  readonly onSaveAsFinished?: (saved: boolean, currentPath: string | null, target: string | null) => void;
  readonly allowRecovery?: (copy: RecoveryCopy) => Promise<boolean>;
  /** Workspace-level commands, so mode and title stay consistent. */
  readonly commands: {
    readonly toggleReading: () => void;
    readonly save: () => void;
    readonly saveAs: () => void;
    readonly open: () => void;
    readonly newDocument: () => void;
  };
}

export interface EditorApp extends EditorHandle {
  readonly editor: Editor;
  revealHeading(heading: Heading): void;
  /** The editor surface became visible. */
  shown(): void;
  openProperties(): void;
  dismissPanels(): boolean;
  savePendingProperties(): boolean;
  dispose(): void;
}

export function createEditorApp(options: EditorAppOptions): EditorApp {
  const { platform, prompter } = options;
  let properties: PropertiesPanel | undefined;
  const preferences = editorPreferencesStore();
  const substitutions = substitutionsStore();
  let headingObserver: ReturnType<typeof createHeadingObserver> | undefined;
  let headingDocument: Text | undefined;
  let headingChanges: ChangeDesc | undefined;
  const importFiles = ({ files, insertion, fallbackText, contentText }: FileTransfer) => {
    try {
      files.forEach((file) => checkClipboardFileSize(file.size));
    } catch (error) {
      prompter.notify(`Could not import attachment: ${String(error)}`);
      if (fallbackText) insertion.insert(fallbackText);
      insertion.cancel();
      return;
    }
    const beforePath = controller.info().path;
    void controller.importAttachments(files.map((file) => ({
      kind: 'bytes' as const,
      name: file.name,
      mimeType: file.type,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    })), (markdown) => insertion.insert(contentText
      ? `${contentText}${contentText.endsWith('\n') ? '' : '\n'}${markdown}` : markdown)).then((outcome) => {
      if (outcome === 'failed' && fallbackText) insertion.insert(fallbackText);
      insertion.cancel();
      if (controller.info().path !== beforePath) options.onDocumentPathChanged(controller.info().path);
    }).catch((error) => {
      prompter.notify(`Could not import attachment: ${String(error)}`);
      if (fallbackText) insertion.insert(fallbackText);
      insertion.cancel();
    });
  };
  const editor = createEditor({
    preferences: preferences.get(),
    substitutions: substitutions.get(),
    externalShortcuts: true,
    parent: options.parent,
    fileUrl: options.fileUrl,
    commands: {
      save: options.commands.save,
      saveAs: options.commands.saveAs,
      open: options.commands.open,
      newDocument: options.commands.newDocument,
      toggleReading: options.commands.toggleReading,
    },
    onDocChanged: (update) => {
      controller.contentChanged();
      words.update();
      properties?.refresh();
      if (headingChanges) headingChanges = headingChanges.composeDesc(update.changes);
      headingObserver?.refresh();
    },
    onDocumentReset: () => {
      properties?.refresh(true);
      headingDocument = undefined;
      headingChanges = undefined;
      options.onHeadingsChanged?.([]);
      headingObserver?.refresh(0);
    },
    onTablePasteRejected: (message) => prompter.notify(message),
    onFileTransfer: importFiles,
    onNativeImagePaste: options.domFileDrop ? undefined : (insertion) => {
      void import('./platform/tauri-clipboard').then((module) => module.readClipboardImage()).then((file) => {
        if (file) importFiles({ files: [file], insertion, fallbackText: '', contentText: '' });
        else insertion.cancel();
      }).catch((error) => {
        prompter.notify(`Could not read clipboard image: ${String(error)}`);
        insertion.cancel();
      });
    },
    domFileDrop: options.domFileDrop,
  });
  const renderSaveStatus = createSaveIndicator(options.status, options.commands.save);
  const showSaveStatus = (state: Parameters<typeof renderSaveStatus>[0]) => {
    renderSaveStatus(state);
    options.onStateChanged?.();
  };
  const controller = createDocumentController({
    platform, prompter, editor: editor.port,
    onSaveStatus: showSaveStatus,
    recoveryScope: options.recoveryScope,
    onSaveAsFinished: options.onSaveAsFinished,
    allowRecovery: options.allowRecovery,
  });
  const words = wordCounter(options.status, () => editor.view.state.doc.iter(), () => (editor.sourceMode() ? 'Source' : ''));
  properties = createPropertiesPanel(options.parent, {
    externalShortcuts: true,
    controls: false,
    source: () => editor.view.state.doc.sliceString(0, Math.min(editor.view.state.doc.length, 257 * 1024)),
    apply: (change, start = false) => editor.view.dispatch({ changes: change,
      annotations: [...(start ? [isolateHistory.of('before')] : []), Transaction.userEvent.of('input.type.properties')] }),
    finishEdit: () => editor.view.dispatch({ annotations: isolateHistory.of('after') }),
    focusDocument: () => editor.view.focus(),
    editSource: () => {
      if (!editor.sourceMode()) editor.toggleSourceMode();
      editor.revealLine(1);
      editor.view.focus();
    },
    saveDocument: options.commands.save,
    onOpen: () => {},
  });
  const stopPreferences = preferences.subscribe(editor.setPreferences);
  const stopSubstitutions = substitutions.subscribe(editor.setSubstitutions);
  if (options.onHeadingsChanged) {
    headingObserver = createHeadingObserver({
      source: () => editor.view.state.doc.toString(),
      index: indexHeadings,
      changed: (next) => {
        headingDocument = editor.view.state.doc;
        headingChanges = editor.view.state.changes([]);
        options.onHeadingsChanged?.(next);
      },
      failed: (error) => prompter.notify(`Could not update Contents: ${String(error)}`),
    });
    headingObserver.refresh(0);
  }

  return {
    editor,
    openProperties: () => properties?.open(),
    dismissPanels: () => properties?.dismiss() ?? false,
    savePendingProperties: () => properties?.commit() ?? true,
    controller,
    text: () => editor.view.state.doc.toString(),
    topLine: editor.topLine,
    revealLine: editor.revealLine,
    revealHeading(heading) {
      if (!headingDocument || !headingChanges) return;
      const from = headingDocument.line(heading.line).from;
      editor.revealLine(editor.view.state.doc.lineAt(headingChanges.mapPos(from, 1)).number);
    },
    focus: () => editor.view.focus(),
    async importPaths(paths: readonly string[], at?: { readonly x: number; readonly y: number }): Promise<ImportOutcome> {
      const beforePath = controller.info().path;
      const insertion = editor.beginInsertion(at);
      if (!insertion) {
        prompter.notify('Drop files over the editor to attach them.');
        return 'failed';
      }
      const outcome = await controller.importAttachments(paths.map((path) => ({ kind: 'path', path })), (markdown) => insertion.insert(markdown));
      insertion.cancel();
      if (controller.info().path !== beforePath) options.onDocumentPathChanged(controller.info().path);
      return outcome;
    },
    shown() {
      editor.view.requestMeasure();
      words.update(0);
    },
    dispose() {
      words.cancel();
      properties?.dispose();
      stopPreferences();
      stopSubstitutions();
      headingObserver?.dispose();
      editor.view.destroy();
    },
  };
}
