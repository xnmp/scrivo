import '../styles/appearance.css';
import { appearanceStore } from '../platform/appearance';
import { importedTheme, MAX_THEME_SIZE } from '../domain/appearance';

export function createAppearanceSettings(host: HTMLElement) {
  const store = appearanceStore();
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'appearance-toggle';
  toggle.textContent = '◐';
  toggle.title = 'Appearance (Ctrl/⌘+,)';
  toggle.setAttribute('aria-label', 'Appearance');
  toggle.setAttribute('aria-expanded', 'false');
  const dialog = document.createElement('dialog');
  dialog.className = 'appearance-dialog';
  dialog.setAttribute('aria-label', 'Appearance');
  dialog.id = 'appearance-settings';
  toggle.setAttribute('aria-controls', dialog.id);
  const heading = document.createElement('h2');
  heading.textContent = 'Appearance';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.className = 'appearance-close';
  close.addEventListener('click', () => dialog.close());
  const notice = document.createElement('p');
  let importGeneration = 0;
  notice.setAttribute('role', 'status');
  const saved = (success: boolean) => { notice.textContent = success ? '' : 'Changed for this window. Could not save appearance for the next launch.'; };
  const label = (text: string, input: HTMLElement) => {
    const node = document.createElement('label');
    node.append(text, input);
    dialog.append(node);
  };
  const select = (name: string, values: readonly (readonly [string, string])[]) => {
    const input = document.createElement('select');
    input.setAttribute('aria-label', name);
    input.replaceChildren(...values.map(([value, text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; return option; }));
    label(name, input);
    return input;
  };
  dialog.append(heading, close);
  const mode = select('Color scheme', [['system', 'Adapt to system'], ['light', 'Light'], ['dark', 'Dark']]);
  mode.addEventListener('change', () => saved(store.set({ ...store.get(), mode: mode.value as 'system' | 'light' | 'dark' })));
  const themes = select('Theme', [['', 'Default']]);
  themes.addEventListener('change', () => { importGeneration++; saved(store.set({ ...store.get(), theme: themes.value })); });
  const themeActions = document.createElement('div');
  themeActions.className = 'appearance-actions';
  const upload = document.createElement('input');
  upload.type = 'file'; upload.accept = '.css,text/css'; upload.hidden = true;
  const importButton = document.createElement('button');
  importButton.type = 'button'; importButton.textContent = 'Import theme.css';
  importButton.addEventListener('click', () => upload.click());
  upload.addEventListener('change', () => {
    const file = upload.files?.[0];
    upload.value = '';
    if (!file) return;
    const generation = ++importGeneration;
    if (file.size > MAX_THEME_SIZE) { notice.textContent = 'Theme files must be at most 1 MiB.'; return; }
    void file.text().then((css) => {
      if (generation !== importGeneration) return;
      saved(store.import(importedTheme(file.name, css, crypto.randomUUID())));
    }).catch((error: unknown) => { if (generation === importGeneration) notice.textContent = String(error instanceof Error ? error.message : error); });
  });
  const remove = document.createElement('button');
  remove.type = 'button'; remove.textContent = 'Remove theme';
  remove.addEventListener('click', () => { importGeneration++; saved(store.remove(store.get().theme)); });
  themeActions.append(importButton, remove, upload);
  const help = document.createElement('p');
  help.textContent = 'Imports Obsidian color and typography variables and compatible CSS. Obsidian-specific layouts and plugins are not supported. Use self-contained theme files; local companion assets are not imported.';
  dialog.append(themeActions, help);
  const accent = document.createElement('input');
  accent.type = 'color'; accent.setAttribute('aria-label', 'Accent color');
  accent.addEventListener('input', () => saved(store.set({ ...store.get(), accent: accent.value })));
  label('Accent color', accent);
  const resetAccent = document.createElement('button');
  resetAccent.type = 'button'; resetAccent.textContent = 'Use theme accent';
  resetAccent.addEventListener('click', () => saved(store.set({ ...store.get(), accent: '' })));
  dialog.append(resetAccent);
  const fonts = (key: 'textFont' | 'monoFont', name: string) => {
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 100; input.placeholder = 'Theme default'; input.setAttribute('aria-label', name);
    input.addEventListener('change', () => saved(store.set({ ...store.get(), [key]: input.value })));
    label(name, input);
    return input;
  };
  const textFont = fonts('textFont', 'Text font');
  const monoFont = fonts('monoFont', 'Monospace font');
  const size = document.createElement('input');
  size.type = 'number'; size.min = '12'; size.max = '24'; size.step = '1'; size.setAttribute('aria-label', 'Font size');
  size.addEventListener('change', () => saved(store.set({ ...store.get(), fontSize: Number(size.value) })));
  label('Font size', size);
  const reset = document.createElement('button');
  reset.type = 'button'; reset.textContent = 'Reset appearance';
  reset.title = 'Reset appearance (Ctrl/⌘+Shift+,)';
  reset.addEventListener('click', () => { importGeneration++; saved(store.reset()); });
  dialog.append(reset, notice);
  const refresh = () => {
    if (!dialog.open) return;
    const preferences = store.get();
    mode.value = preferences.mode;
    themes.replaceChildren(...[{ id: '', name: 'Default' }, ...store.themes()].map((theme) => {
      const option = document.createElement('option'); option.value = theme.id; option.textContent = theme.name; return option;
    }));
    themes.value = preferences.theme;
    remove.disabled = !preferences.theme;
    accent.value = preferences.accent || '#0969da';
    textFont.value = preferences.textFont; monoFont.value = preferences.monoFont; size.value = String(preferences.fontSize);
  };
  const open = () => { if (!dialog.open) dialog.showModal(); refresh(); toggle.setAttribute('aria-expanded', 'true'); };
  toggle.addEventListener('click', open);
  dialog.addEventListener('close', () => { toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); });
  // Always available, even if a custom theme hides the app controls.
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey) return;
    if (event.key === 'Escape' && dialog.open) { event.preventDefault(); dialog.close(); return; }
    if ((event.ctrlKey || event.metaKey) && (event.key === ',' || event.code === 'Comma')) {
      event.preventDefault();
      if (event.shiftKey) { importGeneration++; saved(store.reset()); }
      open();
    }
  });
  store.subscribe(refresh);
  host.append(toggle);
  document.body.append(dialog);
}
