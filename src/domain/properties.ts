import { isMap, isScalar, parseDocument, type Pair } from 'yaml';

export type PropertyValue = string | number | boolean;
export interface Property { readonly key: string; readonly value: PropertyValue }
export type Properties =
  | { readonly kind: 'none'; readonly entries: readonly [] }
  | { readonly kind: 'invalid'; readonly entries: readonly []; readonly reason: string }
  | { readonly kind: 'ready'; readonly entries: readonly Property[]; readonly unsupported: number };
export interface SourceChange { readonly from: number; readonly to: number; readonly insert: string }

const MAX_FRONT_MATTER = 256 * 1024;
const MAX_LINES = 1000;
const MAX_VALUE = 64 * 1024;
const FENCE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
interface FrontMatter { readonly from: number; readonly close: number; readonly eol: string }

function frontMatter(text: string): FrontMatter | string | null {
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const firstEnd = text.indexOf('\n', bom);
  const firstLine = text.slice(bom, firstEnd < 0 ? text.length : firstEnd).replace(/\r$/, '');
  if (!/^---[ \t]*$/.test(firstLine)) return null;
  if (firstEnd < 0) return 'Front matter has no closing fence.';
  let from = firstEnd + 1;
  for (let line = 1; line < MAX_LINES; line++) {
    const end = text.indexOf('\n', from);
    const lineEnd = end < 0 ? text.length : end;
    if (lineEnd - firstEnd > MAX_FRONT_MATTER) return 'This front matter is too large for the properties form. Edit it in source.';
    if (FENCE.test(text.slice(from, lineEnd).replace(/\r$/, ''))) {
      return { from: firstEnd + 1, close: from, eol: text[firstEnd - 1] === '\r' ? '\r\n' : '\n' };
    }
    if (end < 0) return 'Front matter has no closing fence.';
    from = end + 1;
  }
  return 'This front matter has too many lines for the properties form. Edit it in source.';
}

function parsed(text: string) {
  const bounds = frontMatter(text);
  if (!bounds || typeof bounds === 'string') return { bounds, document: null } as const;
  return { bounds, document: parseDocument(text.slice(bounds.from, bounds.close), { uniqueKeys: true }) } as const;
}

const validValue = (value: PropertyValue): boolean => typeof value === 'string'
  ? value.length <= MAX_VALUE : typeof value === 'boolean' || (Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)));

function editable(text: string, bounds: FrontMatter, pair: Pair): (Property & { from: number; to: number }) | null {
  if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || !isScalar(pair.value) || !pair.value.range || pair.value.tag) return null;
  const value: unknown = pair.value.value;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  if (!validValue(value)) return null;
  if (typeof value === 'string' && /[\r\n]/.test(value)) return null;
  const [start, end] = pair.value.range;
  const source = text.slice(bounds.from + start, bounds.from + end);
  if (source.includes('\n') || source.includes('\r') || pair.value.type === 'BLOCK_LITERAL' || pair.value.type === 'BLOCK_FOLDED') return null;
  return { key: pair.key.value, value, from: bounds.from + start, to: bounds.from + end };
}

export function readProperties(text: string): Properties {
  const { bounds, document } = parsed(text);
  if (!bounds) return { kind: 'none', entries: [] };
  if (typeof bounds === 'string') return { kind: 'invalid', entries: [], reason: bounds };
  if (document?.errors.length) return { kind: 'invalid', entries: [], reason: 'Front matter contains invalid YAML. Edit it in source.' };
  if (!isMap(document?.contents) && document?.contents !== null) {
    return { kind: 'invalid', entries: [], reason: 'Front matter must be a YAML mapping. Edit it in source.' };
  }
  const entries: Property[] = [];
  let unsupported = 0;
  for (const pair of isMap(document?.contents) ? document.contents.items : []) {
    const property = editable(text, bounds, pair);
    if (property) entries.push({ key: property.key, value: property.value });
    else unsupported++;
  }
  return { kind: 'ready', entries, unsupported };
}

/** Replace only a scalar token. An optional expected value protects a stale form draft. */
export function changeProperty(text: string, key: string, value: PropertyValue, expected?: PropertyValue): SourceChange | null {
  if (!validValue(value)) return null;
  const { bounds, document } = parsed(text);
  if (!bounds || typeof bounds === 'string' || document?.errors.length || !isMap(document?.contents)) return null;
  const pair = document.contents.items.find((item) => isScalar(item.key) && item.key.value === key);
  const property = pair && editable(text, bounds, pair);
  if (!property || (expected !== undefined && !Object.is(property.value, expected)) || Object.is(property.value, value)) return null;
  return { from: property.from, to: property.to, insert: JSON.stringify(value) };
}

/** Add a scalar property without serializing existing YAML. */
export function addProperty(text: string, key: string, value: PropertyValue): SourceChange | null {
  if (!KEY.test(key) || !validValue(value)) return null;
  const { bounds, document } = parsed(text);
  if (typeof bounds === 'string' || document?.errors.length || (document?.contents && !isMap(document.contents))) return null;
  if (isMap(document?.contents) && (document.contents.flow || document.contents.tag)) return null;
  if (isMap(document?.contents) && document.contents.items.some((item) => isScalar(item.key) && item.key.value === key)) return null;
  if (bounds === null) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    return { from: bom, to: bom, insert: `---${eol}${key}: ${JSON.stringify(value)}${eol}---${eol}` };
  }
  return { from: bounds.close, to: bounds.close, insert: `${key}: ${JSON.stringify(value)}${bounds.eol}` };
}
