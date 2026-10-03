import { bindings, commands, conflict, displayChord, eventChord, validChord } from '../domain/commands';
import type { createCommandPreferences } from '../platform/command-preferences';
import { icon } from './icons';
export function createHotkeySettings(host: HTMLElement, store: ReturnType<typeof createCommandPreferences>, mac: boolean) {
  const dialog = document.createElement('section'); dialog.className = 'hotkeys-dialog settings-page'; dialog.setAttribute('aria-label', 'Hotkeys');
  const heading = document.createElement('h2'); heading.textContent = 'Hotkeys';
  const help = document.createElement('p'); help.textContent = 'Choose a command, then press a shortcut. Standard text editing shortcuts follow your operating system.';
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search commands…'; search.setAttribute('aria-label', 'Search hotkeys');
  const list = document.createElement('div'); list.className = 'hotkey-list';
  const notice = document.createElement('p'); notice.setAttribute('role', 'status');
  const reset = document.createElement('button'); reset.textContent = 'Restore default hotkeys';
  const save = (next: Parameters<typeof store.setHotkeys>[0]) => {
    notice.textContent = store.setHotkeys(next) ? '' : 'Changed for this window. Could not save hotkeys for the next launch.'; render();
  };
  let recording: string | null = null;
  const render = () => {
    const visible = commands.filter(command => `${command.group} ${command.label}`.toLowerCase().includes(search.value.toLowerCase()));
    const groups = [...new Set(visible.map(command => command.group))];
    const rows: HTMLElement[] = [];
    let group = '';
    for (const command of groups.flatMap(group => visible.filter(command => command.group === group))) {
      if (group !== command.group) {
        group = command.group;
        const heading = document.createElement('h3'); heading.className = 'hotkey-group'; heading.textContent = group; rows.push(heading);
      }
      const row = document.createElement('div'); row.className = 'hotkey-row';
      const label = document.createElement('span'); label.textContent = command.label;
      const keys = document.createElement('div'); keys.className = 'hotkey-bindings';
      bindings(command, store.hotkeys(), mac).forEach(key => {
        const remove = document.createElement('button'); remove.className = 'hotkey-chip';
        const shortcut = document.createElement('kbd'); shortcut.textContent = displayChord(key, mac); remove.append(shortcut, icon('close'));
        remove.setAttribute('aria-label', `Remove ${displayChord(key, mac)} from ${command.label}`);
        remove.addEventListener('click', () => save({ ...store.hotkeys(), [command.id]: bindings(command, store.hotkeys(), mac).filter(value => value !== key) })); keys.append(remove);
      });
      const add = document.createElement('button'); add.className = 'hotkey-add';
      if (recording === command.id) { add.textContent = 'Press shortcut…'; add.classList.add('recording'); }
      else add.append(icon('plus'));
      add.setAttribute('aria-label', `Add hotkey for ${command.label}`);
      add.disabled = bindings(command, store.hotkeys(), mac).length >= 4;
      add.addEventListener('click', () => { recording = command.id; notice.textContent = 'Press a shortcut with Ctrl, ⌘, or Alt, or a function key. Esc cancels.'; render(); list.querySelector<HTMLButtonElement>(`[aria-label="${CSS.escape(add.getAttribute('aria-label')!)}"]`)?.focus(); });
      keys.append(add); row.append(label, keys); rows.push(row);
    }
    if (!visible.length) { const empty = document.createElement('p'); empty.textContent = 'No matching commands.'; rows.push(empty); }
    list.replaceChildren(...rows);
  };
  dialog.addEventListener('keydown', event => {
    if (!recording) return;
    event.preventDefault();
    if (event.key === 'Escape') { recording = null; notice.textContent = ''; render(); search.focus(); return; }
    const chord = eventChord(event, mac); if (!validChord(chord)) return;
    const other = conflict(recording, chord, store.hotkeys(), mac);
    if (other) { notice.textContent = `${displayChord(chord, mac)} is assigned to “${other.label}”. Remove that binding first.`; return; }
    const command = commands.find(command => command.id === recording)!;
    const next = [...new Set([...bindings(command, store.hotkeys(), mac), chord])]; recording = null;
    save({ ...store.hotkeys(), [command.id]: next });
  });
  search.addEventListener('input', () => { recording = null; render(); });
  reset.addEventListener('click', () => { recording = null; save({}); });
  dialog.append(heading, help, search, list, reset, notice); host.append(dialog);
  store.subscribe(() => { if (!dialog.hidden) render(); });
  return { panel: dialog, refresh: render, recording: () => recording !== null, cancelRecording() { recording = null; notice.textContent = ''; render(); } };
}
