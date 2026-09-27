// DOM implementation of the Prompter port. Modal code loads only when needed.
import type { ConflictChoice, Prompter, UnsavedChoice } from '../app/ports';
import type { Choice } from './dialog';

const ask = async <T extends string>(host: HTMLElement, title: string, message: string, choices: Choice<T>[], cancel: T) =>
  (await import('./dialog')).ask(host, title, message, choices, cancel);

export function createPrompter(host: HTMLElement): Prompter {
  const stack = document.createElement('div');
  stack.className = 'toast-stack';
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  host.appendChild(stack);

  return {
    unsavedChanges: (name) =>
      ask<UnsavedChoice>(
        host,
        `Save changes to ${name}?`,
        'Your changes will be lost if you don’t save them.',
        [
          { value: 'discard', label: 'Don’t Save', kind: 'danger' },
          { value: 'cancel', label: 'Cancel' },
          { value: 'save', label: 'Save', kind: 'primary' },
        ],
        'cancel',
      ),
    saveConflict: (name) =>
      ask<ConflictChoice>(
        host,
        `${name} conflicts with disk`,
        'A file at this path changed or already exists. Choose what to do with your edits.',
        [
          { value: 'reload', label: 'Load Theirs', kind: 'danger' },
          { value: 'cancel', label: 'Cancel' },
          { value: 'save-as', label: 'Save Elsewhere' },
          { value: 'overwrite', label: 'Overwrite', kind: 'primary' },
        ],
        'cancel',
      ),
    changedOnDisk: (name) =>
      ask<'reload' | 'keep'>(
        host,
        `${name} changed on disk`,
        'You also have unsaved changes. Keep yours and resolve before saving, or reload and discard them?',
        [
          { value: 'reload', label: 'Reload', kind: 'danger' },
          { value: 'keep', label: 'Keep Mine', kind: 'primary' },
        ],
        'keep',
      ),
    recover: async (name, changedOnDisk) => {
      const { askRecovery } = await import('./recovery-prompt');
      return askRecovery(host, name, changedOnDisk);
    },
    notify(message) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      stack.appendChild(toast);
      setTimeout(() => toast.remove(), 6000);
    },
  };
}
