// DOM implementation of the Prompter port: modal questions and transient notices.
import type { ConflictChoice, Prompter, UnsavedChoice } from '../app/ports';

interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly kind?: 'primary' | 'danger';
}

/** Show a modal and resolve with the chosen value. Escape resolves with `cancel`. */
export function ask<T extends string>(host: HTMLElement, title: string, message: string, choices: Choice<T>[], cancel: T): Promise<T> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2');
    heading.id = `modal-title-${Date.now()}`;
    heading.textContent = title;
    dialog.setAttribute('aria-labelledby', heading.id);
    const body = document.createElement('p');
    body.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const finish = (value: T) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
      resolve(value);
    };
    const buttons = choices.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.label;
      b.dataset.choice = c.value;
      if (c.kind) b.className = c.kind;
      b.addEventListener('click', () => finish(c.value));
      actions.appendChild(b);
      return b;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(cancel);
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
        e.preventDefault();
        next?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    dialog.append(heading, body, actions);
    backdrop.appendChild(dialog);
    host.appendChild(backdrop);
    (buttons.find((b) => b.classList.contains('primary')) ?? buttons[0])?.focus();
  });
}

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
        'A file at this path changed or already exists. Overwrite it with yours, or load its contents and discard yours?',
        [
          { value: 'reload', label: 'Load Theirs', kind: 'danger' },
          { value: 'cancel', label: 'Cancel' },
          { value: 'overwrite', label: 'Overwrite', kind: 'primary' },
        ],
        'cancel',
      ),
    changedOnDisk: (name) =>
      ask<'reload' | 'keep'>(
        host,
        `${name} changed on disk`,
        'You also have unsaved changes. Keep yours (saving will overwrite the file), or reload and discard them?',
        [
          { value: 'reload', label: 'Reload', kind: 'danger' },
          { value: 'keep', label: 'Keep Mine', kind: 'primary' },
        ],
        'keep',
      ),
    notify(message) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      stack.appendChild(toast);
      setTimeout(() => toast.remove(), 6000);
    },
  };
}
