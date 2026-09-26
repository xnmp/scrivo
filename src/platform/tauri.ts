// Platform over Tauri. The only module that imports @tauri-apps/*.
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { FileStamp } from '../domain/document';
import { FileError, type FileErrorCode, type Platform, type ReadResult, type StartupDocument } from '../app/ports';

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
  const win = getCurrentWindow();
  return {
    fs: {
      read: (path) => call<ReadResult>('read_document', path, { path }),
      write: (path, text, expected) => call<FileStamp>('write_document', path, { path, text, expected }),
      stat: (path) => call<FileStamp | null>('stat_document', path, { path }),
    },
    dialogs: {
      async pickOpen() {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const picked = await open({ multiple: false, directory: false, filters: MARKDOWN_FILTER });
        return typeof picked === 'string' ? picked : null;
      },
      async pickSave(suggestedPath) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        return (await save({ defaultPath: suggestedPath, filters: MARKDOWN_FILTER })) ?? null;
      },
    },
    window: {
      setTitle: (title) => void win.setTitle(title),
      onCloseRequested: (handler) =>
        void win.onCloseRequested(async (event) => {
          if (!(await handler())) event.preventDefault();
        }),
      onFocus: (handler) =>
        void win.onFocusChanged(({ payload: focused }) => {
          if (focused) handler();
        }),
      destroy: () => win.destroy(),
    },
    async startupDocument(): Promise<StartupDocument> {
      const raw = await invoke<RawStartup>('startup_document');
      if (raw.kind === 'error') return { kind: 'error', error: new FileError(raw.code, raw.path, raw.message) };
      return raw;
    },
  };
}
