// Document lifecycle use-cases: open, save, save as, new, close, reload.
//
// Every operation that reads or writes the document state runs through one serial
// queue, so a focus-triggered disk check can never interleave with a save (which
// would make our own write look like an external change and revert newer edits).
import { describeError } from './errors';
import {
  displayName,
  isDirty,
  untitled,
  windowTitle,
  type DocumentState,
  type FileStamp,
  type Snapshot,
} from '../domain/document';
import { decideExternalChange } from '../domain/external';
import { decode, encode } from '../domain/text-format';
import {
  FileError,
  type EditorPort,
  type Platform,
  type Prompter,
  type ReadResult,
  type StartupDocument,
  type WriteCondition,
} from './ports';

export interface DocumentInfo {
  readonly path: string | null;
  readonly dirty: boolean;
  readonly eol: string;
}

export interface DocumentController {
  start(startup: StartupDocument): Promise<void>;
  open(path?: string): Promise<void>;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  newDocument(): Promise<void>;
  /** Resolves true when the window may close. */
  requestClose(): Promise<boolean>;
  /** Look for changes made by other programs (call on window focus). */
  checkDisk(): Promise<void>;
  /** Notify the controller that the editor content changed. */
  contentChanged(): void;
  info(): DocumentInfo;
}

const serialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(op: () => Promise<T>): Promise<T> => {
    const result = tail.then(op);
    tail = result.catch(() => undefined);
    return result;
  };
};

const EOL_NAMES: Record<string, string> = { '\n': 'LF', '\r\n': 'CRLF', '\r': 'CR' };

export function createDocumentController<S extends Snapshot>(deps: {
  readonly platform: Platform;
  readonly prompter: Prompter;
  readonly editor: EditorPort<S>;
}): DocumentController {
  const { platform, prompter, editor } = deps;
  const serial = serialQueue();

  let doc: DocumentState<S> = untitled();
  let shownTitle = '';

  const dirty = (): boolean => isDirty(doc.saved, editor.snapshot());

  const refreshTitle = () => {
    const title = windowTitle(doc.path, dirty());
    if (title !== shownTitle) {
      shownTitle = title;
      platform.window.setTitle(title);
    }
  };

  const adopt = (file: ReadResult) => {
    const { text, format } = decode(file.text);
    const saved = editor.reset(text, file.path);
    doc = { path: file.path, format, saved, stamp: file.stamp };
    if (format.mixedEol) {
      prompter.notify(`${displayName(file.path)} mixes line endings; saving will use ${EOL_NAMES[format.eol]}.`);
    }
    refreshTitle();
  };

  const writeTo = async (path: string, condition: WriteCondition): Promise<boolean> => {
    // The snapshot we send is what's on disk afterwards; edits made while the write is
    // in flight must stay dirty.
    const snapshot = editor.snapshot();
    const text = encode(editor.toText(snapshot), doc.format);
    try {
      const stamp = await platform.fs.write(path, text, condition);
      const moved = path !== doc.path;
      doc = { path, format: { ...doc.format, mixedEol: false }, saved: snapshot, stamp };
      if (moved) editor.setDocumentPath(path);
      refreshTitle();
      return true;
    } catch (e) {
      if (e instanceof FileError && e.code === 'conflict') {
        const choice = await prompter.saveConflict(displayName(path));
        if (choice === 'overwrite') return writeTo(path, { kind: 'overwrite' });
        if (choice === 'reload') {
          if (path === doc.path) await reloadNow();
          else {
            try {
              adopt(await platform.fs.read(path));
            } catch (error) {
              prompter.notify(`Could not reload ${displayName(path)}: ${describeError(error)}`);
            }
          }
        }
        return false;
      }
      prompter.notify(`Could not save ${displayName(path)}: ${describeError(e)}`);
      return false;
    }
  };

  const saveAsNow = async (): Promise<boolean> => {
    const target = await platform.dialogs.pickSave(doc.path ?? 'Untitled.md');
    if (target === null) return false;
    const condition: WriteCondition = target === doc.path && doc.stamp !== null
      ? { kind: 'unchanged', stamp: doc.stamp }
      : { kind: 'absent' };
    return writeTo(target, condition);
  };

  const saveNow = (): Promise<boolean> => (doc.path === null ? saveAsNow() : writeTo(
    doc.path,
    doc.stamp === null ? { kind: 'absent' } : { kind: 'unchanged', stamp: doc.stamp },
  ));

  /** True when it's fine to drop the current buffer. */
  const confirmDiscard = async (): Promise<boolean> => {
    if (!dirty()) return true;
    const choice = await prompter.unsavedChanges(displayName(doc.path));
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    return saveNow();
  };

  const reloadNow = async (): Promise<void> => {
    if (doc.path === null) return;
    try {
      const file = await platform.fs.read(doc.path);
      const { text, format } = decode(file.text);
      const saved = editor.replace(text);
      doc = { ...doc, format, saved, stamp: file.stamp };
      refreshTitle();
    } catch (e) {
      prompter.notify(`Could not reload ${displayName(doc.path)}: ${describeError(e)}`);
    }
  };

  const checkDiskNow = async (): Promise<void> => {
    if (doc.path === null) return;
    let observed: FileStamp | null;
    try {
      observed = await platform.fs.stat(doc.path);
    } catch {
      return; // transient I/O error: say nothing rather than guess
    }
    switch (decideExternalChange({ known: doc.stamp, observed, dirty: dirty() })) {
      case 'unchanged':
        return;
      case 'reload':
        return reloadNow();
      case 'deleted':
        doc = { ...doc, saved: null, stamp: null };
        refreshTitle();
        prompter.notify(`${displayName(doc.path)} was deleted or moved. Save to keep it.`);
        return;
      case 'ask':
        if ((await prompter.changedOnDisk(displayName(doc.path))) === 'reload') return reloadNow();
        // Keep ours: remember what we saw so we don't ask again; the next save overwrites.
        doc = { ...doc, stamp: observed };
        return;
    }
  };

  return {
    start: (startup) =>
      serial(async () => {
        switch (startup.kind) {
          case 'file':
            adopt(startup.file);
            return;
          case 'new':
            editor.reset('', startup.path);
            doc = untitled(startup.path);
            break;
          case 'error':
            prompter.notify(`Could not open ${displayName(startup.error.path)}: ${describeError(startup.error)}`);
            break;
          case 'none':
            break;
        }
        refreshTitle();
      }),

    open: (path) =>
      serial(async () => {
        const target = path ?? (await platform.dialogs.pickOpen());
        if (target === null) return;
        let file: ReadResult;
        try {
          file = await platform.fs.read(target);
        } catch (e) {
          prompter.notify(`Could not open ${displayName(target)}: ${describeError(e)}`);
          return;
        }
        if (await confirmDiscard()) adopt(file);
      }),

    save: () => serial(saveNow),
    saveAs: () => serial(saveAsNow),

    newDocument: () =>
      serial(async () => {
        if (!(await confirmDiscard())) return;
        editor.reset('', null);
        doc = untitled();
        refreshTitle();
      }),

    requestClose: () => serial(confirmDiscard),
    checkDisk: () => serial(checkDiskNow),
    contentChanged: refreshTitle,
    info: () => ({ path: doc.path, dirty: dirty(), eol: EOL_NAMES[doc.format.eol] ?? 'LF' }),
  };
}
