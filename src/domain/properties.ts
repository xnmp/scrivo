import { isMap, isScalar, parseDocument } from 'yaml';

export interface Property {
  readonly key: string;
  readonly value: string;
}

export type Properties =
  | { readonly kind: 'none'; readonly entries: readonly [] }
  | { readonly kind: 'invalid'; readonly entries: readonly []; readonly reason: string }
  | { readonly kind: 'ready'; readonly entries: readonly Property[]; readonly unsupported: number };

export interface SourceChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

const MAX_FRONT_MATTER = 256 * 1024;
const MAX_LINES = 1000;
const FENCE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

interface FrontMatter {
  readonly from: number;
  readonly to: number;
  readonly close: number;
  readonly eol: string;
}

function frontMatter(text: string): FrontMatter | 'unclosed' | null {
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const firstEnd = text.indexOf('\n', bom);
  if (firstEnd < 0 || text.slice(bom, firstEnd).replace(/\r$/, '') !== '---') return null;
  let from = firstEnd + 1;
  let line = 1;
  while (from <= text.length && line++ < MAX_LINES && from - firstEnd <= MAX_FRONT_MATTER) {
    const end = text.indexOf('\n', from);
    const lineEnd = end < 0 ? text.length : end;
    if (FENCE.test(text.slice(from, lineEnd).replace(/\r$/, ''))) {
      return { from: firstEnd + 1, to: from, close: from, eol: text.slice(bom, firstEnd).endsWith('\r') ? '\r\n' : '\n' };
    }
    if (end < 0) break;
    from = end + 1;
  }
  return 'unclosed';
}

function parsed(text: string) {
  const bounds = frontMatter(text);
  if (bounds === null || bounds === 'unclosed') return { bounds, document: null } as const;
  const document = parseDocument(text.slice(bounds.from, bounds.to), { uniqueKeys: true });
  return { bounds, document } as const;
}

export function readProperties(text: string): Properties {
  const { bounds, document } = parsed(text);
  if (bounds === null) return { kind: 'none', entries: [] };
  if (bounds === 'unclosed') return { kind: 'invalid', entries: [], reason: 'Front matter has no closing fence.' };
  if (document?.errors.length) return { kind: 'invalid', entries: [], reason: 'Front matter contains invalid YAML.' };
  if (!isMap(document?.contents) && document?.contents !== null) {
    return { kind: 'invalid', entries: [], reason: 'Front matter must be a YAML mapping.' };
  }
  const entries: Property[] = [];
  let unsupported = 0;
  for (const pair of isMap(document?.contents) ? document.contents.items : []) {
    const key = isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : null;
    const value = pair.value;
    const range = isScalar(value) ? value.range : undefined;
    const source = range && text.slice(bounds.from + range[0], bounds.from + range[1]);
    if (key !== null && isScalar(value) && typeof value.value === 'string' && range
      && source !== undefined && !source.includes('\n') && !source.includes('\r')) {
      entries.push({ key, value: value.value });
    } else unsupported++;
  }
  return { kind: 'ready', entries, unsupported };
}

/** Replace one scalar token, keeping its surrounding whitespace, comments, and siblings. */
export function changeProperty(text: string, key: string, value: string): SourceChange | null {
  const { bounds, document } = parsed(text);
  if (!bounds || bounds === 'unclosed' || document?.errors.length || !isMap(document?.contents)) return null;
  const pair = document.contents.items.find((item) => isScalar(item.key) && item.key.value === key);
  if (!pair || !isScalar(pair.value) || typeof pair.value.value !== 'string' || !pair.value.range) return null;
  const [start, end] = pair.value.range;
  const source = text.slice(bounds.from + start, bounds.from + end);
  if (source.includes('\n') || source.includes('\r') || pair.value.value === value) return null;
  return { from: bounds.from + start, to: bounds.from + end, insert: JSON.stringify(value) };
}

/** Add one plain-key string property without reserializing any existing YAML. */
export function addProperty(text: string, key: string, value: string): SourceChange | null {
  if (!KEY.test(key)) return null;
  const { bounds, document } = parsed(text);
  if (bounds === 'unclosed' || document?.errors.length || (document?.contents && !isMap(document.contents))) return null;
  if (isMap(document?.contents) && document.contents.items.some((item) => isScalar(item.key) && item.key.value === key)) return null;
  if (bounds === null) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    return { from: bom, to: bom, insert: `---${eol}${key}: ${JSON.stringify(value)}${eol}---${eol}` };
  }
  return { from: bounds.close, to: bounds.close, insert: `${key}: ${JSON.stringify(value)}${bounds.eol}` };
}
