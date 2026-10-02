import { describe, expect, it } from 'vitest';
import { defaultEditorPreferences } from '../domain/editor-preferences';
import { createEditorPreferencesStore, EDITOR_PREFERENCES_KEY } from './editor-preferences';

describe('preference persistence', () => {
  it('persists selected settings for a new session and notifies current subscribers', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createEditorPreferencesStore(storage);
    const observed: boolean[] = [];
    const unsubscribe = store.subscribe((next) => observed.push(next.lineNumbers));
    const next = { ...defaultEditorPreferences, lineNumbers: true, spellcheck: false };
    expect(store.set(next)).toBe(true);
    expect(createEditorPreferencesStore(storage).get()).toEqual(next);
    expect(observed).toEqual([true]);
    unsubscribe();
    store.set(defaultEditorPreferences);
    expect(observed).toEqual([true]);
    expect(values.has(EDITOR_PREFERENCES_KEY)).toBe(true);
  });
  it('keeps session settings usable when storage access fails and reports persistence failure', () => {
    const store = createEditorPreferencesStore({ getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } });
    expect(store.get()).toEqual(defaultEditorPreferences);
    expect(store.set({ ...defaultEditorPreferences, indentationGuides: true })).toBe(false);
    expect(store.get().indentationGuides).toBe(true);
  });
  it('receives settings from another window and resets safely after removal or corrupt data', () => {
    const store = createEditorPreferencesStore(undefined);
    store.receive('{"lineNumbers":true}');
    expect(store.get().lineNumbers).toBe(true);
    store.receive('bad');
    expect(store.get()).toEqual(defaultEditorPreferences);
    store.receive(null);
    expect(store.get()).toEqual(defaultEditorPreferences);
  });
});
