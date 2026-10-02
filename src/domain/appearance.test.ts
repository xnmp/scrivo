import { describe, expect, it } from 'vitest';
import { defaultAppearance, importedTheme, MAX_THEME_SIZE, readAppearance, readThemes } from './appearance';

describe('appearance values', () => {
  it('uses safe defaults for malformed or missing preferences', () => {
    for (const input of [null, '{', 'null', '4', 'x'.repeat(5000)]) expect(readAppearance(input)).toEqual(defaultAppearance);
  });
  it('round trips valid controls and rejects invalid ranges and CSS text', () => {
    const appearance = { mode: 'dark', theme: 'custom', accent: '#aBc123', textFont: 'Georgia', monoFont: 'monospace', fontSize: 18 };
    expect(readAppearance(JSON.stringify(appearance))).toEqual(appearance);
    expect(readAppearance(JSON.stringify({ mode: 'invalid', accent: 'red', textFont: 'x; color:red', monoFont: 'x\n', fontSize: 100 }))).toEqual(defaultAppearance);
  });
  it('imports bounded named CSS without modifying its declarations', () => {
    const css = '.theme-dark { --background-primary: #123456; }';
    expect(importedTheme('Dusk.css', css, 'id')).toEqual({ id: 'id', name: 'Dusk', css });
    expect(() => importedTheme('Empty', '  ', 'id')).toThrow('empty');
    expect(() => importedTheme('Huge', 'x'.repeat(MAX_THEME_SIZE + 1), 'id')).toThrow('1 MiB');
  });
  it('restores only valid themes from malformed library data', () => {
    expect(readThemes('{')).toEqual([]);
    expect(readThemes(JSON.stringify([null, {}, { id: 'a', name: 'A', css: '.theme-light{}' }]))).toEqual([{ id: 'a', name: 'A', css: '.theme-light{}' }]);
  });
});
