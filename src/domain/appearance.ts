export interface Appearance {
  readonly mode: 'system' | 'light' | 'dark';
  readonly theme: string;
  readonly accent: string;
  readonly textFont: string;
  readonly monoFont: string;
  readonly fontSize: number;
}
export interface Theme { readonly id: string; readonly name: string; readonly css: string }
export const MAX_THEME_SIZE = 1024 * 1024;
export const defaultAppearance: Appearance = Object.freeze({
  mode: 'system', theme: '', accent: '', textFont: '', monoFont: '', fontSize: 16,
});
export function readAppearance(serialized: string | null): Appearance {
  if (!serialized || serialized.length > 4096) return defaultAppearance;
  try {
    const value = JSON.parse(serialized);
    if (!value || typeof value !== 'object') return defaultAppearance;
    const font = (input: unknown) => typeof input === 'string' && input.length <= 100
      && !/[;{}<>\x00-\x1f]/.test(input) ? input : '';
    return Object.freeze({
      mode: value.mode === 'dark' || value.mode === 'light' ? value.mode : 'system',
      theme: typeof value.theme === 'string' && value.theme.length <= 100 ? value.theme : '',
      accent: typeof value.accent === 'string' && /^#[\da-f]{6}$/i.test(value.accent) ? value.accent : '',
      textFont: font(value.textFont), monoFont: font(value.monoFont),
      fontSize: Number.isInteger(value.fontSize) && value.fontSize >= 12 && value.fontSize <= 24 ? value.fontSize : 16,
    });
  } catch { return defaultAppearance; }
}
export function importedTheme(name: string, css: string, id: string): Theme {
  if (!css.trim()) throw new Error('The theme file is empty.');
  if (css.length > MAX_THEME_SIZE) throw new Error('Theme files must be at most 1 MiB.');
  return Object.freeze({ id, name: name.replace(/\.css$/i, '').slice(0, 100) || 'Imported theme', css });
}
export function readThemes(serialized: string | null): readonly Theme[] {
  if (!serialized || serialized.length > 4 * MAX_THEME_SIZE) return [];
  try {
    const values: unknown = JSON.parse(serialized);
    if (!Array.isArray(values) || values.length > 20) return [];
    return values.flatMap((value) => {
      if (!value || typeof value.id !== 'string' || value.id.length > 100
        || typeof value.name !== 'string' || typeof value.css !== 'string') return [];
      try { return [importedTheme(value.name, value.css, value.id)]; } catch { return []; }
    });
  } catch { return []; }
}
