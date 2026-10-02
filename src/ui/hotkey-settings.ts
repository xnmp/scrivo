import { bindings, commands, conflict, displayChord, eventChord, validChord } from '../domain/commands';
import type { createCommandPreferences } from '../platform/command-preferences';
export function createHotkeySettings(store: ReturnType<typeof createCommandPreferences>, mac: boolean) {
  const dialog = document.createElement('dialog'); dialog.className = 'hotkeys-dialog'; dialog.setAttribute('aria-label', 'Hotkeys');
  const heading = document.createElement('h2'); heading.textContent = 'Hotkeys';
  const close = document.createElement('button'); close.textContent = 'Close'; close.className = 'appearance-close'; close.addEventListener('click', () => dialog.close());
  const help = document.createElement('p'); help.textContent = 'Choose a command, then press a shortcut. Standard text editing shortcuts follow your operating system.';
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search commands…'; search.setAttribute('aria-label', 'Search hotkeys');
  const list = document.createElement('div'); list.className = 'hotkey-list';
  const notice = document.createElement('p'); notice.setAttribute('role', 'status');
  const reset = document.createElement('button'); reset.textContent = 'Restore default hotkeys';
  const save = (next: Parameters<typeof store.setHotkeys>[0]) => {
    notice.textContent = store.setHotkeys(next) ? '' : 'Changed for this window. Could not save hotkeys for the next launch.'; render();
  };
  let recording: string | null = null, previous: HTMLElement | null = null;
  const render = () => {
    list.replaceChildren(...commands.filter(command => `${command.group} ${command.label}`.toLowerCase().includes(search.value.toLowerCase())).map(command => {
      const row = document.createElement('div'); row.className = 'hotkey-row';
      const label = document.createElement('span'); label.textContent = command.label;
      const keys = document.createElement('div'); keys.className = 'hotkey-bindings';
      bindings(command, store.hotkeys()).forEach(key => {
        const remove = document.createElement('button'); remove.className = 'hotkey-chip'; remove.textContent = `${displayChord(key, mac)} ×`;
        remove.setAttribute('aria-label', `Remove ${displayChord(key, mac)} from ${command.label}`);
        remove.addEventListener('click', () => save({ ...store.hotkeys(), [command.id]: bindings(command, store.hotkeys()).filter(value => value !== key) })); keys.append(remove);
      });
      const add = document.createElement('button'); add.textContent = recording === command.id ? 'Press shortcut…' : '+';
      add.setAttribute('aria-label', `Add hotkey for ${command.label}`);
      add.disabled = bindings(command, store.hotkeys()).length >= 4;
      add.addEventListener('click', () => { recording = command.id; notice.textContent = 'Press a shortcut with Ctrl, ⌘, or Alt, or a function key. Esc cancels.'; render(); list.querySelector<HTMLButtonElement>(`[aria-label="${CSS.escape(add.getAttribute('aria-label')!)}"]`)?.focus(); });
      keys.append(add); row.append(label, keys); return row;
    }));
  };
  dialog.addEventListener('keydown', event => {
    if (!recording) return;
    event.preventDefault();
    if (event.key === 'Escape') { recording = null; notice.textContent = ''; render(); return; }
    const chord = eventChord(event, mac); if (!validChord(chord)) return;
    const other = conflict(recording, chord, store.hotkeys(), mac);
    if (other) { notice.textContent = `${displayChord(chord, mac)} is assigned to “${other.label}”. Remove that binding first.`; return; }
    const command = commands.find(command => command.id === recording)!;
    const next = [...new Set([...bindings(command, store.hotkeys()), chord])]; recording = null;
    save({ ...store.hotkeys(), [command.id]: next });
  });
  search.addEventListener('input', () => { recording = null; render(); });
  reset.addEventListener('click', () => { recording = null; save({}); });
  dialog.addEventListener('close', () => { recording = null; previous?.isConnected && previous.focus(); });
  dialog.append(heading, close, help, search, list, reset, notice); document.body.append(dialog);
  store.subscribe(() => { if (dialog.open) render(); });
  return { open() { previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; if (!dialog.open) dialog.showModal(); render(); search.focus(); } };
}
