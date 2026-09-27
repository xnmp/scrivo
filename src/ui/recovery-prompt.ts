import { ask } from './dialog';

export const askRecovery = (host: HTMLElement, name: string, changedOnDisk: boolean) =>
  ask<'restore' | 'dismiss' | 'cancel'>(
    host,
    `Recover edits to ${name}?`,
    changedOnDisk
      ? 'A recovery copy exists, and the file on disk has changed. Restoring keeps the newer file untouched until you resolve the conflict.'
      : 'A recovery copy of unsaved edits was found. Restore it in the editor or discard the copy?',
    [
      { value: 'dismiss', label: 'Discard Recovery', kind: 'danger' },
      { value: 'restore', label: 'Restore Edits', kind: 'primary' },
    ],
    'cancel',
  );
