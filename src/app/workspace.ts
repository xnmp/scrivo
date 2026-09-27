// One document window with two surfaces: the reading view and the editor.
//
// The window opens in the reading view. The backend renders the document while the
// webview boots, so there is something to read before any editor code has loaded.
// The editor loads on first use; from then on it owns the document (dirty state,
// saving, conflicts) and the reading view shows the editor's current text.
import { displayName, documentDir, sameStamp, windowTitle } from '../domain/document';
import { linkAction } from '../domain/links';
import type { DocumentController } from './controller';
import { describeError } from './errors';
import type { Platform, ViewDocument } from './ports';

export type Position = { readonly line: number } | { readonly anchor: string };

/** The reading view, as the workspace sees it. */
export interface ViewerPort {
  /** Resolves once the document is on screen (long documents keep loading after). */
  show(doc: ViewDocument, at?: Position, loadTail?: () => Promise<ViewDocument>): Promise<void>;
  /** Stop background work for a document that will no longer be shown. */
  suspend(): void;
  /** 1-based source line of the block at the top of the viewport. */
  topLine(): number;
  /** Scroll to this id, or queue it while the startup tail loads. */
  scrollToAnchor(id: string): boolean;
}

/** The editor, once loaded. */
export interface EditorHandle {
  readonly controller: DocumentController;
  text(): string;
  /** 1-based line at the top of the viewport. */
  topLine(): number;
  /** Scroll so `line` is at the top and put the caret there. */
  revealLine(line: number): void;
  focus(): void;
}

export type Mode = 'view' | 'edit';

export interface Workspace {
  /** Show the startup document (reading view) or start the editor. */
  start(): Promise<void>;
  mode(): Mode;
  toggle(): Promise<void>;
  /** Switch to the editor, at `line` or where the reading view is scrolled. */
  edit(line?: number): Promise<void>;
  view(): Promise<void>;
  /** Open a file (from a dialog when `path` is omitted) in the current mode. */
  open(path?: string): Promise<void>;
  newDocument(): Promise<void>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  followLink(href: string): Promise<void>;
  /** Pick up changes made by other programs (on window focus, file watch events). */
  checkDisk(): Promise<void>;
  /** Resolves true when the window may close. */
  requestClose(): Promise<boolean>;
}

export interface WorkspaceDeps {
  readonly platform: Platform;
  readonly viewer: ViewerPort;
  /** Loads and creates the editor; called at most once. */
  readonly loadEditor: () => Promise<EditorHandle>;
  /** Make the given surface the visible one. */
  readonly showSurface: (mode: Mode) => void;
  /** Give the reader a measurable, nonvisible viewport while replacing the editor. */
  readonly prepareView: () => () => void;
  readonly notify: (message: string) => void;
  /** Schedule nonessential startup work after the first view has painted. */
  readonly scheduleIdle?: (run: () => void) => void;
  /** Called when the current document path changes, including at startup. */
  readonly onPathChanged?: (path: string | null) => void;
}

const serialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(op: () => Promise<T>): Promise<T> => {
    const result = tail.then(op);
    tail = result.catch(() => undefined);
    return result;
  };
};

