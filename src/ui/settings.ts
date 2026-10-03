import '../styles/settings.css';
import type { createCommandPreferences } from '../platform/command-preferences';
import { editorPreferencesStore } from '../platform/editor-preferences';
import { createAppearanceSettings } from './appearance-settings';
import { createEditorSettings } from './editor-settings';
import { createHotkeySettings } from './hotkey-settings';
import { createSubstitutionSettings } from './substitution-settings';
import { dismissDialogOnEscape } from './dialog-escape';
import { icon, iconButton, type IconName } from './icons';

export type SettingsSection = 'appearance' | 'editor' | 'hotkeys' | 'substitutions';
export function createSettings(preferences: ReturnType<typeof createCommandPreferences>, mac: boolean) {
  const dialog = document.createElement('dialog'); dialog.className = 'settings-dialog'; dialog.id = 'scrivo-settings'; dialog.setAttribute('aria-label', 'Settings');
  const sidebar = document.createElement('nav'); sidebar.className = 'settings-sidebar'; sidebar.setAttribute('aria-label', 'Settings sections');
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search settings…'; search.setAttribute('aria-label', 'Search settings');
  const sections = document.createElement('div'); sections.className = 'settings-sections'; sidebar.append(search, sections);
  const content = document.createElement('div'); content.className = 'settings-content';
  const close = iconButton('close', 'Close settings', () => dialog.close()); close.classList.add('settings-close');
  dialog.append(sidebar, content, close); document.body.append(dialog);
  const appearance = createAppearanceSettings(content, () => dialog.open && active === 'appearance');
  const editorStore = editorPreferencesStore();
  const editor = createEditorSettings(content, { get: editorStore.get, set: editorStore.set });
  const hotkeys = createHotkeySettings(content, preferences, mac);
  const substitutions = createSubstitutionSettings(content);
  const pages = { appearance, editor, hotkeys, substitutions };
  const names: readonly (readonly [SettingsSection, string, IconName, string])[] = [
    ['appearance', 'Appearance', 'appearance', 'theme color font light dark'],
    ['editor', 'Editor', 'edit', 'line numbers wrapping spellcheck indentation tab'],
    ['hotkeys', 'Hotkeys', 'keys', 'keyboard shortcuts bindings'],
    ['substitutions', 'Substitutions', 'swap', 'replace text regex symbols'],
  ];
  let active: SettingsSection = 'appearance', previous: HTMLElement | null = null;
  const select = (id: SettingsSection) => {
    hotkeys.cancelRecording(); active = id;
    for (const [key, page] of Object.entries(pages)) page.panel.hidden = key !== id;
    for (const button of sections.querySelectorAll('button')) button.setAttribute('aria-current', button.dataset.section === id ? 'page' : 'false');
    pages[id].refresh(); content.scrollTop = 0;
  };
  for (const [id, name, glyph, keywords] of names) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.section = id;
    button.append(icon(glyph), name); button.addEventListener('click', () => select(id)); button.dataset.search = `${name} ${keywords}`.toLowerCase(); sections.append(button);
  }
  const empty = document.createElement('p'); empty.textContent = 'No matching settings.'; empty.hidden = true; sidebar.append(empty);
  search.addEventListener('input', () => {
    const buttons = [...sections.querySelectorAll('button')];
    buttons.forEach(button => { button.hidden = !button.dataset.search!.includes(search.value.toLowerCase()); });
    empty.hidden = buttons.some(button => !button.hidden);
  });
  const open = (id: SettingsSection = active) => {
    if (!dialog.open) { previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog.showModal(); }
    search.value = ''; search.dispatchEvent(new Event('input')); select(id); search.focus();
  };
  editorStore.subscribe(() => { if (dialog.open && active === 'editor') editor.refresh(); });
  dialog.addEventListener('close', () => { hotkeys.cancelRecording(); if (previous?.isConnected) previous.focus(); });
  dismissDialogOnEscape(dialog);
  select(active);
  return { open, recording: hotkeys.recording, resetAppearance() { open('appearance'); appearance.reset(); } };
}
