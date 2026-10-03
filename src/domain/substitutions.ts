import { RE2JS } from 're2js';

export interface Substitution {
  readonly id: string;
  readonly enabled: boolean;
  readonly source: string;
  readonly replacement: string;
  readonly regex: boolean;
}
export interface Substitutions { readonly enabled: boolean; readonly rules: readonly Substitution[] }
export const MAX_RULES = 100;
export const MAX_CONTEXT = 2048;
export const defaultSubstitutions: Substitutions = {
  enabled: true,
  rules: [['-->', '→'], ['<--', '←'], ['!=', '≠'], ['>=', '≥'], ['<=', '≤'], ['+-', '±'], ['1/2', '½']]
    .map(([source, replacement], index) => ({ id: `default-${index}`, source: source!, replacement: replacement!, enabled: true, regex: false })),
};
export function readSubstitutions(raw: string | null): Substitutions {
  // 100 rules with maximally escaped bounded fields remain below this envelope.
  if (!raw || raw.length > 2 * 1024 * 1024) return defaultSubstitutions;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.rules) || value.rules.length > MAX_RULES) return defaultSubstitutions;
    const seen = new Set<string>();
    const rules = value.rules.filter((rule: unknown): rule is Substitution => {
      if (!rule || typeof rule !== 'object') return false;
      const item = rule as Substitution;
      if (typeof item.id !== 'string' || !item.id || item.id.length > 100 || seen.has(item.id)
        || typeof item.source !== 'string' || item.source.length > 128
        || typeof item.replacement !== 'string' || item.replacement.length > 2048
        || typeof item.enabled !== 'boolean' || typeof item.regex !== 'boolean') return false;
      seen.add(item.id); return true;
    });
    return { enabled: value.enabled, rules };
  } catch { return defaultSubstitutions; }
}
export interface SubstitutionMatch { readonly from: number; readonly insert: string }
export type SubstitutionMatcher = (prefix: string) => SubstitutionMatch | null;
export const replacementText = (text: string) => text.replace(/\\([ntb\\])/g, (_, escape: string) => ({ n: '\n', t: '\t', b: '\b', '\\': '\\' })[escape]!);
function compile(rule: Substitution): SubstitutionMatcher {
  if (!rule.source) throw new Error('Enter text to replace.');
  const replacement = replacementText(rule.replacement);
  if (!rule.regex) return prefix => prefix.endsWith(rule.source) ? { from: prefix.length - rule.source.length, insert: replacement } : null;
  const parts = /^\/([\s\S]*)\/([is]*)$/.exec(rule.source);
  if (!parts || !parts[1]!.endsWith('$') || /\\\$$/.test(parts[1]!)) throw new Error('Use /pattern$/ with optional i or s flags.');
  if (new Set(parts[2]).size !== parts[2]!.length) throw new Error('Repeated regex flag.');
  const flags = (parts[2]!.includes('i') ? RE2JS.CASE_INSENSITIVE : 0) | (parts[2]!.includes('s') ? RE2JS.DOTALL : 0);
  // Strict end anchoring prevents a final newline or an alternative from matching earlier text.
  const expression = RE2JS.compile(`(?:${parts[1]!.slice(0, -1)})\\z`, flags);
  if (expression.test('')) throw new Error('Pattern must match non-empty text.');
  return prefix => {
    const match = expression.matcher(prefix);
    if (!match.find() || match.end() !== prefix.length || match.start() === match.end()) return null;
    const from = match.start(), insert = match.replaceFirst(replacement).slice(from);
    return insert.length <= 8192 ? { from, insert } : null;
  };
}
export function substitutionError(rule: Substitution): string | null {
  try { compile(rule); return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
}
/** Ordered, one replacement per typed character; no cascades or document-wide scans. */
export function compileSubstitutions(settings: Substitutions): SubstitutionMatcher {
  const rules = settings.enabled ? settings.rules.flatMap(rule => {
    if (!rule.enabled) return [];
    try { return [compile(rule)]; } catch { return []; }
  }) : [];
  return prefix => {
    const offset = Math.max(0, prefix.length - MAX_CONTEXT), tail = prefix.slice(offset);
    for (const rule of rules) {
      const match = rule(tail);
      if (match && tail.slice(match.from) !== match.insert) return { from: offset + match.from, insert: match.insert };
    }
    return null;
  };
}
