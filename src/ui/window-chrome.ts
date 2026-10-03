import '../styles/chrome.css';
import type { WindowPort } from '../app/ports';
import { bindings, commands, displayChord } from '../domain/commands';
import type { createCommandPreferences } from '../platform/command-preferences';
import { appearanceStore } from '../platform/appearance';
import { builtinThemes } from './builtin-themes';
import { createCommandPicker } from './command-picker';
import type { SettingsSection } from './settings';
import { iconButton } from './icons';
export function createWindowChrome(header: HTMLElement, toolbar: HTMLElement, actions: {
  readonly window: WindowPort;
  readonly native: boolean;
  readonly mac: boolean;
  readonly preferences: ReturnType<typeof createCommandPreferences>;
  readonly notify: (message: string) => void;
}) {
  const { preferences, mac } = actions;
  // Reconcile packaged palette updates without constructing Settings forms.
  appearanceStore().registerBuiltins(builtinThemes);
  const hint = (id: string) => bindings(commands.find(command => command.id === id)!, preferences.hotkeys(), mac).map(key => displayChord(key, mac)).join(' / ');
  type Settings = ReturnType<typeof import('./settings').createSettings>;
  let settingsInstance: Settings | null = null;
  let settingsLoading: Promise<Settings> | null = null;
  const loadSettings = () => settingsLoading ??= import('./settings')
    .then(module => settingsInstance = module.createSettings(preferences, mac))
    .catch(error => { settingsLoading = null; throw error; });
  let pendingSettings: AbortController | null = null;
  const cancelPending = () => {
    const pending = pendingSettings;
    pending?.abort(); pendingSettings = null;
    return pending !== null;
  };
  const requestSettings = async (action: (instance: Settings) => void) => {
    cancelPending();
    const request = new AbortController(); pendingSettings = request;
    try {
      const instance = await loadSettings();
      if (!request.signal.aborted) action(instance);
    } catch (error) { if (!request.signal.aborted) throw error; }
    finally { if (pendingSettings === request) pendingSettings = null; }
  };
  const settings = {
    open: (section?: SettingsSection) => requestSettings(instance => instance.open(section)),
    resetAppearance: () => requestSettings(instance => instance.resetAppearance()),
    recording: () => settingsInstance?.recording() ?? false,
    cancelPending,
  };
  const picker = createCommandPicker();
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
  toolbar.hidden = true;
  return {
    settings, picker,
    refreshControls() {
      header.querySelector<HTMLButtonElement>('.tab-add')!.title = `New tab (${hint('new')})`;
    },
  };
}
