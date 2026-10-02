import '../styles/chrome.css';
import type { WindowPort } from '../app/ports';
import { bindings, commands, displayChord } from '../domain/commands';
import { displayName } from '../domain/document';
import type { createCommandPreferences } from '../platform/command-preferences';
import { createAppearanceSettings } from './appearance-settings';
import { createAppMenu } from './app-menu';
import { createCommandPicker } from './command-picker';
import { createHotkeySettings } from './hotkey-settings';
import { icon, iconButton } from './icons';
export function createWindowChrome(header: HTMLElement, toolbar: HTMLElement, actions: {
  readonly window: WindowPort;
  readonly native: boolean;
  readonly mac: boolean;
  readonly preferences: ReturnType<typeof createCommandPreferences>;
  readonly execute: (id: string) => void;
  readonly notify: (message: string) => void;
}) {
  const { preferences, mac, execute } = actions;
  const hint = (id: string) => bindings(commands.find(command => command.id === id)!, preferences.hotkeys()).map(key => displayChord(key, mac)).join(' / ');
  const appearance = createAppearanceSettings(header, true), picker = createCommandPicker(), hotkeys = createHotkeySettings(preferences, mac);
  createAppMenu(header, execute, preferences.hotkeys, mac);
  const palette = iconButton('palette', 'Command palette', () => execute('palette'));
  header.insertBefore(palette, header.querySelector('.tab-list'));
  const report = (operation: Promise<void>) => { void operation.catch(error => actions.notify(String(error))); };
  const drag = document.createElement('div'); drag.className = 'window-drag'; drag.setAttribute('aria-hidden', 'true');
  if (actions.native) {
    drag.addEventListener('mousedown', event => { if (event.button === 0 && event.detail === 1) report(actions.window.startDragging()); });
    drag.addEventListener('dblclick', () => report(actions.window.toggleMaximize()));
  }
  header.append(drag);
  if (actions.native && !mac) {
    const controls = document.createElement('div'); controls.className = 'window-controls';
    controls.append(iconButton('minus', 'Minimize window', () => report(actions.window.minimize())),
      iconButton('maximize', 'Maximize or restore window', () => report(actions.window.toggleMaximize())),
      iconButton('close', 'Close window', () => report(actions.window.close())));
    header.append(controls);
  }
  const breadcrumb = document.createElement('span'); breadcrumb.className = 'document-breadcrumb';
  const mode = iconButton('edit', 'Toggle reading / editing', () => execute('reading'));
  mode.classList.add('mode-toggle'); toolbar.append(breadcrumb, mode);
  return {
    appearance, picker, hotkeys,
    updateDocument(path: string | null, editing: boolean) {
      breadcrumb.textContent = displayName(path).replace(/\.md$/i, ''); breadcrumb.title = path ?? 'Untitled';
      mode.replaceChildren(icon(editing ? 'read' : 'edit')); mode.title = `Toggle reading / editing (${hint('reading')})`;
    },
    refreshControls() {
      palette.title = `Command palette (${hint('palette')})`;
      header.querySelector<HTMLButtonElement>('.appearance-toggle')!.title = `Appearance (${hint('appearance')})`;
      header.querySelector<HTMLButtonElement>('.tab-add')!.title = `New tab (${hint('new')})`;
      mode.title = `Toggle reading / editing (${hint('reading')})`;
    },
  };
}
