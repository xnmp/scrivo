import { describe, expect, it } from 'vitest';
import { createAppearanceStore } from './appearance';
import { defaultAppearance, importedTheme, MAX_THEME_SIZE } from '../domain/appearance';

const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
describe('appearance persistence', () => {
  it('persists selected CSS and controls across launches and preserves other themes', () => {
    const disk = storage();
    const first = createAppearanceStore(disk);
    first.import(importedTheme('Dusk.css', '.theme-dark{--text-normal:red}', 'a'));
    first.import(importedTheme('Dawn.css', '.theme-light{--text-normal:blue}', 'b'));
    first.set({ ...first.get(), mode: 'dark', theme: 'a', accent: '#123456', fontSize: 18 });
    const next = createAppearanceStore(disk);
    expect(next.get()).toEqual({ ...defaultAppearance, mode: 'dark', theme: 'a', accent: '#123456', fontSize: 18 });
    expect(next.css()).toContain('red');
    expect(next.themes().map((theme) => theme.name).sort()).toEqual(['Dawn', 'Dusk']);
    next.remove('a');
    expect(createAppearanceStore(disk).css()).toBe('');
    expect(createAppearanceStore(disk).themes().map((theme) => theme.name)).toEqual(['Dawn']);
  });
  it('applies cross-window changes and unsubscribes cleanly', () => {
    const disk = storage();
    const left = createAppearanceStore(disk), right = createAppearanceStore(disk);
    const observed: string[] = [];
    const unsubscribe = right.subscribe(() => observed.push(right.get().mode));
    left.set({ ...left.get(), mode: 'light' }); right.receive(); unsubscribe();
    left.set({ ...left.get(), mode: 'dark' }); right.receive();
    expect(observed).toEqual(['light']);
    expect(right.get().mode).toBe('dark');
  });
  it('keeps session controls and themes usable when storage fails', () => {
    const store = createAppearanceStore({ getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } });
    expect(store.import(importedTheme('A', 'body{color:red}', 'a'))).toBe(false);
    expect(store.css()).toContain('red');
    expect(store.reset()).toBe(false);
    expect(store.get()).toEqual(defaultAppearance);
    expect(store.css()).toBe('');
  });
  it('never restores another theme CSS after a partial persistence failure', () => {
    const disk = storage();
    const first = createAppearanceStore(disk);
    first.import(importedTheme('A', 'body{color:red}', 'a'));
    const partial = createAppearanceStore({ ...disk, setItem(key, value) {
      if (key === 'scrivo.appearance.v1') throw Error('quota');
      disk.setItem(key, value);
    } });
    expect(partial.import(importedTheme('B', 'body{color:blue}', 'b'))).toBe(false);
    const next = createAppearanceStore(disk);
    expect(next.get().theme).toBe('b');
    expect(next.css()).toContain('blue');
  });
  it('recovers an active library entry if its removal could not be persisted', () => {
    const disk = storage();
    createAppearanceStore(disk).import(importedTheme('A', 'body{color:red}', 'a'));
    const partial = createAppearanceStore({ ...disk, setItem(key, value) {
      if (key === 'scrivo.active-theme.v1') throw Error('quota');
      disk.setItem(key, value);
    } });
    expect(partial.remove('a')).toBe(false);
    const next = createAppearanceStore(disk);
    expect(next.get().theme).toBe('a');
    expect(next.themes()).toEqual([importedTheme('A', 'body{color:red}', 'a')]);
    expect(next.css()).toContain('red');
  });
  it('restores an accepted boundary-size theme with JSON-escaped CSS', () => {
    const disk = storage();
    const css = '/*' + '\\'.repeat(MAX_THEME_SIZE - 4) + '*/';
    expect(createAppearanceStore(disk).import(importedTheme('Boundary', css, 'a'))).toBe(true);
    expect(createAppearanceStore(disk).css()).toBe(css);
  });
  it('saves ordinary controls without rewriting theme data when library storage is unavailable', () => {
    const disk = storage();
    createAppearanceStore(disk).import(importedTheme('A', 'body{color:red}', 'a'));
    const store = createAppearanceStore({ ...disk, setItem(key, value) {
      if (key !== 'scrivo.appearance.v1') throw Error('theme storage unavailable');
      disk.setItem(key, value);
    } });
    store.themes();
    expect(store.set({ ...store.get(), accent: '#123456' })).toBe(true);
    expect(createAppearanceStore(disk).get().accent).toBe('#123456');
  });
});
