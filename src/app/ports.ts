// Ports: everything the application needs from the outside world. Adapters live in
// src/platform (Tauri, in-memory) and src/ui (prompts). Nothing here imports them.
import type { FileStamp, Snapshot } from '../domain/document';
import type { TextFormat } from '../domain/text-format';

export type FileErrorCode =
  | 'not-found'
  | 'permission-denied'
  | 'not-utf8'
  | 'is-directory'
  | 'conflict'
  | 'io';

export class FileError extends Error {
  constructor(
    readonly code: FileErrorCode,
    readonly path: string,
    detail?: string,
  ) {
    super(detail ?? `${code}: ${path}`);
    this.name = 'FileError';
  }
}

export interface ReadResult {
  /** Absolute path of the file that was read. */
  readonly path: string;
  /** Raw file text (BOM and line endings intact). */
  readonly text: string;
  readonly stamp: FileStamp;
}

/** The disk state a save is allowed to replace. */
export type WriteCondition =
  | { readonly kind: 'unchanged'; readonly stamp: FileStamp }
  | { readonly kind: 'absent' }
  | { readonly kind: 'overwrite' };

export interface FileSystem {
  /** Rejects with FileError. */
  read(path: string): Promise<ReadResult>;
  /**
   * Atomically replace (or create) the file. `unchanged` and `absent` reject with
   * FileError('conflict') when the disk state differs. `overwrite` is explicit.
   */
  write(path: string, text: string, condition: WriteCondition): Promise<FileStamp>;
  /** null when the file does not exist. */
  stat(path: string): Promise<FileStamp | null>;
  /** Watch the current document; null stops watching. Notifications are hints: stat before acting. */
  watch(path: string | null, onChange: () => void): Promise<void>;
}

export interface ImportedAttachment {
  readonly fileName: string;
  readonly stamp: FileStamp;
}

export interface AttachmentStore {
  importBytes(documentPath: string, name: string, mimeType: string, bytes: Uint8Array): Promise<ImportedAttachment>;
  importPath(documentPath: string, sourcePath: string): Promise<ImportedAttachment>;
  /** Delete only the unchanged file created by this import after insertion fails. */
  rollback(documentPath: string, imported: ImportedAttachment): Promise<void>;
}

export interface RecoveryCopy {
  readonly id: string;
  readonly path: string | null;
  readonly stamp: FileStamp | null;
  readonly format: TextFormat;
  /** Normalized editor text; format preserves its original BOM and line endings. */
  readonly text: string;
  readonly updatedAt: number;
}

export interface RecoveryStore {
  list(): Promise<readonly RecoveryCopy[]>;
  put(copy: RecoveryCopy): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface Dialogs {
  pickOpen(): Promise<string | null>;
  pickSave(suggestedPath: string): Promise<string | null>;
}

export interface WindowPort {
  setTitle(title: string): void;
  /** `handler` resolves true to let the window close. */
  onCloseRequested(handler: () => Promise<boolean>): void;
  onFocus(handler: () => void): void;
  destroy(): Promise<void>;
}

/** The document the process was launched with. */
export type StartupDocument =
  | { readonly kind: 'none' }
  | { readonly kind: 'file'; readonly file: ReadResult }
  /** Path given on the command line doesn't exist yet: start empty, save there. */
  | { readonly kind: 'new'; readonly path: string }
  | { readonly kind: 'error'; readonly error: FileError };

export interface Heading {
  readonly level: number;
  /** Plain text, markup removed. */
  readonly text: string;
  /** Anchor id in the rendered HTML. */
  readonly id: string;
  /** 1-based source line. */
  readonly line: number;
}

/**
 * A document rendered for the reading view. The HTML is safe to insert as-is: the
 * renderer never passes markup through from the document (see scrivo-render).
 * Block elements carry `data-line` with their 1-based source line.
 */
export interface ViewDocument {
  /** null when rendering an unsaved buffer. */
  readonly path: string | null;
  /** Disk stamp when rendered from a file. */
  readonly stamp: FileStamp | null;
  readonly html: string;
  /** UTF-16 offsets after complete top-level blocks; absent for simple test renderers. */
  readonly chunkEnds?: readonly number[];
  readonly headings: readonly Heading[];
}

/** What the window shows first. */
export type StartupView =
  | { readonly kind: 'view'; readonly document: ViewDocument;
      /** Complete cached view, loaded after the preview reaches the screen. */
      readonly loadTail?: () => Promise<ViewDocument> }
  /** No document, a new or unreadable file, or the editor was asked for. */
  | { readonly kind: 'edit' };

export interface Renderer {
  /** The prefetched startup document, rendered, or "start the editor". */
  startupView(): Promise<StartupView>;
  /** Read and render a file. Rejects with FileError. */
  renderFile(path: string): Promise<ViewDocument>;
  /** Render text as if it were the file at `path` (relative images resolve there). */
  renderText(text: string, path: string | null): Promise<ViewDocument>;
}

/** Hand things to the operating system. */
export interface Shell {
  /** Open a web or mail URL (http, https, mailto, tel) in the default application. */
  openUrl(url: string): Promise<void>;
  /**
   * Show a file in the system file manager. Local files are never opened directly:
   * a link in a document must not be able to launch a program.
   */
  revealFile(path: string): Promise<void>;
}

export interface Platform {
  readonly fs: FileSystem;
  readonly attachments: AttachmentStore;
  readonly recovery: RecoveryStore;
  readonly dialogs: Dialogs;
  readonly window: WindowPort;
  readonly render: Renderer;
  readonly shell: Shell;
  startupDocument(): Promise<StartupDocument>;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';
export type ConflictChoice = 'overwrite' | 'reload' | 'save-as' | 'cancel';

/** Questions the application asks the user. */
export interface Prompter {
  unsavedChanges(docName: string): Promise<UnsavedChoice>;
  saveConflict(docName: string): Promise<ConflictChoice>;
  changedOnDisk(docName: string): Promise<'reload' | 'keep'>;
  recover(docName: string, changedOnDisk: boolean): Promise<'restore' | 'dismiss' | 'cancel'>;
  notify(message: string): void;
}

/** What the application needs from the editor component. */
export interface EditorPort<S extends Snapshot> {
  /** Immutable snapshot of the current content. */
  snapshot(): S;
  toText(snapshot: S): string;
  /** Replace the document with fresh history (opening a file). */
  reset(text: string, documentPath: string | null): S;
  /** Replace the content as an undoable edit, keeping the selection where possible. */
  replace(text: string): S;
  setDocumentPath(path: string | null): void;
}
