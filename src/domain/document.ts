import type { TextFormat } from './text-format';
import { DEFAULT_FORMAT } from './text-format';

/** What we last observed about a file on disk. */
export interface FileStamp {
  /** Modification time in milliseconds since the epoch, with sub-millisecond precision. */
  readonly mtimeMs: number;
  readonly size: number;
  /** Unix metadata change time; catches edits that restore mtime. */
  readonly changeMs?: number | null;
}

export const sameStamp = (a: FileStamp | null, b: FileStamp | null): boolean =>
  a === b || (a !== null && b !== null && a.mtimeMs === b.mtimeMs && a.size === b.size
    && (a.changeMs ?? null) === (b.changeMs ?? null));

/**
 * An immutable document snapshot. CodeMirror's `Text` satisfies this structurally,
 * which lets dirty-checking compare persistent ropes instead of serialising strings.
 */
export interface Snapshot {
  readonly length: number;
  eq(other: this): boolean;
}

export interface DocumentState<S extends Snapshot> {
  /** Absolute path, or null for a document that has never been saved. */
  readonly path: string | null;
  readonly format: TextFormat;
  /** Content as it exists on disk; null when nothing is on disk (untitled or deleted). */
  readonly saved: S | null;
  /** Disk stamp from our last read or write; null when the file isn't on disk. */
  readonly stamp: FileStamp | null;
}

export const untitled = <S extends Snapshot>(path: string | null = null): DocumentState<S> => ({
  path,
  format: DEFAULT_FORMAT,
  saved: null,
  stamp: null,
});

/** Unsaved changes exist. With nothing on disk, any content counts as unsaved. */
export function isDirty<S extends Snapshot>(saved: S | null, current: S): boolean {
  if (saved === null) return current.length > 0;
  if (current === saved) return false;
  return current.length !== saved.length || !current.eq(saved);
}

export function displayName(path: string | null): string {
  if (path === null) return 'Untitled';
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function windowTitle(path: string | null, dirty: boolean): string {
  return `${displayName(path)}${dirty ? ' •' : ''} — Scrivo`;
}

/** Directory containing the document, used to resolve relative links and images. */
export function documentDir(path: string | null): string | null {
  if (path === null) return null;
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i < 0 ? null : path.slice(0, i) || path.slice(0, 1);
}
