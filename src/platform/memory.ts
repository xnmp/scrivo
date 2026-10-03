// In-memory Platform: backs unit tests, the browser dev build and the Playwright suite.
// It mimics the Tauri adapter's contract, including stamp-based conflict detection.
import { sameStamp, type FileStamp } from '../domain/document';
import { displayName, documentDir } from '../domain/document';
import { collisionName, safeAttachmentName } from '../domain/attachment';
import { FileError, type Heading, type Platform, type RecoveryCopy, type StartupDocument, type ViewDocument } from '../app/ports';

/** Markdown → HTML, as the backend's renderer does it. */
export type RenderFn = (text: string, path: string | null) => Promise<{ html: string; chunkEnds?: readonly number[]; headings: readonly Heading[] }>;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Stand-in renderer for unit tests: one paragraph per non-blank line, `# ` lines as
 * headings. Enough to observe what was rendered and where lines map.
 */
export const fakeRender: RenderFn = async (text) => {
  const headings: Heading[] = [];
  const html = text
    .split('\n')
    .map((line, i) => {
      const m = /^(#{1,6}) (.*)$/.exec(line);
      if (m) {
        const id = m[2]!.toLowerCase().replace(/\s+/g, '-');
        headings.push({ level: m[1]!.length, text: m[2]!, id, line: i + 1 });
        return `<h${m[1]!.length} id="${id}" data-line="${i + 1}">${escapeHtml(m[2]!)}</h${m[1]!.length}>`;
      }
      return line.trim() ? `<p data-line="${i + 1}">${escapeHtml(line)}</p>` : '';
    })
    .join('');
  return { html, headings };
};

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
    /** Simulate a filesystem notification for a path after changing the fake disk. */
    notify(path: string): void;
    /** The next write rejects with this error. */
    failNextWrite(error: FileError): void;
    /**
     * Writes wait for `gate` either before the bytes land or after they land but before
     * the write resolves (the real adapter's IPC reply lag). For race tests.
     */
    setWriteGate(gate: (() => Promise<void>) | null, phase?: 'before-landing' | 'after-landing'): void;
    readonly writes: ReadonlyArray<{ path: string; text: string }>;
    getBytes(path: string): Uint8Array | undefined;
    putBytes(path: string, bytes: Uint8Array): void;
    failNextAttachmentImport(error: FileError): void;
  };
  readonly dialogAnswers: { open: Array<string | null>; save: Array<string | null> };
  readonly titles: string[];
  /** What was handed to the shell: `url:<url>` or `reveal:<path>`. */
  readonly opened: string[];
  /** Simulate the user closing the window; resolves whether it closed. */
  requestClose(): Promise<boolean>;
  focus(): void;
  dropPaths(paths: readonly string[], position?: { readonly x: number; readonly y: number }): Promise<void>;
  watchedPath(): string | null;
  watchedPaths(): ReadonlyMap<string, string>;
  readonly destroyed: boolean;
}

