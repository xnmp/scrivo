import { describe, expect, it } from 'vitest';
import { bindings, commands, conflict, eventChord, matchCommand, readHotkeys, validChord } from './commands';
import { createCommandPreferences, readRecents } from '../platform/command-preferences';
const event = (code: string, shiftKey = false) => ({ code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, ctrlKey: true, metaKey: false, altKey: false, shiftKey });
describe('command bindings', () => {
  it('resolves shifted native keys and separates new tab from table insertion', () => {
    expect(matchCommand(eventChord(event('KeyT'), false), {}, false)?.id).toBe('new');
    expect(matchCommand(eventChord(event('KeyT', true), false), {}, false)?.id).toBe('table');
    expect(matchCommand(eventChord(event('KeyZ', true), false), {}, false)?.id).toBe('redo');
  });
  it('uses replacement bindings, including an explicitly unassigned command', () => {
    const overrides = readHotkeys('{"new":["Mod+Alt+KeyJ"],"save":[]}');
    expect(matchCommand('Mod+KeyT', overrides, false)).toBeUndefined();
    expect(matchCommand('Mod+Alt+KeyJ', overrides, false)?.id).toBe('new');
    expect(bindings(commands.find(def => def.id === 'save')!, overrides)).toEqual([]);
  });
  it('detects operating system aliases as conflicts', () => {
    expect(conflict('save', 'Ctrl+KeyT', {}, false)?.id).toBe('new');
    expect(conflict('save', 'Meta+KeyT', {}, true)?.id).toBe('new');
    expect(conflict('new', 'Mod+KeyT', {}, false)).toBeUndefined();
  });
  it('ignores corrupt, oversized, unsafe typing, and unknown command data', () => {
    for (const raw of [null, 'null', '{', '[]', 'x'.repeat(40000)]) expect(readHotkeys(raw)).toEqual({});
    expect(readHotkeys('{"unknown":["Mod+KeyT"],"new":["KeyA"],"save":["Mod+KeyS"]}')).toEqual({ save: ['Mod+KeyS'] });
    expect(validChord('Shift+KeyA')).toBe(false);
    expect(validChord('Shift+Mod+KeyA')).toBe(false);
    expect(validChord('Alt+Shift+Digit5')).toBe(true);
  });
  it('has no conflicting default commands on either OS', () => {
    for (const mac of [false, true]) for (const command of commands) for (const key of command.keys) {
      expect(validChord(key)).toBe(true); expect(conflict(command.id, key, {}, mac)).toBeUndefined();
    }
  });
});
describe('persistent command preferences', () => {
  const disk = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
  it('persists hotkeys and recent files with identity deduplication and MRU order', () => {
    const storage = disk(), store = createCommandPreferences(storage);
    store.setHotkeys({ new: ['Mod+Alt+KeyJ'] });
    store.remember('/a.md', 'a'); store.remember('/b.md', 'b'); store.remember('/alias.md', 'a');
    const next = createCommandPreferences(storage);
    expect(next.hotkeys()).toEqual({ new: ['Mod+Alt+KeyJ'] });
    expect(next.recents()).toEqual([{ path: '/alias.md', identity: 'a' }, { path: '/b.md', identity: 'b' }]);
    next.clearRecents(); expect(createCommandPreferences(storage).recents()).toEqual([]);
  });
  it('bounds and validates the recent list', () => {
    expect(readRecents('null')).toEqual([]); expect(readRecents('x'.repeat(300000))).toEqual([]);
    const values = Array.from({ length: 80 }, (_, i) => ({ path: `/a${i}.md`, identity: String(i) }));
    expect(readRecents(JSON.stringify(values))).toHaveLength(50);
    expect(readRecents(JSON.stringify([{ path: 'a\0.md', identity: 'a' }, { path: 4, identity: 'b' }]))).toEqual([]);
  });
  it('keeps session preferences usable after denied storage', () => {
    const store = createCommandPreferences({ getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } });
    expect(store.setHotkeys({ new: [] })).toBe(false); expect(store.hotkeys()).toEqual({ new: [] });
    expect(store.remember('/a.md', 'a')).toBe(false); expect(store.recents()[0]?.path).toBe('/a.md');
  });
});
