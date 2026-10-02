import { defaultAppearance, readAppearance, readThemes, MAX_THEME_SIZE, type Appearance, type Theme } from '../domain/appearance';

export const APPEARANCE_KEY = 'scrivo.appearance.v1';
const THEMES_KEY = 'scrivo.themes.v1';
const ACTIVE_CSS_KEY = 'scrivo.active-theme.v1';
export function createAppearanceStore(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  const read = (key: string) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  let preferences = readAppearance(read(APPEARANCE_KEY));
  const activeTheme = (): Theme | null => {
    const serialized = read(ACTIVE_CSS_KEY);
    // JSON may expand one control character into six bytes; bound decoded CSS below.
    if (!serialized || serialized.length > 6 * MAX_THEME_SIZE + 4096) return null;
    try {
      const value = JSON.parse(serialized);
      return typeof value?.id === 'string' && value.id.length > 0 && value.id.length <= 100
        && typeof value.name === 'string' && value.name.length <= 100
        && typeof value.css === 'string' && value.css.length <= MAX_THEME_SIZE && value.css.trim()
        ? Object.freeze({ id: value.id, name: value.name, css: value.css }) : null;
    } catch { return null; }
  };
  let active = activeTheme();
  preferences = { ...preferences, theme: active?.id ?? '' };
  let themes: readonly Theme[] | undefined;
  let builtins: readonly Theme[] = [];
  const subscribers = new Set<() => void>();
  const publish = () => { for (const subscriber of subscribers) subscriber(); };
  const library = () => {
    if (!themes) {
      const saved = readThemes(read(THEMES_KEY));
      // The atomic active snapshot survives a partial library mutation. Recover
      // its entry so the selector always describes the CSS actually in use.
      themes = active ? [...saved.filter((theme) => theme.id !== active!.id), active] : saved;
    }
    return [...builtins, ...themes.filter(theme => !builtins.some(builtin => builtin.id === theme.id))];
  };
  const persist = (changedThemes?: readonly Theme[], changedActive?: Theme | null) => {
    try {
      if (!storage) return false;
      if (changedThemes) storage.setItem(THEMES_KEY, JSON.stringify(changedThemes));
      if (changedActive !== undefined) storage.setItem(ACTIVE_CSS_KEY, JSON.stringify(changedActive));
      storage.setItem(APPEARANCE_KEY, JSON.stringify(preferences));
      return true;
    } catch { return false; }
  };
  return {
    registerBuiltins(catalog: readonly Theme[]) {
      builtins = catalog;
      if (active?.id.startsWith('builtin:')) {
        const packaged = catalog.find(theme => theme.id === active!.id);
        if (packaged && packaged.css !== active.css) { active = packaged; publish(); persist(undefined, active); }
      }
    },
    get: () => preferences, css: () => active?.css ?? '', themes: library,
    subscribe(changed: () => void) { subscribers.add(changed); return () => { subscribers.delete(changed); }; },
    receive() {
      preferences = readAppearance(read(APPEARANCE_KEY));
      active = activeTheme();
      preferences = { ...preferences, theme: active?.id ?? '' };
      themes = undefined;
      publish();
    },
    set(next: Appearance) {
      const normalized = readAppearance(JSON.stringify(next));
      const changedTheme = normalized.theme !== preferences.theme;
      if (changedTheme) active = library().find((theme) => theme.id === normalized.theme) ?? null;
      preferences = { ...normalized, theme: active?.id ?? '' };
      publish();
      return persist(undefined, changedTheme ? active : undefined);
    },
    import(theme: Theme) {
      if (theme.id.startsWith('builtin:')) throw new Error('Reserved theme ID.');
      const next = [...library().filter((item) => item.id !== theme.id && !item.id.startsWith('builtin:')), theme];
      if (next.length > 20 || JSON.stringify(next).length > 4 * MAX_THEME_SIZE) throw new Error('Remove an imported theme before adding more.');
      themes = next;
      preferences = { ...preferences, theme: theme.id };
      active = theme;
      publish();
      return persist(themes, active);
    },
    remove(id: string) {
      if (id.startsWith('builtin:')) return true;
      themes = library().filter((theme) => theme.id !== id && !theme.id.startsWith('builtin:'));
      const changedTheme = preferences.theme === id;
      if (changedTheme) { preferences = { ...preferences, theme: '' }; active = null; }
      publish();
      return persist(themes, changedTheme ? null : undefined);
    },
    reset() { preferences = defaultAppearance; active = null; publish(); return persist(undefined, null); },
  };
}
let shared: ReturnType<typeof createAppearanceStore> | undefined;
export function appearanceStore() {
  if (!shared) {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* session settings remain usable */ }
    shared = createAppearanceStore(storage);
    window.addEventListener('storage', (event) => {
      if (event.key === APPEARANCE_KEY || event.key === ACTIVE_CSS_KEY || event.key === THEMES_KEY || event.key === null) shared?.receive();
    });
  }
  return shared;
}

/** Apply before document layout; the theme library and settings UI stay deferred. */
export function applyAppearance() {
  const store = appearanceStore();
  const media = matchMedia('(prefers-color-scheme: dark)');
  let style: HTMLStyleElement | undefined;
  const apply = () => {
    const preferences = store.get();
    const mode = preferences.mode === 'system' ? (media.matches ? 'dark' : 'light') : preferences.mode;
    document.documentElement.dataset.theme = mode;
    for (const host of [document.documentElement, document.body]) {
      host.classList.toggle('theme-dark', mode === 'dark');
      host.classList.toggle('theme-light', mode === 'light');
    }
    const css = store.css();
    if (css && !style) { style = document.createElement('style'); style.id = 'imported-theme'; document.head.append(style); }
    if (style && style.textContent !== css) style.textContent = css;
    const root = document.documentElement.style;
    for (const [property, value] of [
      ['--interactive-accent', preferences.accent], ['--text-accent', preferences.accent],
      ['--font-text-override', preferences.textFont], ['--font-monospace-override', preferences.monoFont],
      ['--font-text', preferences.textFont], ['--font-monospace', preferences.monoFont],
      ['--font-text-size', `${preferences.fontSize}px`],
    ]) {
      if (value) root.setProperty(property!, value); else root.removeProperty(property!);
    }
    // Font and accent overrides belong on body too: Obsidian themes commonly define variables there.
    const body = document.body.style;
    for (const property of ['--interactive-accent', '--text-accent', '--font-text-override', '--font-monospace-override', '--font-text', '--font-monospace', '--font-text-size']) {
      const value = root.getPropertyValue(property);
      if (value) body.setProperty(property, value); else body.removeProperty(property);
    }
  };
  apply();
  store.subscribe(apply);
  media.addEventListener('change', apply);
}
