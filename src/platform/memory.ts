// In-memory Platform: backs unit tests, the browser dev build and the Playwright suite.
// It mimics the Tauri adapter's contract, including stamp-based conflict detection.
import type { FileStamp } from '../domain/document';
import { FileError, type Platform, type StartupDocument } from '../app/ports';

interface Entry {
  readonly text: string;
  readonly stamp: FileStamp;
}

export interface MemoryPlatform extends Platform {
  /** Test/driver API — not part of the Platform port. */
  readonly disk: {
    get(path: string): string | undefined;
    /** Simulate another program writing the file. */
    put(path: string, text: string): void;
    remove(path: string): void;
    /** The next write rejects with this error. */
    failNextWrite(error: FileError): void;
    /**
     * Writes wait for `gate` either before the bytes land or after they land but before
     * the write resolves (the real adapter's IPC reply lag). For race tests.
     */
    setWriteGate(gate: (() => Promise<void>) | null, phase?: 'before-landing' | 'after-landing'): void;
    readonly writes: ReadonlyArray<{ path: string; text: string }>;
  };
  readonly dialogAnswers: { open: Array<string | null>; save: Array<string | null> };
  readonly titles: string[];
  /** Simulate the user closing the window; resolves whether it closed. */
  requestClose(): Promise<boolean>;
  focus(): void;
  readonly destroyed: boolean;
}

export function createMemoryPlatform(options: {
  files?: Record<string, string>;
  /** Path opened at startup, as if passed on the command line. */
  startupPath?: string;
} = {}): MemoryPlatform {
  let clock = 1_000;
  const files = new Map<string, Entry>();
  const stampFor = (text: string): FileStamp => ({ mtimeMs: (clock += 1), size: new TextEncoder().encode(text).length });
  for (const [path, text] of Object.entries(options.files ?? {})) files.set(path, { text, stamp: stampFor(text) });

  const writes: Array<{ path: string; text: string }> = [];
  let pendingFailure: FileError | null = null;
  let writeGate: (() => Promise<void>) | null = null;
  let gatePhase: 'before-landing' | 'after-landing' = 'before-landing';
  const titles: string[] = [];
  const dialogAnswers = { open: [] as Array<string | null>, save: [] as Array<string | null> };
  let closeHandler: (() => Promise<boolean>) | null = null;
  const focusHandlers: Array<() => void> = [];
  let destroyed = false;

  const read = async (path: string) => {
    const entry = files.get(path);
    if (!entry) throw new FileError('not-found', path);
    return { path, text: entry.text, stamp: entry.stamp };
  };

  const platform: MemoryPlatform = {
    fs: {
      read,
      async write(path, text, expected) {
        if (writeGate && gatePhase === 'before-landing') await writeGate();
        if (pendingFailure) {
          const error = pendingFailure;
          pendingFailure = null;
          throw error;
        }
        const current = files.get(path);
        if (expected !== null) {
          const same = current && current.stamp.mtimeMs === expected.mtimeMs && current.stamp.size === expected.size;
          if (!same) throw new FileError('conflict', path);
        }
        const entry = { text, stamp: stampFor(text) };
        files.set(path, entry);
        writes.push({ path, text });
        if (writeGate && gatePhase === 'after-landing') await writeGate();
        return entry.stamp;
      },
      async stat(path) {
        return files.get(path)?.stamp ?? null;
      },
    },
    dialogs: {
      async pickOpen() {
        return dialogAnswers.open.shift() ?? null;
      },
      async pickSave() {
        return dialogAnswers.save.shift() ?? null;
      },
    },
    window: {
      setTitle: (title) => void titles.push(title),
      onCloseRequested: (handler) => void (closeHandler = handler),
      onFocus: (handler) => void focusHandlers.push(handler),
      async destroy() {
        destroyed = true;
      },
    },
    async startupDocument(): Promise<StartupDocument> {
      const path = options.startupPath;
      if (path === undefined) return { kind: 'none' };
      try {
        return { kind: 'file', file: await read(path) };
      } catch {
        return { kind: 'new', path };
      }
    },
    disk: {
      get: (path) => files.get(path)?.text,
      put: (path, text) => void files.set(path, { text, stamp: stampFor(text) }),
      remove: (path) => void files.delete(path),
      failNextWrite: (error) => void (pendingFailure = error),
      setWriteGate: (gate, phase = 'before-landing') => {
        writeGate = gate;
        gatePhase = phase;
      },
      writes,
    },
    dialogAnswers,
    titles,
    async requestClose() {
      const ok = closeHandler ? await closeHandler() : true;
      if (ok) destroyed = true;
      return ok;
    },
    focus: () => focusHandlers.forEach((h) => h()),
    get destroyed() {
      return destroyed;
    },
  };
  return platform;
}
