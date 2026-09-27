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
import { attachmentLink } from '../domain/attachment';
import { decode, encode } from '../domain/text-format';
import {
  FileError,
  type EditorPort,
  type ImportedAttachment,
  type Platform,
  type Prompter,
  type ReadResult,
  type RecoveryCopy,
  type StartupDocument,
  type WriteCondition,
} from './ports';

export interface DocumentInfo {
  readonly path: string | null;
  readonly dirty: boolean;
  readonly eol: string;
  readonly saveStatus: SaveStatus;
}

export type SaveStatus =
  | { readonly kind: 'saved' | 'edited' | 'saving' }
  | { readonly kind: 'action-needed'; readonly reason: string };

export type AttachmentRequest =
  | { readonly kind: 'bytes'; readonly name: string; readonly mimeType: string; readonly read: () => Promise<Uint8Array> }
  | { readonly kind: 'path'; readonly path: string };

export type ImportOutcome = 'imported' | 'cancelled' | 'failed';

export interface DocumentController {
  start(startup: StartupDocument): Promise<void>;
  /** True when a file was opened, including when its recovery prompt restored another document. */
  open(path?: string): Promise<boolean>;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  /** Import assets, then insert their links in one editor transaction. */
  importAttachments(sources: readonly AttachmentRequest[], insert: (markdown: string) => boolean): Promise<ImportOutcome>;
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
  readonly onSaveStatus?: (status: SaveStatus) => void;
}): DocumentController {
  const { platform, prompter, editor } = deps;
  const serial = serialQueue();
  const recoverySerial = serialQueue();

  let doc: DocumentState<S> = untitled();
  let shownTitle = '';
  let saveStatus: SaveStatus = { kind: 'saved' };
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let autosavePending = 0;
  let generation = 0;
  let applyingDocument = false;
  let ignoredExternalStamp: FileStamp | null | undefined;
  let recoveryId: string = crypto.randomUUID();
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryWritten = false;
  let firstRecoveryPendingId: string | null = null;
  let contentVersion = 0;
  let recoveredNeedsSave = false;
  let recoveryChecked = false;

  const setStatus = (status: SaveStatus) => {
    saveStatus = status;
    deps.onSaveStatus?.(status);
  };
  const cancelAutosave = () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
  };
  const cancelRecoveryTimer = () => {
    clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
  };

  const dirty = (): boolean => recoveredNeedsSave || isDirty(doc.saved, editor.snapshot());

  const removeRecovery = (id = recoveryId, reprotectIfDirty = false) => recoverySerial(async () => {
    try {
      await platform.recovery.remove(id);
      if (id === recoveryId) {
        recoveryWritten = false;
        // A fresh edit may have arrived while this clean-document removal was
        // in flight. Give it a first checkpoint immediately.
        if (reprotectIfDirty && dirty()) scheduleRecovery();
      }
    } catch (error) {
      prompter.notify(`Could not remove a recovery copy: ${describeError(error)}`);
    }
  });

  const persistRecovery = () => {
    const version = contentVersion;
    const copy: RecoveryCopy = {
      id: recoveryId, path: doc.path, stamp: doc.stamp, format: doc.format,
      text: editor.toText(editor.snapshot()), updatedAt: Date.now(),
    };
    return recoverySerial(async () => {
      // A queued write belongs to the document/version that scheduled it. A
      // later save, discard, or document switch must not recreate a stale copy.
      if (copy.id !== recoveryId || !dirty()) return;
      try {
        await platform.recovery.put(copy);
        if (copy.id === recoveryId) recoveryWritten = true;
      } catch (error) {
        const message = `Could not protect unsaved changes: ${describeError(error)}`;
        prompter.notify(message);
        if (doc.path === null) setStatus({ kind: 'action-needed', reason: message });
      }
      if (contentVersion !== version && dirty()) scheduleRecovery();
    });
  };

  const scheduleRecovery = () => {
    if (!dirty()) return;
    if (!recoveryWritten && firstRecoveryPendingId !== recoveryId) {
      const id = recoveryId;
      firstRecoveryPendingId = id;
      void persistRecovery().finally(() => {
        if (firstRecoveryPendingId === id) firstRecoveryPendingId = null;
      });
      return;
    }
    if (recoveryTimer) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (dirty()) void persistRecovery();
    }, 500);
  };

  const offerRecovery = async () => {
    let copies: readonly RecoveryCopy[];
    try {
      copies = await platform.recovery.list();
    } catch (error) {
      prompter.notify(`Could not check recovery copies: ${describeError(error)}`);
      return;
    }
    const includeUnmatched = !recoveryChecked;
    recoveryChecked = true;
    const candidates = includeUnmatched
      ? [...copies.filter((copy) => copy.path === doc.path), ...copies.filter((copy) => copy.path !== doc.path)]
      : copies.filter((copy) => copy.path === doc.path);
    for (const copy of candidates) {
      if (copy.path === doc.path && copy.text === editor.toText(editor.snapshot()) && copy.stamp === doc.stamp) {
        await removeRecovery(copy.id);
        continue;
      }
      let observed: FileStamp | null = null;
      if (copy.path !== null) {
        try { observed = await platform.fs.stat(copy.path); }
        catch { observed = null; }
      }
      const changed = copy.path !== null && observed !== copy.stamp;
      const choice = await prompter.recover(displayName(copy.path), changed);
      if (choice === 'cancel') return;
      if (choice === 'dismiss') {
        await removeRecovery(copy.id);
        continue;
      }
      cancelAutosave();
      cancelRecoveryTimer();
      applyingDocument = true;
      editor.reset(copy.text, copy.path);
      applyingDocument = false;
      doc = { path: copy.path, format: copy.format, saved: null, stamp: copy.stamp };
      recoveredNeedsSave = true;
      recoveryId = copy.id;
      recoveryWritten = true;
      ignoredExternalStamp = changed ? observed : undefined;
      refreshTitle();
      setStatus(changed
        ? { kind: 'action-needed', reason: `${displayName(copy.path)} changed on disk` }
        : { kind: 'edited' });
      if (!changed) scheduleAutosave();
      return;
    }
  };

  const updateStatus = () => {
    if (saveStatus.kind !== 'action-needed' && saveStatus.kind !== 'saving') {
      setStatus({ kind: dirty() ? 'edited' : 'saved' });
    }
  };

  const scheduleAutosave = () => {
    cancelAutosave();
    if (doc.path === null || !dirty() || saveStatus.kind === 'action-needed') return;
    const expectedGeneration = generation;
    autosaveTimer = setTimeout(() => {
      autosaveTimer = undefined;
      autosavePending++;
      void serial(async () => {
        try {
          if (generation !== expectedGeneration || doc.path === null || !dirty() || saveStatus.kind === 'action-needed') return;
          await writeTo(doc.path, doc.stamp === null ? { kind: 'absent' } : { kind: 'unchanged', stamp: doc.stamp }, false);
        } finally {
          autosavePending--;
          if (!autosaveTimer && autosavePending === 0 && saveStatus.kind !== 'action-needed' && dirty()) scheduleAutosave();
        }
      });
    }, 2000);
  };

  const refreshTitle = () => {
    const title = windowTitle(doc.path, dirty());
    if (title !== shownTitle) {
      shownTitle = title;
      platform.window.setTitle(title);
    }
  };

  const adopt = (file: ReadResult) => {
    const { text, format } = decode(file.text);
    cancelAutosave();
    cancelRecoveryTimer();
    generation++;
    recoveryId = crypto.randomUUID();
    recoveryWritten = false;
    applyingDocument = true;
    const saved = editor.reset(text, file.path);
    applyingDocument = false;
    doc = { path: file.path, format, saved, stamp: file.stamp };
    recoveredNeedsSave = false;
    ignoredExternalStamp = undefined;
    if (format.mixedEol) {
      prompter.notify(`${displayName(file.path)} mixes line endings; saving will use ${EOL_NAMES[format.eol]}.`);
    }
    refreshTitle();
    setStatus({ kind: 'saved' });
  };

  const writeTo = async (path: string, condition: WriteCondition, interactive = true): Promise<boolean> => {
    // The snapshot we send is what's on disk afterwards; edits made while the write is
    // in flight must stay dirty.
    const snapshot = editor.snapshot();
    const text = encode(editor.toText(snapshot), doc.format);
    setStatus({ kind: 'saving' });
    try {
      const stamp = await platform.fs.write(path, text, condition);
      const moved = path !== doc.path;
      doc = { path, format: { ...doc.format, mixedEol: false }, saved: snapshot, stamp };
      recoveredNeedsSave = false;
      ignoredExternalStamp = undefined;
      if (moved) editor.setDocumentPath(path);
      refreshTitle();
      setStatus({ kind: dirty() ? 'edited' : 'saved' });
      if (dirty()) {
        if (!autosaveTimer && autosavePending === 0) scheduleAutosave();
        scheduleRecovery();
      } else {
        cancelRecoveryTimer();
        await removeRecovery(recoveryId, true);
      }
      return true;
    } catch (e) {
      if (e instanceof FileError && e.code === 'conflict') {
        setStatus({ kind: 'action-needed', reason: `${displayName(path)} changed on disk` });
        if (!interactive) return false;
        let observed: FileStamp | null;
        try { observed = await platform.fs.stat(path); }
        catch (error) {
          prompter.notify(`Could not check ${displayName(path)} before overwrite: ${describeError(error)}`);
          return false;
        }
        const choice = await prompter.saveConflict(displayName(path));
        if (choice === 'overwrite') return writeTo(path, observed === null
          ? { kind: 'absent' } : { kind: 'unchanged', stamp: observed });
        if (choice === 'save-as') return saveAsNow();
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
      const message = `Could not save ${displayName(path)}: ${describeError(e)}`;
      setStatus({ kind: 'action-needed', reason: message });
      prompter.notify(message);
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

  const saveNow = (): Promise<boolean> => {
    cancelAutosave();
    return doc.path === null ? saveAsNow() : writeTo(
      doc.path,
      doc.stamp === null ? { kind: 'absent' } : { kind: 'unchanged', stamp: doc.stamp },
    );
  };

  /** True when it's fine to drop the current buffer. */
  const confirmDiscard = async (): Promise<boolean> => {
    cancelAutosave();
    cancelRecoveryTimer();
    if (!dirty()) return true;
    const choice = await prompter.unsavedChanges(displayName(doc.path));
    if (choice === 'cancel') { scheduleAutosave(); scheduleRecovery(); return false; }
    if (choice === 'discard') { await removeRecovery(); return true; }
    const saved = await saveNow();
    if (!saved || dirty()) {
      scheduleAutosave();
      scheduleRecovery();
      return false;
    }
    return true;
  };

  const reloadNow = async (): Promise<void> => {
    if (doc.path === null) return;
    try {
      const before = editor.snapshot();
      const version = contentVersion;
      const file = await platform.fs.read(doc.path);
      const current = editor.snapshot();
      if (contentVersion !== version || (current !== before && !current.eq(before))) {
        cancelAutosave();
        setStatus({ kind: 'action-needed', reason: `${displayName(doc.path)} changed on disk` });
        await persistRecovery();
        return;
      }
      const { text, format } = decode(file.text);
      cancelAutosave();
      cancelRecoveryTimer();
      generation++;
      applyingDocument = true;
      const saved = editor.replace(text);
      applyingDocument = false;
      doc = { ...doc, format, saved, stamp: file.stamp };
      recoveredNeedsSave = false;
      ignoredExternalStamp = undefined;
      refreshTitle();
      setStatus({ kind: 'saved' });
      await removeRecovery();
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
        recoveredNeedsSave = true;
        refreshTitle();
        cancelAutosave();
        setStatus({ kind: 'action-needed', reason: `${displayName(doc.path)} was deleted or moved` });
        if (dirty()) await persistRecovery();
        prompter.notify(`${displayName(doc.path)} was deleted or moved. Save to keep it.`);
        return;
      case 'ask':
        if (observed === ignoredExternalStamp) return;
        await persistRecovery();
        if ((await prompter.changedOnDisk(displayName(doc.path))) === 'reload') return reloadNow();
        // Retain the old stamp so a later manual save still needs explicit consent.
        ignoredExternalStamp = observed;
        cancelAutosave();
        setStatus({ kind: 'action-needed', reason: `${displayName(doc.path)} changed on disk` });
        return;
    }
  };

  const importAttachmentsNow = async (
    sources: readonly AttachmentRequest[], insert: (markdown: string) => boolean,
  ): Promise<ImportOutcome> => {
    if (sources.length === 0) return 'cancelled';
    // An untitled or not-yet-created file needs a real folder before assets can
    // be placed next to it. This uses the same conditional save path as Ctrl+S.
    if ((doc.path === null || doc.stamp === null) && !(await saveNow())) {
      return saveStatus.kind === 'action-needed' ? 'failed' : 'cancelled';
    }
    const documentPath = doc.path!;
    const imported: ImportedAttachment[] = [];
    try {
      const links: string[] = [];
      for (const source of sources) {
        const result = source.kind === 'path'
          ? await platform.attachments.importPath(documentPath, source.path)
          : await platform.attachments.importBytes(documentPath, source.name, source.mimeType, await source.read());
        imported.push(result);
        links.push(attachmentLink(result.fileName, source.kind === 'bytes' ? source.mimeType : ''));
      }
      if (!insert(links.join('\n'))) throw new Error('the insertion point is no longer available');
      return 'imported';
    } catch (error) {
      for (const result of imported.reverse()) {
        try { await platform.attachments.rollback(documentPath, result); }
        catch (rollbackError) { prompter.notify(`Could not remove an incomplete attachment: ${describeError(rollbackError)}`); }
      }
      prompter.notify(`Could not import attachment: ${describeError(error)}`);
      return 'failed';
    }
  };

  return {
    start: (startup) =>
      serial(async () => {
        switch (startup.kind) {
          case 'file':
            adopt(startup.file);
            await offerRecovery();
            return;
          case 'new':
            recoveryId = crypto.randomUUID();
            recoveryWritten = false;
            editor.reset('', startup.path);
            doc = untitled(startup.path);
            recoveredNeedsSave = false;
            setStatus({ kind: 'saved' });
            break;
          case 'error':
            prompter.notify(`Could not open ${displayName(startup.error.path)}: ${describeError(startup.error)}`);
            break;
          case 'none':
            break;
        }
        refreshTitle();
        await offerRecovery();
      }),

    open: (path) =>
      serial(async () => {
        const target = path ?? (await platform.dialogs.pickOpen());
        if (target === null) return false;
        let file: ReadResult;
        try {
          file = await platform.fs.read(target);
        } catch (e) {
          prompter.notify(`Could not open ${displayName(target)}: ${describeError(e)}`);
          return false;
        }
        if (!(await confirmDiscard())) return false;
        adopt(file);
        await offerRecovery();
        return true;
      }),

    save: () => serial(saveNow),
    saveAs: () => serial(saveAsNow),
    importAttachments: (sources, insert) => {
      const requestedGeneration = generation;
      return serial(() => requestedGeneration === generation
        ? importAttachmentsNow(sources, insert) : Promise.resolve('cancelled' as const));
    },

    newDocument: () =>
      serial(async () => {
        if (!(await confirmDiscard())) return;
        generation++;
        recoveryId = crypto.randomUUID();
        recoveryWritten = false;
        editor.reset('', null);
        doc = untitled();
        recoveredNeedsSave = false;
        refreshTitle();
        setStatus({ kind: 'saved' });
      }),

    requestClose: () => serial(confirmDiscard),
    checkDisk: () => serial(checkDiskNow),
    contentChanged: () => {
      if (applyingDocument) return;
      refreshTitle();
      updateStatus();
      contentVersion++;
      scheduleAutosave();
      if (dirty()) scheduleRecovery();
      else {
        cancelRecoveryTimer();
        if (saveStatus.kind !== 'saving' && saveStatus.kind !== 'action-needed') void removeRecovery(recoveryId, true);
      }
    },
    info: () => ({ path: doc.path, dirty: dirty(), eol: EOL_NAMES[doc.format.eol] ?? 'LF', saveStatus }),
  };
}
