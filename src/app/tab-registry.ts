/** Document identity and selection, independent of UI and document I/O. */
export interface TabRecord {
  readonly id: string;
  readonly identity: string | null;
}

export interface TabRegistry {
  readonly tabs: readonly TabRecord[];
  readonly activeId: string | null;
}

export const emptyTabs = (): TabRegistry => ({ tabs: [], activeId: null });

export function openTab(registry: TabRegistry, id: string, identity: string | null): TabRegistry {
  const duplicate = identity === null ? undefined : registry.tabs.find((tab) => tab.identity === identity);
  if (duplicate) return { ...registry, activeId: duplicate.id };
  if (registry.tabs.some((tab) => tab.id === id)) throw new Error(`Duplicate tab ID: ${id}`);
  return { tabs: [...registry.tabs, { id, identity }], activeId: id };
}

export function activateTab(registry: TabRegistry, id: string): TabRegistry {
  if (!registry.tabs.some((tab) => tab.id === id)) return registry;
  return { ...registry, activeId: id };
}

/** A Save As collision is rejected before updating either tab's identity. */
export function updateTabIdentity(registry: TabRegistry, id: string, identity: string | null): TabRegistry {
  if (!registry.tabs.some((tab) => tab.id === id)) throw new Error(`Unknown tab ID: ${id}`);
  if (identity !== null && registry.tabs.some((tab) => tab.id !== id && tab.identity === identity)) {
    throw new Error(`Document is already open: ${identity}`);
  }
  return {
    ...registry,
    tabs: registry.tabs.map((tab) => tab.id === id ? { ...tab, identity } : tab),
  };
}

export function closeTab(registry: TabRegistry, id: string): TabRegistry {
  const index = registry.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return registry;
  const tabs = registry.tabs.filter((tab) => tab.id !== id);
  return {
    tabs,
    activeId: registry.activeId === id
      ? (tabs[index] ?? tabs[index - 1])?.id ?? null
      : registry.activeId,
  };
}
