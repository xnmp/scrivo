import { sameStamp, type FileStamp } from './document';

/**
 * What to do after observing the file on disk (e.g. when the window regains focus).
 *
 * - `unchanged`: disk matches our last read/write.
 * - `reload`:    someone else changed it and we have no unsaved edits — take theirs.
 * - `ask`:       both sides changed; the user decides.
 * - `deleted`:   it's gone; keep the buffer and treat it as unsaved.
 *
 * Callers must discard an observation that overlapped one of our own writes
 * (see DocumentController), otherwise our own save looks like an external change.
 */
export type ExternalDecision = 'unchanged' | 'reload' | 'ask' | 'deleted';

export function decideExternalChange(input: {
  readonly known: FileStamp | null;
  readonly observed: FileStamp | null;
  readonly dirty: boolean;
}): ExternalDecision {
  const { known, observed, dirty } = input;
  if (known === null) return 'unchanged'; // never on disk from our point of view
  if (observed === null) return 'deleted';
  if (sameStamp(known, observed)) return 'unchanged';
  return dirty ? 'ask' : 'reload';
}
