import { searchScore } from '../domain/search';
import { dismissDialogOnEscape } from './dialog-escape';
export interface PickerItem { readonly id: string; readonly label: string; readonly detail?: string; readonly hint?: string; readonly run: () => void }
/** Searchable modal shared by commands and recent files. */
export function createCommandPicker() {
  const dialog = document.createElement('dialog'); dialog.className = 'command-picker';
  const heading = document.createElement('h2'); heading.id = 'picker-title'; dialog.setAttribute('aria-labelledby', heading.id);
  const input = document.createElement('input'); input.type = 'search'; input.autocomplete = 'off'; input.maxLength = 128;
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'true');
  const list = document.createElement('div'); list.id = 'picker-list'; list.setAttribute('role', 'listbox'); input.setAttribute('aria-controls', list.id);
  const empty = document.createElement('p'); empty.className = 'picker-empty'; empty.setAttribute('role', 'status');
  const footer = document.createElement('div'); footer.className = 'picker-footer';
  const navigation = document.createElement('span'); navigation.textContent = '↑ ↓ to navigate · Enter to open · Esc to close';
  const action = document.createElement('button'); action.hidden = true; footer.append(navigation, action);
  const close = document.createElement('button'); close.className = 'picker-close'; close.textContent = 'Close'; close.addEventListener('click', () => dialog.close());
  dialog.append(heading, input, list, empty, footer, close); document.body.append(dialog);
  let all: readonly PickerItem[] = [], shown: readonly PickerItem[] = [], selected = 0, previous: HTMLElement | null = null, chosen: PickerItem | null = null;
  const choose = (item: PickerItem) => { chosen = item; dialog.close(); };
  const select = (index: number) => {
    selected = index;
    [...list.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === selected)));
    const current = list.children[selected];
    if (current) { input.setAttribute('aria-activedescendant', current.id); current.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    shown = all.map(item => ({ item, score: searchScore(input.value, `${item.label} ${item.detail ?? ''}`) }))
      .filter((entry): entry is { item: PickerItem; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score).map(entry => entry.item);
    list.replaceChildren(...shown.map((item, i) => {
      const row = document.createElement('div'); row.id = `picker-option-${i}`; row.setAttribute('role', 'option');
      row.className = 'picker-option';
      const text = document.createElement('div'), label = document.createElement('span'); label.textContent = item.label; text.append(label);
      if (item.detail) { const detail = document.createElement('small'); detail.textContent = item.detail; text.append(detail); }
      const hint = document.createElement('kbd'); hint.textContent = item.hint ?? ''; row.append(text, hint);
      row.addEventListener('click', () => choose(item)); return row;
    }));
    empty.textContent = shown.length ? '' : all.length ? 'No matches.' : 'No recent files yet. Open a Markdown file to add it here.';
    select(0);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (shown.length) select((selected + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (event.key === 'Enter') { event.preventDefault(); if (shown[selected]) choose(shown[selected]!); }
  });
  dialog.addEventListener('close', () => { const item = chosen; chosen = null; if (previous?.isConnected) previous.focus(); item?.run(); });
  dismissDialogOnEscape(dialog);
  return { open(title: string, items: readonly PickerItem[], footerAction?: { readonly label: string; readonly run: () => void }) {
    if (!dialog.open) previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    action.hidden = !footerAction; action.textContent = footerAction?.label ?? ''; action.onclick = footerAction ? footerAction.run : null;
    all = items; heading.textContent = title; input.setAttribute('aria-label', title === 'Command palette' ? 'Search commands' : 'Search recent files');
    input.placeholder = title === 'Command palette' ? 'Type a command…' : 'Find a recent file…'; input.value = '';
    if (!dialog.open) dialog.showModal(); render(); input.focus();
  } };
}
