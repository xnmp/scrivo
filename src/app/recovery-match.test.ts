import { expect, it } from 'vitest';
import { DEFAULT_FORMAT } from '../domain/text-format';
import type { RecoveryCopy } from './ports';
import { matchingRecoveryCopies } from './recovery-match';

const copy = (id: string, path: string | null): RecoveryCopy => ({
  id, path, stamp: null, format: DEFAULT_FORMAT, text: id, updatedAt: 1,
});

it('matches recovery copies through canonical file aliases', async () => {
  const identities = new Map([
    ['/link/note.md', '/real/note.md'],
    ['/real/note.md', '/real/note.md'],
    ['/real/other.md', '/real/other.md'],
  ]);
  const fs = { identity: async (path: string) => identities.get(path) ?? path };
  const copies = [copy('same', '/real/note.md'), copy('other', '/real/other.md'), copy('untitled', null)];
  expect((await matchingRecoveryCopies(fs, '/link/note.md', copies)).map((item) => item.id)).toEqual(['same']);
  expect((await matchingRecoveryCopies(fs, null, copies)).map((item) => item.id)).toEqual(['untitled']);
});

it('keeps an exact path match when identity lookup fails', async () => {
  const fs = { identity: async () => { throw new Error('transient I/O'); } };
  expect((await matchingRecoveryCopies(fs, '/notes/missing.md', [copy('same', '/notes/missing.md')]))
    .map((item) => item.id)).toEqual(['same']);
});
