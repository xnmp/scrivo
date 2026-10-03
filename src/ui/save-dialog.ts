import '../styles/save-dialog.css';
import { saveLocation, suggestedLocation } from '../domain/save-location';
import { dismissDialogOnEscape } from './dialog-escape';

/** Native modal focus trap; selection resolves a path, never writes a file. */
export function pickSaveLocation(suggestedPath: string, home: string, validate?: (path: string) => Promise<void>): Promise<string | null> {
  return new Promise(resolve => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.createElement('dialog'); dialog.className = 'save-dialog'; dialog.setAttribute('aria-label', 'Save document');
    const form = document.createElement('form');
    const title = document.createElement('h2'); title.textContent = 'Save document';
    const help = document.createElement('p'); help.textContent = 'Choose a filename and folder for your Markdown document.';
    const initial = suggestedLocation(suggestedPath, home);
    const field = (label: string, value: string) => {
      const wrap = document.createElement('label'); wrap.textContent = label;
      const input = document.createElement('input'); input.type = 'text'; input.value = value; input.required = true; input.spellcheck = false;
      wrap.append(input); return { wrap, input };
    };
    const name = field('File name', initial.name), folder = field('Folder', initial.folder);
    const status = document.createElement('p'); status.className = 'save-dialog-error'; status.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save'; save.className = 'primary';
    let path: string | null = null;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async event => {
      event.preventDefault(); const result = saveLocation(folder.input.value, name.input.value, /^(?:[A-Za-z]:|\\\\)/.test(home));
      if ('error' in result) { status.textContent = result.error; return; }
      if (save.disabled) return;
      save.disabled = true;
      try {
        await validate?.(result.path);
        if (dialog.isConnected) { path = result.path; dialog.close(); }
      } catch (error) {
        if (dialog.isConnected) status.textContent = `Could not use this location: ${error instanceof Error ? error.message : String(error)}`;
      } finally { save.disabled = false; }
    });
    dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus(); resolve(path); }, { once: true });
    dismissDialogOnEscape(dialog);
    actions.append(cancel, save); form.append(title, help, name.wrap, folder.wrap, status, actions); dialog.append(form);
    document.body.append(dialog); dialog.showModal(); name.input.focus(); name.input.select();
  });
}
