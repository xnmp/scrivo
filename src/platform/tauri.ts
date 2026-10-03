// Platform over Tauri. The only module that imports @tauri-apps/*.
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { FileStamp } from '../domain/document';
import {
  FileError,
  type FileErrorCode,
  type ImportedAttachment,
  type Platform,
  type ReadResult,
  type RecoveryCopy,
  type StartupDocument,
  type StartupView,
  type ViewDocument,
} from '../app/ports';

interface CommandError {
  code: FileErrorCode;
  message: string;
}

const isCommandError = (e: unknown): e is CommandError =>
  typeof e === 'object' && e !== null && 'code' in e && typeof (e as CommandError).code === 'string';

const toFileError = (path: string, e: unknown) =>
  isCommandError(e) ? new FileError(e.code, path, e.message) : new FileError('io', path, String(e));

async function call<T>(cmd: string, path: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toFileError(path, e);
  }
}

type RawStartup =
  | { kind: 'none' }
  | { kind: 'file'; file: ReadResult }
  | { kind: 'new'; path: string }
  | { kind: 'error'; path: string; code: FileErrorCode; message: string };

type RawStartupPreview =
  | { kind: 'view'; document: ViewDocument; hasTail: boolean }
  | { kind: 'edit' };

const MARKDOWN_FILTER = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'txt'] },
  { name: 'All files', extensions: ['*'] },
];

declare global {
  interface Window {
    __SCRIVO_TRACE__?: boolean;
  }
}

export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

/** Startup timing marks (printed by the backend when SCRIVO_TRACE=1). */
export function traceMark(label: string): void {
  if (window.__SCRIVO_TRACE__) void invoke('trace_mark', { label });
}

export const fileUrl = (path: string): string => convertFileSrc(path);

export function createTauriPlatform(): Platform {
  // The window API (~15 KB with its dependencies) isn't needed for first paint: the
  // backend sets the initial title. Load it on first use.
  let win: Promise<import('@tauri-apps/api/window').Window> | null = null;
  const currentWindow = () => (win ??= import('@tauri-apps/api/window').then((m) => m.getCurrentWindow()));
  let webview: Promise<import('@tauri-apps/api/webview').Webview> | null = null;
  const currentWebview = () => (webview ??= import('@tauri-apps/api/webview')
    .then(module => module.getCurrentWebview())
    .catch(error => { webview = null; throw error; }));
  const watched = new Map<string, { path: string; onChange: () => void }>();
  let watchListener: Promise<void> | null = null;
  const ensureWatchListener = () => (watchListener ??= import('@tauri-apps/api/event')
    .then(({ listen }) => listen<{ subscription: string; path: string }>('document-changed', ({ payload }) => {
      const watcher = watched.get(payload.subscription);
      if (watcher?.path === payload.path) watcher.onChange();
    }))
    .then(() => undefined)
    .catch((error) => {
      watchListener = null;
      throw error;
    }));
  return {
    recovery: {
      list: () => invoke<RecoveryCopy[]>('list_recovery'),
      put: (copy) => invoke<void>('put_recovery', { copy }),
      remove: (id) => invoke<void>('remove_recovery', { id }),
    },
    fs: {
      read: (path) => call<ReadResult>('read_document', path, { path }),
      write: (path, text, condition) => call<FileStamp>('write_document', path, { path, text, condition }),
      stat: (path) => call<FileStamp | null>('stat_document', path, { path }),
      identity: (path) => call<string>('document_identity', path, { path }),
      async watch(path, onChange, subscription = 'main') {
        if (path !== null) await ensureWatchListener();
        const prior = watched.get(subscription);
        if (path === null) watched.delete(subscription);
        else watched.set(subscription, { path, onChange });
        try {
          await call<void>('watch_document', path ?? '', { path, subscription });
        } catch (error) {
          if (prior) watched.set(subscription, prior);
          else watched.delete(subscription);
          throw error;
        }
      },
    },
    attachments: {
      async importBytes(documentPath, name, mimeType, bytes) {
        try {
          return await invoke<ImportedAttachment>('import_attachment_bytes', bytes, { headers: {
            'x-document-path': encodeURIComponent(documentPath),
            'x-file-name': encodeURIComponent(name),
            'x-mime-type': encodeURIComponent(mimeType),
          } });
        } catch (error) {
          throw toFileError(name, error);
        }
      },
      importPath: (documentPath, sourcePath) => call<ImportedAttachment>('import_attachment_path', sourcePath, { document: documentPath, source: sourcePath }),
      rollback: (documentPath, imported) => call<void>('rollback_attachment', imported.fileName, { document: documentPath, imported }),
    },
    dialogs: {
      async pickOpen() {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const picked = await open({ multiple: false, directory: false, filters: MARKDOWN_FILTER });
        return typeof picked === 'string' ? picked : null;
      },
      async pickSave(suggestedPath) {
        const [{ homeDir }, { pickSaveLocation }] = await Promise.all([
          import('@tauri-apps/api/path'), import('../ui/save-dialog'),
        ]);
        return pickSaveLocation(suggestedPath, await homeDir(), async path => {
          await call<string>('document_identity', path, { path });
          await call<FileStamp | null>('stat_document', path, { path });
        });
      },
    },
    window: {
      setZoom: scale => currentWebview().then(view => view.setZoom(scale)),
      minimize: () => currentWindow().then(w => w.minimize()),
      toggleMaximize: () => currentWindow().then(w => w.toggleMaximize()),
      startDragging: () => currentWindow().then(w => w.startDragging()),
      close: () => currentWindow().then(w => w.close()),
      setTitle: (title) => void currentWindow().then((w) => w.setTitle(title)),
      onCloseRequested: (handler) =>
        currentWindow().then((w) =>
          w.onCloseRequested(async (event) => {
            if (!(await handler())) event.preventDefault();
          }),
        ).then(() => undefined),
      onFocus: (handler) =>
        void currentWindow().then((w) =>
          w.onFocusChanged(({ payload: focused }) => {
            if (focused) handler();
          }),
        ),
      onFilesDropped: (handler) => import('./tauri-drop').then((module) => module.onFilesDropped(handler)),
      destroy: () => currentWindow().then((w) => w.destroy()),
    },
    render: {
      async startupView() {
        const preview = await invoke<RawStartupPreview>('startup_preview');
        if (preview.kind === 'edit' || !preview.hasTail) return preview;
        return { kind: 'view', document: preview.document, loadTail: async () => {
          const full = await invoke<StartupView>('startup_view');
          if (full.kind !== 'view') throw new Error('startup tail is missing');
          return full.document;
        } };
      },
      renderFile: (path) => call<ViewDocument>('render_file', path, { path }),
      renderText: (text, path) => call<ViewDocument>('render_markdown', path ?? '', { text, path }),
    },
    shell: {
      async openUrl(url) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      },
      async revealFile(path) {
        const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
        await revealItemInDir(path);
      },
    },
    async startupDocument(): Promise<StartupDocument> {
      const raw = await invoke<RawStartup>('startup_document');
      if (raw.kind === 'error') return { kind: 'error', error: new FileError(raw.code, raw.path, raw.message) };
      return raw;
    },
  };
}