export function createMemoryPlatform(options: {
  files?: Record<string, string>;
  /** Path opened at startup, as if passed on the command line. */
  startupPath?: string;
  /** Start in the editor even for an existing file (the `--edit` flag). */
  startInEditor?: boolean;
  render?: RenderFn;
  pickSave?: (suggestedPath: string) => Promise<string | null>;
} = {}): MemoryPlatform {
  const renderFn = options.render ?? fakeRender;
  let clock = 1_000;
  const files = new Map<string, Entry>();
  const binary = new Map<string, { bytes: Uint8Array; stamp: FileStamp }>();
  const stampFor = (): FileStamp => String(++clock);
  for (const [path, text] of Object.entries(options.files ?? {})) files.set(path, { text, stamp: stampFor() });

  const writes: Array<{ path: string; text: string }> = [];
  let pendingFailure: FileError | null = null;
  let pendingImportFailure: FileError | null = null;
  let writeGate: (() => Promise<void>) | null = null;
  let gatePhase: 'before-landing' | 'after-landing' = 'before-landing';
  const titles: string[] = [];
  const opened: string[] = [];
  const copies = new Map<string, RecoveryCopy>();
  const dialogAnswers = { open: [] as Array<string | null>, save: [] as Array<string | null> };
  let closeHandler: (() => Promise<boolean>) | null = null;
  const focusHandlers: Array<() => void> = [];
  let dropHandler: ((drop: { paths: readonly string[]; position: { x: number; y: number } }) => Promise<void>) | null = null;
  let destroyed = false;
  const watched = new Map<string, { path: string; onChange: () => void }>();

  const read = async (path: string) => {
    const entry = files.get(path);
    if (!entry) throw new FileError('not-found', path);
    return { path, text: entry.text, stamp: entry.stamp };
  };

  const renderText = async (text: string, path: string | null): Promise<ViewDocument> => ({
    path,
    stamp: null,
    ...(await renderFn(text, path)),
  });
  const renderFile = async (path: string): Promise<ViewDocument> => {
    const file = await read(path);
    return { ...(await renderText(file.text, path)), stamp: file.stamp };
  };

  const platform: MemoryPlatform = {
    attachments: {
      async importBytes(documentPath, requested, mimeType, bytes) {
        if (pendingImportFailure) {
          const error = pendingImportFailure;
          pendingImportFailure = null;
          throw error;
        }
        if (!files.has(documentPath)) throw new FileError('not-found', documentPath);
        const dir = documentDir(documentPath)!;
        const slash = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
        const base = safeAttachmentName(requested, mimeType);
        for (let attempt = 0; attempt < 10_000; attempt++) {
          const fileName = collisionName(base, attempt);
          const path = `${dir}${slash}assets${slash}${fileName}`;
          if (binary.has(path) || files.has(path)) continue;
          const stamp = stampFor();
          binary.set(path, { bytes: bytes.slice(), stamp });
          return { fileName, stamp };
        }
        throw new FileError('io', requested, 'Too many attachments with the same name');
      },
      async importPath(documentPath, sourcePath) {
        const source = binary.get(sourcePath);
        if (!source) throw new FileError('not-found', sourcePath);
        return this.importBytes(documentPath, displayName(sourcePath), '', source.bytes);
      },
      async rollback(documentPath, imported) {
        const dir = documentDir(documentPath)!;
        const slash = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
        const path = `${dir}${slash}assets${slash}${imported.fileName}`;
        if (binary.get(path)?.stamp !== imported.stamp) throw new FileError('conflict', path);
        binary.delete(path);
      },
    },
    recovery: {
      list: async () => [...copies.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      put: async (copy) => void copies.set(copy.id, copy),
      remove: async (id) => void copies.delete(id),
    },
    fs: {
      read,
      async write(path, text, condition) {
        if (writeGate && gatePhase === 'before-landing') await writeGate();
        if (pendingFailure) {
          const error = pendingFailure;
          pendingFailure = null;
          throw error;
        }
        const current = files.get(path);
        if (condition.kind === 'absent' && current) throw new FileError('conflict', path);
        if (condition.kind === 'unchanged' && (!current || !sameStamp(current.stamp, condition.stamp))) {
          throw new FileError('conflict', path);
        }
        const entry = { text, stamp: stampFor() };
        files.set(path, entry);
        writes.push({ path, text });
        if (writeGate && gatePhase === 'after-landing') await writeGate();
        return entry.stamp;
      },
      async stat(path) {
        return files.get(path)?.stamp ?? null;
      },
      identity: async (path) => path,
      async watch(path, onChange, subscription = 'main') {
        if (path === null) watched.delete(subscription);
        else watched.set(subscription, { path, onChange });
      },
    },
    dialogs: {
      async pickOpen() {
        return dialogAnswers.open.shift() ?? null;
      },
      async pickSave(suggestedPath) {
        if (dialogAnswers.save.length) return dialogAnswers.save.shift()!;
        return options.pickSave?.(suggestedPath) ?? null;
      },
    },
    window: {
      async minimize() {}, async toggleMaximize() {}, async startDragging() {},
      async close() { if (!closeHandler || await closeHandler()) destroyed = true; },
      setTitle: (title) => void titles.push(title),
      async onCloseRequested(handler) { closeHandler = handler; },
      onFocus: (handler) => void focusHandlers.push(handler),
      async onFilesDropped(handler) { dropHandler = handler; },
      async destroy() {
        destroyed = true;
      },
    },
    render: {
      async startupView() {
        const path = options.startupPath;
        if (path === undefined || options.startInEditor || !files.has(path)) return { kind: 'edit' };
        return { kind: 'view', document: await renderFile(path) };
      },
      renderFile,
      renderText,
    },
    shell: {
      async openUrl(url) {
        opened.push(`url:${url}`);
      },
      async revealFile(path) {
        opened.push(`reveal:${path}`);
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
      put: (path, text) => void files.set(path, { text, stamp: stampFor() }),
      remove: (path) => void files.delete(path),
      notify: (path) => {
        for (const watcher of [...watched.values()]) {
          if (watcher.path === path) watcher.onChange();
        }
      },
      failNextWrite: (error) => void (pendingFailure = error),
      setWriteGate: (gate, phase = 'before-landing') => {
        writeGate = gate;
        gatePhase = phase;
      },
      writes,
      getBytes: (path) => binary.get(path)?.bytes.slice(),
      putBytes: (path, bytes) => void binary.set(path, { bytes: bytes.slice(), stamp: stampFor() }),
      failNextAttachmentImport: (error) => void (pendingImportFailure = error),
    },
    dialogAnswers,
    titles,
    opened,
    async requestClose() {
      const ok = closeHandler ? await closeHandler() : true;
      if (ok) destroyed = true;
      return ok;
    },
    focus: () => focusHandlers.forEach((h) => h()),
    dropPaths: (paths, position = { x: 0, y: 0 }) => dropHandler?.({ paths, position }) ?? Promise.resolve(),
    watchedPath: () => watched.get('main')?.path ?? null,
    watchedPaths: () => new Map([...watched].map(([id, watcher]) => [id, watcher.path])),
    get destroyed() {
      return destroyed;
    },
  };
  return platform;
}