export function createWorkspace(deps: WorkspaceDeps): Workspace {
  const { platform, viewer, showSurface, notify } = deps;
  const enqueue = serialQueue();

  let mode: Mode = 'view';
  /** What the reading view shows. */
  let shown: ViewDocument | null = null;
  /** The editor's text when the reading view was last rendered from it. */
  let shownText: string | null = null;
  let editor: EditorHandle | null = null;
  let loading: Promise<EditorHandle> | null = null;
  let reportedPath: string | null | undefined;

  const serial = <T>(op: () => Promise<T>): Promise<T> => enqueue(async () => {
    try {
      return await op();
    } finally {
      const path = editor ? editor.controller.info().path : shown?.path ?? null;
      if (path !== reportedPath) {
        reportedPath = path;
        deps.onPathChanged?.(path);
      }
    }
  });

  const ensureEditor = (): Promise<EditorHandle> => {
    loading ??= deps.loadEditor();
    // A failed load (e.g. a chunk that won't import) may be retried later.
    loading.catch(() => (loading = null));
    return loading;
  };

  const setMode = (next: Mode) => {
    mode = next;
    showSurface(next);
  };

  const display = async (doc: ViewDocument, at?: Position, loadTail?: () => Promise<ViewDocument>) => {
    const titleChanged = doc.path !== shown?.path;
    shown = doc;
    await viewer.show(doc, at, loadTail);
    // Once the editor exists its controller owns the title (it tracks dirtiness).
    if (!editor && titleChanged) platform.window.setTitle(windowTitle(doc.path, false));
  };

  const renderEditorSnapshot = async (e: EditorHandle) => {
    const text = e.text();
    const document = await platform.render.renderText(text, e.controller.info().path);
    return { text, document };
  };

  /** Re-render the reading view from the editor's buffer. */
  const renderEditor = async (e: EditorHandle, at?: Position): Promise<boolean> => {
    try {
      const snapshot = await renderEditorSnapshot(e);
      await display(snapshot.document, at);
      shownText = snapshot.text;
      return true;
    } catch (err) {
      notify(`Could not show the document: ${describeError(err)}`);
      return false;
    }
  };

  const openInViewer = async (path: string, at?: Position): Promise<boolean> => {
    try {
      await display(await platform.render.renderFile(path), at);
      return true;
    } catch (err) {
      notify(`Could not open ${displayName(path)}: ${describeError(err)}`);
      return false;
    }
  };

  const editNow = async (line?: number) => {
    if (mode === 'edit') return;
    const target = line ?? viewer.topLine();
    let e: EditorHandle;
    try {
      e = await ensureEditor();
    } catch (err) {
      notify(`Could not load the editor: ${describeError(err)}`);
      return;
    }
    const path = shown?.path ?? null;
    if (path !== null && e.controller.info().path !== path) {
      // Opening can restore a recovery copy for a different file. A successful
      // open must surface that buffer even when its path differs from the reader.
      if (!(await e.controller.open(path))) return;
    }
    editor = e;
    setMode('edit');
    e.revealLine(target);
    e.focus();
  };

  const viewNow = async () => {
    if (mode === 'view' || !editor) return;
    // The editor stays usable while rendering. If its text changes across an
    // await, render the newer snapshot before handing the surface over.
    for (;;) {
      let snapshot: Awaited<ReturnType<typeof renderEditorSnapshot>>;
      try {
        snapshot = await renderEditorSnapshot(editor);
      } catch (err) {
        notify(`Could not show the document: ${describeError(err)}`);
        return;
      }
      if (editor.text() !== snapshot.text) continue;
      const releaseView = deps.prepareView();
      try {
        await display(snapshot.document, { line: editor.topLine() });
        if (editor.text() !== snapshot.text) {
          viewer.suspend();
          continue;
        }
        shownText = snapshot.text;
        setMode('view');
        return;
      } catch (err) {
        notify(`Could not show the document: ${describeError(err)}`);
        return;
      } finally {
        releaseView();
      }
    }
  };

  const openNow = async (path?: string, anchor?: string | null) => {
    const at = anchor ? { anchor } : undefined;
    if (editor) {
      const opened = await editor.controller.open(path);
      // A matching recovery can replace the buffer without changing its path.
      // Keep the reader in sync with the controller after every successful open.
      if (mode === 'view' && opened && !(await renderEditor(editor, at))) {
        // The new buffer is already owned by the controller. If rendering it
        // fails, show that editor rather than an obsolete reading view.
        setMode('edit');
        editor.focus();
      }
      return;
    }
    const target = path ?? (await platform.dialogs.pickOpen());
    if (target === null) return;
    if (target === shown?.path) {
      if (at) viewer.scrollToAnchor(at.anchor);
      return;
    }
    await openInViewer(target, at);
  };

  const checkDiskNow = async () => {
    if (editor) {
      await editor.controller.checkDisk();
      if (mode === 'view' && editor.text() !== shownText) await renderEditor(editor, { line: viewer.topLine() });
      return;
    }
    const path = shown?.path;
    if (!path || !shown) return;
    let stamp;
    try {
      stamp = await platform.fs.stat(path);
    } catch {
      return; // can't tell; keep showing what we have
    }
    if (stamp === null) {
      if (shown.stamp !== null) {
        notify(`${displayName(path)} was deleted or moved; showing the last version.`);
        shown = { ...shown, stamp: null };
      }
      return;
    }
    if (!sameStamp(stamp, shown.stamp)) await openInViewer(path, { line: viewer.topLine() });
  };

  return {
    start: () =>
      serial(async () => {
        const startup = await platform.render.startupView().catch(() => ({ kind: 'edit' }) as const);
        if (startup.kind === 'view') {
          await display(startup.document, undefined, startup.loadTail);
          setMode('view');
          const path = startup.document.path;
          if (path !== null) deps.scheduleIdle?.(() => {
            void platform.recovery.list().then((copies) => {
              if (mode === 'view' && shown?.path === path && copies.length > 0) {
                void serial(() => editNow());
              }
            }).catch((error) => notify(`Could not check recovery copies: ${describeError(error)}`));
          });
          return;
        }
        const e = await ensureEditor();
        await e.controller.start(await platform.startupDocument());
        editor = e;
        setMode('edit');
        e.focus();
      }),
    mode: () => mode,
    toggle: () => serial(() => (mode === 'view' ? editNow() : viewNow())),
    edit: (line) => serial(() => editNow(line)),
    view: () => serial(viewNow),
    open: (path) => serial(() => openNow(path)),
    newDocument: () =>
      serial(async () => {
        const e = await ensureEditor();
        await e.controller.newDocument();
        if (e.controller.info().path === null && !e.controller.info().dirty) {
          editor = e;
          setMode('edit');
          e.focus();
        }
      }),
    save: () =>
      serial(async () => {
        if (editor) await editor.controller.save();
      }),
    saveAs: () =>
      serial(async () => {
        if (editor) await editor.controller.saveAs();
      }),
    followLink: (href) =>
      serial(async () => {
        const action = linkAction(href, documentDir(shown?.path ?? editor?.controller.info().path ?? null));
        switch (action.kind) {
          case 'anchor':
            viewer.scrollToAnchor(action.id);
            return;
          case 'document':
            return openNow(action.path, action.anchor);
          case 'external':
            return platform.shell.openUrl(action.url).catch((err) => notify(`Could not open the link: ${describeError(err)}`));
          case 'reveal':
            return platform.shell
              .revealFile(action.path)
              .catch((err) => notify(`Could not show ${displayName(action.path)}: ${describeError(err)}`));
          case 'none':
            return;
        }
      }),
    checkDisk: () => serial(checkDiskNow),
    requestClose: () => serial(async () => (editor ? editor.controller.requestClose() : true)),
  };
}
