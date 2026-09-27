// The editor surface: CodeMirror live preview wired to the document controller.
// Loaded on demand by boot.ts (and preloaded when the page is idle), so none of it is
// on the reading view's startup path.
import './styles/editor.css';
import { createDocumentController, type ImportOutcome } from './app/controller';
import type { Platform, Prompter } from './app/ports';
import type { EditorHandle } from './app/workspace';
import { createEditor, type Editor } from './editor/setup';
import type { FileTransfer } from './editor/attachments';
import { checkClipboardFileSize } from './domain/attachment';
import { wordCounter, type StatusBar } from './ui/status-bar';
import { createSaveIndicator } from './ui/save-status';

export interface EditorAppOptions {
  readonly platform: Platform;
  readonly prompter: Prompter;
  readonly parent: HTMLElement;
  readonly status: StatusBar;
  /** Turns an absolute file path into a URL the webview may load. */
  readonly fileUrl: (path: string) => string;
  readonly domFileDrop: boolean;
  readonly onDocumentPathChanged: (path: string | null) => void;
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
  /** The editor surface became visible. */
  shown(): void;
}

export function createEditorApp(options: EditorAppOptions): EditorApp {
  const { platform, prompter } = options;
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
    parent: options.parent,
    fileUrl: options.fileUrl,
    commands: {
      save: options.commands.save,
      saveAs: options.commands.saveAs,
      open: options.commands.open,
      newDocument: options.commands.newDocument,
      toggleReading: options.commands.toggleReading,
    },
    onDocChanged: () => {
      controller.contentChanged();
      words.update();
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
  const showSaveStatus = createSaveIndicator(options.status, options.commands.save);
  const controller = createDocumentController({
    platform, prompter, editor: editor.port,
    onSaveStatus: showSaveStatus,
  });
  const words = wordCounter(options.status, () => editor.view.state.doc.iter(), () => (editor.sourceMode() ? 'Source' : ''));

  return {
    editor,
    controller,
    text: () => editor.view.state.doc.toString(),
    topLine: editor.topLine,
    revealLine: editor.revealLine,
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
  };
}
