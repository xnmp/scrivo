import { Text } from '@codemirror/state';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { displayName, documentDir, isDirty, sameStamp, windowTitle } from './document';

const doc = (s: string) => Text.of(s.split('\n'));

describe('isDirty', () => {
  it('is clean when the content matches what is on disk', () => {
    const saved = doc('hello\nworld');
    expect(isDirty(saved, saved)).toBe(false);
    expect(isDirty(saved, doc('hello\nworld'))).toBe(false);
  });

  it('is dirty after any change, including same-length edits', () => {
    expect(isDirty(doc('abc'), doc('abd'))).toBe(true);
    expect(isDirty(doc('abc'), doc('abc '))).toBe(true);
    expect(isDirty(doc('a\nb'), doc('a b'))).toBe(true);
  });

  it('with nothing on disk, is dirty exactly when there is content', () => {
    expect(isDirty(null, doc(''))).toBe(false);
    expect(isDirty(null, doc(' '))).toBe(true);
  });

  it('agrees with string comparison', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(isDirty(doc(a), doc(b))).toBe(a !== b);
      }),
    );
  });
});

describe('sameStamp', () => {
  it('compares both mtime and size', () => {
    expect(sameStamp({ mtimeMs: 1.5, size: 3 }, { mtimeMs: 1.5, size: 3 })).toBe(true);
    expect(sameStamp({ mtimeMs: 1.5, size: 3, changeMs: 2 }, { mtimeMs: 1.5, size: 3, changeMs: 3 })).toBe(false);
    expect(sameStamp({ mtimeMs: 1.5, size: 3 }, { mtimeMs: 1.5, size: 4 })).toBe(false);
    expect(sameStamp({ mtimeMs: 1.5, size: 3 }, { mtimeMs: 1.25, size: 3 })).toBe(false);
  });

  it('treats a missing stamp as equal only to another missing stamp', () => {
    expect(sameStamp(null, null)).toBe(true);
    expect(sameStamp(null, { mtimeMs: 0, size: 0 })).toBe(false);
    expect(sameStamp({ mtimeMs: 0, size: 0 }, null)).toBe(false);
  });
});

describe('displayName and windowTitle', () => {
  it.each([
    [null, 'Untitled'],
    ['/home/me/notes.md', 'notes.md'],
    ['C:\\Users\\me\\notes.md', 'notes.md'],
    ['notes.md', 'notes.md'],
    ['/weird/dir/', '/weird/dir/'],
  ])('%s → %s', (path, name) => {
    expect(displayName(path)).toBe(name);
  });

  it('marks unsaved changes in the title', () => {
    expect(windowTitle('/a/b.md', false)).toBe('b.md — Scrivo');
    expect(windowTitle('/a/b.md', true)).toBe('b.md • — Scrivo');
    expect(windowTitle(null, true)).toBe('Untitled • — Scrivo');
  });
});

describe('documentDir', () => {
  it.each([
    [null, null],
    ['/home/me/notes.md', '/home/me'],
    ['/notes.md', '/'],
    ['C:\\Users\\me\\notes.md', 'C:\\Users\\me'],
    ['C:\\notes.md', 'C:'],
    ['\\\\server\\share\\notes.md', '\\\\server\\share'],
    ['notes.md', null],
  ])('%s → %s', (path, dir) => {
    expect(documentDir(path)).toBe(dir);
  });
});
