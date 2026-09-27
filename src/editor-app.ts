// The editor surface: CodeMirror live preview wired to the document controller.
// Loaded on demand by boot.ts (and preloaded when the page is idle), so none of it is
// on the reading view's startup path.
import './styles/editor.css';
import { createDocumentController } from './app/controller';
import type { Platform, Prompter } from './app/ports';
import type { EditorHandle } from './app/workspace';
import { createEditor, type Editor } from './editor/setup';
import { wordCounter, type StatusBar } from './ui/status-bar';

export interface EditorAppOptions {
  readonly platform: Platform;
  readonly prompter: Prompter;
  readonly parent: HTMLElement;
  readonly status: StatusBar;
  /** Turns an absolute file path into a URL the webview may load. */
  readonly fileUrl: (path: string) => string;
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
  });
  const controller = createDocumentController({ platform, prompter, editor: editor.port });
  const words = wordCounter(options.status, () => editor.view.state.doc.iter(), () => (editor.sourceMode() ? 'Source' : ''));

  return {
    editor,
    controller,
    text: () => editor.view.state.doc.toString(),
    topLine: editor.topLine,
    revealLine: editor.revealLine,
    focus: () => editor.view.focus(),
    shown() {
      editor.view.requestMeasure();
      words.update(0);
    },
  };
}
