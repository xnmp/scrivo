import { readRecents } from '../domain/recents';
export { readRecents } from '../domain/recents';
import { readHotkeys, type Hotkeys } from '../domain/commands';
export const HOTKEYS_KEY = 'scrivo.hotkeys.v1';
export const RECENTS_KEY = 'scrivo.recents.v1';
export function createCommandPreferences(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  const read = (key: string) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  let hotkeys = readHotkeys(read(HOTKEYS_KEY)), recents = readRecents(read(RECENTS_KEY));
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach(listener => listener());
  const write = (key: string, value: unknown) => { publish(); try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  return {
    hotkeys: () => hotkeys, recents: () => recents,
    setHotkeys(next: Hotkeys) { hotkeys = readHotkeys(JSON.stringify(next)); return write(HOTKEYS_KEY, hotkeys); },
    remember(path: string, identity: string) { recents = readRecents(JSON.stringify([{ path, identity }, ...recents.filter(item => item.identity !== identity && item.path !== path)])); return write(RECENTS_KEY, recents); },
    clearRecents() { recents = []; return write(RECENTS_KEY, recents); },
    receive() { hotkeys = readHotkeys(read(HOTKEYS_KEY)); recents = readRecents(read(RECENTS_KEY)); publish(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
export function commandPreferences() {
  let storage: Storage | undefined;
  try { storage = localStorage; } catch { /* session-only preferences */ }
  const store = createCommandPreferences(storage);
  window.addEventListener('storage', event => { if ([HOTKEYS_KEY, RECENTS_KEY, null].includes(event.key)) store.receive(); });
  return store;
}
