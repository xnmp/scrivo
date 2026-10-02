import { defaultEditorPreferences, readEditorPreferences, type EditorPreferences } from '../domain/editor-preferences';

export const EDITOR_PREFERENCES_KEY = 'scrivo.editor-preferences.v1';
export function createEditorPreferencesStore(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  let current = defaultEditorPreferences;
  try { current = readEditorPreferences(storage?.getItem(EDITOR_PREFERENCES_KEY) ?? null); } catch { /* defaults remain usable */ }
  const subscribers = new Set<(preferences: EditorPreferences) => void>();
  const receive = (serialized: string | null) => {
    current = readEditorPreferences(serialized);
    for (const subscriber of subscribers) subscriber(current);
  };
  return {
    get: () => current,
    subscribe(changed: (preferences: EditorPreferences) => void) {
      subscribers.add(changed);
      return () => { subscribers.delete(changed); };
    },
    receive,
    set(preferences: EditorPreferences): boolean {
      receive(JSON.stringify(preferences));
      try {
        if (!storage) return false;
        storage.setItem(EDITOR_PREFERENCES_KEY, JSON.stringify(current));
        return true;
      } catch { return false; }
    },
  };
}

let shared: ReturnType<typeof createEditorPreferencesStore> | undefined;
export function editorPreferencesStore() {
  if (!shared) {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* session preferences still work */ }
    shared = createEditorPreferencesStore(storage);
    window.addEventListener('storage', (event) => {
      if (event.storageArea === storage && (event.key === EDITOR_PREFERENCES_KEY || event.key === null)) shared!.receive(event.newValue);
    });
  }
  return shared;
}
