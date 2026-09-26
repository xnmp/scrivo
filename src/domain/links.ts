// Resolving link and image targets written in a document.

export type Target =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'file'; readonly path: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

/** Markdown allows `<...>` around destinations with spaces. */
const unwrap = (raw: string) => {
  const s = raw.trim();
  return s.startsWith('<') && s.endsWith('>') ? s.slice(1, -1) : s;
};

const decode = (s: string) => {
  try {
    return decodeURI(s);
  } catch {
    return s; // malformed escapes: use as written
  }
};

function joinPath(dir: string, rel: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const parts = dir.split(/[\\/]/);
  // A trailing separator ("/", "/docs/") leaves an empty last segment; the leading ones
  // mark the root (or a UNC prefix) and stay.
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join(sep);
}

/**
 * Where an image or link destination points. Relative paths resolve against the
 * document's directory; without one (unsaved document) they can't be resolved.
 */
export function resolveTarget(raw: string, docDir: string | null): Target | null {
  const dest = unwrap(raw).split('#')[0]!.split('?')[0]!;
  const original = unwrap(raw);
  if (original === '') return null;
  if (WINDOWS_ABSOLUTE.test(original)) return { kind: 'file', path: decode(dest) };
  if (/^file:\/\//i.test(original)) {
    const path = decode(original.replace(/^file:\/\//i, '').split(/[?#]/)[0]!);
    return { kind: 'file', path: /^\/[a-z]:\//i.test(path) ? path.slice(1) : path };
  }
  if (SCHEME.test(original)) return { kind: 'url', url: original };
  if (original.startsWith('//')) return { kind: 'url', url: `https:${original}` };
  if (dest.startsWith('/')) return { kind: 'file', path: decode(dest) };
  if (docDir === null) return null;
  return { kind: 'file', path: joinPath(docDir, decode(dest)) };
}

const MARKDOWN_EXTENSIONS = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext|txt)$/i;

/** Files Scrivo opens itself rather than handing to the system. */
export const isMarkdownPath = (path: string): boolean => MARKDOWN_EXTENSIONS.test(path);

/** Schemes handed to the system's default application. */
const EXTERNAL_SCHEMES = /^(https?|mailto|tel):/i;

/** What following a link in the reading view does. */
export type LinkAction =
  | { readonly kind: 'anchor'; readonly id: string }
  | { readonly kind: 'document'; readonly path: string; readonly anchor: string | null }
  | { readonly kind: 'external'; readonly url: string }
  /** A local file that isn't markdown: shown in the file manager, never executed. */
  | { readonly kind: 'reveal'; readonly path: string }
  | { readonly kind: 'none' };

const fragmentOf = (raw: string): string | null => {
  const i = raw.indexOf('#');
  if (i < 0 || i === raw.length - 1) return null;
  const f = raw.slice(i + 1);
  try {
    return decodeURIComponent(f);
  } catch {
    return f;
  }
};

export function linkAction(href: string, docDir: string | null): LinkAction {
  const raw = href.trim();
  if (raw.startsWith('#')) {
    const id = fragmentOf(raw);
    return id === null ? { kind: 'none' } : { kind: 'anchor', id };
  }
  const target = resolveTarget(raw, docDir);
  if (target === null) return { kind: 'none' };
  if (target.kind === 'url') {
    return EXTERNAL_SCHEMES.test(target.url) ? { kind: 'external', url: target.url } : { kind: 'none' };
  }
  return isMarkdownPath(target.path)
    ? { kind: 'document', path: target.path, anchor: fragmentOf(raw) }
    : { kind: 'reveal', path: target.path };
}
