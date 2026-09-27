// In-memory Platform: backs unit tests, the browser dev build and the Playwright suite.
// It mimics the Tauri adapter's contract, including stamp-based conflict detection.
import { sameStamp, type FileStamp } from '../domain/document';
import { FileError, type Heading, type Platform, type StartupDocument, type ViewDocument } from '../app/ports';

/** Markdown → HTML, as the backend's renderer does it. */
export type RenderFn = (text: string, path: string | null) => Promise<{ html: string; headings: readonly Heading[] }>;

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
  };
  readonly dialogAnswers: { open: Array<string | null>; save: Array<string | null> };
  readonly titles: string[];
  /** What was handed to the shell: `url:<url>` or `reveal:<path>`. */
  readonly opened: string[];
  /** Simulate the user closing the window; resolves whether it closed. */
  requestClose(): Promise<boolean>;
  focus(): void;
  readonly destroyed: boolean;
}

export function createMemoryPlatform(options: {
  files?: Record<string, string>;
  /** Path opened at startup, as if passed on the command line. */
  startupPath?: string;
  /** Start in the editor even for an existing file (the `--edit` flag). */
  startInEditor?: boolean;
  render?: RenderFn;
} = {}): MemoryPlatform {
  const renderFn = options.render ?? fakeRender;
  let clock = 1_000;
  const files = new Map<string, Entry>();
  const stampFor = (text: string): FileStamp => ({ mtimeMs: (clock += 1), changeMs: clock, size: new TextEncoder().encode(text).length });
  for (const [path, text] of Object.entries(options.files ?? {})) files.set(path, { text, stamp: stampFor(text) });

  const writes: Array<{ path: string; text: string }> = [];
  let pendingFailure: FileError | null = null;
  let writeGate: (() => Promise<void>) | null = null;
  let gatePhase: 'before-landing' | 'after-landing' = 'before-landing';
  const titles: string[] = [];
  const opened: string[] = [];
  const dialogAnswers = { open: [] as Array<string | null>, save: [] as Array<string | null> };
  let closeHandler: (() => Promise<boolean>) | null = null;
  const focusHandlers: Array<() => void> = [];
  let destroyed = false;
  let watched: { path: string; onChange: () => void } | null = null;

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
        const entry = { text, stamp: stampFor(text) };
        files.set(path, entry);
        writes.push({ path, text });
        if (writeGate && gatePhase === 'after-landing') await writeGate();
        return entry.stamp;
      },
      async stat(path) {
        return files.get(path)?.stamp ?? null;
      },
      async watch(path, onChange) {
        watched = path === null ? null : { path, onChange };
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
      put: (path, text) => void files.set(path, { text, stamp: stampFor(text) }),
      remove: (path) => void files.delete(path),
      notify: (path) => { if (watched?.path === path) watched.onChange(); },
      failNextWrite: (error) => void (pendingFailure = error),
      setWriteGate: (gate, phase = 'before-landing') => {
        writeGate = gate;
        gatePhase = phase;
      },
      writes,
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
    get destroyed() {
      return destroyed;
    },
  };
  return platform;
}
