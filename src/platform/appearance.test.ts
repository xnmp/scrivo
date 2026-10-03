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

it('bundled palettes persist without import and reconcile updated packaged CSS', () => {
  const disk = storage(); const store = createAppearanceStore(disk);
  const theme = { id: 'builtin:test', name: 'Test', css: '.theme-dark{color:red}' };
  store.registerBuiltins([theme]); store.set({ ...store.get(), theme: theme.id });
  expect(store.css()).toBe(theme.css);
  const next = createAppearanceStore(disk); expect(next.css()).toBe(theme.css);
  next.registerBuiltins([{ ...theme, css: '.theme-dark{color:blue}' }]);
  expect(next.css()).toContain('blue'); next.remove(theme.id); expect(next.get().theme).toBe(theme.id);
  expect(createAppearanceStore(disk).css()).toContain('blue');
});


describe('desktop theme catalog', () => {
  const nord = { id: 'builtin:desktop:nord', name: 'Nord', css: ':root{--text-normal:#eceff4}' };
  const mint = { id: 'builtin:desktop:mint-light', name: 'Mint Light', css: ':root{--text-normal:#123456}' };
  it('applies external selection before settings open and preserves typography and imports', () => {
    const disk = storage(); const original = createAppearanceStore(disk);
    original.import(importedTheme('Custom', 'body{color:red}', 'custom'));
    original.set({ ...original.get(), mode: 'light', accent: '#ff0000', fontSize: 20, textFont: 'Georgia' });
    const next = createAppearanceStore(disk, { themes: [nord, mint], theme: nord.id, mode: 'dark' });
    expect(next.get()).toMatchObject({ theme: nord.id, mode: 'dark', accent: '', fontSize: 20, textFont: 'Georgia' });
    expect(next.css()).toBe(nord.css);
    next.registerBuiltins([{ id: 'builtin:paper', name: 'Paper', css: 'body{color:green}' }]);
    expect(next.themes().map(theme => theme.name).sort()).toEqual(['Custom', 'Mint Light', 'Nord', 'Paper']);
    next.set({ ...next.get(), theme: mint.id });
    expect(next.css()).toBe(mint.css);
    next.remove(mint.id); expect(next.css()).toBe(mint.css);
    const relaunched = createAppearanceStore(disk, { themes: [nord, mint], theme: nord.id, mode: 'dark' });
    expect(relaunched.css()).toBe(nord.css);
  });
  it('keeps the selected palette usable without browser storage', () => {
    const next = createAppearanceStore(undefined, { themes: [nord], theme: nord.id, mode: 'dark' });
    expect(next.css()).toBe(nord.css);
    expect(next.get().mode).toBe('dark');
  });
});
