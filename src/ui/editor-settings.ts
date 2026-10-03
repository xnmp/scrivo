import '../styles/editor-settings.css';
import type { EditorPreferences } from '../domain/editor-preferences';

export function createEditorSettings(host: HTMLElement, actions: {
  readonly get: () => EditorPreferences;
  readonly set: (preferences: EditorPreferences) => boolean;
}) {
  const panel = document.createElement('section');
  panel.className = 'editor-settings-page settings-page';
  const heading = document.createElement('h2');
  heading.textContent = 'Editor settings';
  const help = document.createElement('p');
  help.textContent = 'Applies to all documents. Markdown stays unchanged.';
  const notice = document.createElement('p');
  notice.setAttribute('role', 'status');
  panel.append(heading, help);
  const inputs = new Map<keyof EditorPreferences, HTMLInputElement | HTMLSelectElement>();
  for (const [key, text] of [
    ['lineNumbers', 'Line numbers'], ['indentationGuides', 'Indentation guides'],
    ['spellcheck', 'Spellcheck'], ['lineWrapping', 'Wrap long lines'],
  ] as const) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    label.append(input, text);
    input.addEventListener('change', () => {
      notice.textContent = actions.set({ ...actions.get(), [key]: input.checked }) ? '' : 'Changed for this window. Could not save settings for the next launch.';
    });
    inputs.set(key, input);
    panel.append(label);
  }
  const tabLabel = document.createElement('label');
  tabLabel.textContent = 'Tab display width';
  const tab = document.createElement('select');
  tab.setAttribute('aria-label', 'Tab display width');
  for (const size of [2, 4, 8] as const) {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = `${size} spaces`;
    tab.append(option);
  }
  tab.addEventListener('change', () => {
    const tabSize = Number(tab.value) as EditorPreferences['tabSize'];
    notice.textContent = actions.set({ ...actions.get(), tabSize }) ? '' : 'Changed for this window. Could not save settings for the next launch.';
  });
  tabLabel.append(tab);
  inputs.set('tabSize', tab);
  panel.append(tabLabel, notice);
  const refresh = () => {
    const preferences = actions.get();
    for (const [key, input] of inputs) {
      if (input instanceof HTMLInputElement) input.checked = preferences[key] as boolean;
      else input.value = String(preferences[key]);
    }
  };
  host.append(panel);
  return { panel, refresh };
}
