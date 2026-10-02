export interface RecentFile { readonly path: string; readonly identity: string }
export function readRecents(raw: string | null): readonly RecentFile[] {
  if (!raw || raw.length > 256 * 1024) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.slice(0, 50).filter((item): item is RecentFile => {
      if (!item || typeof item.path !== 'string' || !item.path || item.path.length > 4096 || item.path.includes('\0')
        || typeof item.identity !== 'string' || !item.identity || item.identity.length > 4096 || seen.has(item.identity)) return false;
      seen.add(item.identity); return true;
    }).map(({ path, identity }) => ({ path, identity }));
  } catch { return []; }
}
