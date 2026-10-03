import { defaultSubstitutions, readSubstitutions, type Substitutions } from '../domain/substitutions';
export const SUBSTITUTIONS_KEY = 'scrivo.substitutions.v1';
export function createSubstitutionsStore(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  let current = defaultSubstitutions;
  try { current = readSubstitutions(storage?.getItem(SUBSTITUTIONS_KEY) ?? null); } catch { /* session defaults */ }
  const subscribers = new Set<(settings: Substitutions) => void>();
  const receive = (raw: string | null) => { current = readSubstitutions(raw); for (const subscriber of subscribers) subscriber(current); };
  return {
    get: () => current, receive,
    subscribe(changed: (settings: Substitutions) => void) { subscribers.add(changed); return () => { subscribers.delete(changed); }; },
    set(settings: Substitutions) {
      receive(JSON.stringify(settings));
      try { if (!storage) return false; storage.setItem(SUBSTITUTIONS_KEY, JSON.stringify(current)); return true; } catch { return false; }
    },
  };
}
let shared: ReturnType<typeof createSubstitutionsStore> | undefined;
export function substitutionsStore() {
  if (!shared) {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* session fallback */ }
    shared = createSubstitutionsStore(storage);
    window.addEventListener('storage', event => {
      if (event.storageArea === storage && (event.key === SUBSTITUTIONS_KEY || event.key === null)) shared!.receive(event.newValue);
    });
  }
  return shared;
}
