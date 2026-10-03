import { describe, expect, it } from 'vitest';
import { compileSubstitutions, defaultSubstitutions, readSubstitutions, substitutionError, type Substitution } from './substitutions';
import { createSubstitutionsStore } from '../platform/substitutions';
const rule = (source: string, replacement: string, regex = false): Substitution => ({ id: 'test', enabled: true, source, replacement, regex });
const match = (value: Substitution, prefix: string) => compileSubstitutions({ enabled: true, rules: [value] })(prefix);
describe('typing substitutions', () => {
  it('matches only suffixes, respects order and never cascades replacements', () => {
    expect(match(rule('abc', 'x'), 'zabc')).toEqual({ from: 1, insert: 'x' });
    expect(match(rule('abc', 'x'), 'abc ')).toBeNull();
    const settings = { enabled: true, rules: [rule('a', 'b'), { ...rule('b', 'c'), id: 'next' }] };
    expect(compileSubstitutions(settings)('a')).toEqual({ from: 0, insert: 'b' });
    expect(compileSubstitutions({ ...settings, enabled: false })('a')).toBeNull();
    expect(match({ ...rule('a', 'b'), enabled: false }, 'a')).toBeNull();
  });
  it('supports capture expansion, case flags, escapes, Unicode and empty replacements', () => {
    expect(match(rule('/(hi)@$/i', '$1\\nWorld', true), 'X HI@')).toEqual({ from: 2, insert: 'HI\nWorld' });
    expect(match(rule('😀a', '✨'), '😀a')).toEqual({ from: 0, insert: '✨' });
    expect(match(rule('zap', ''), 'zap')).toEqual({ from: 0, insert: '' });
    expect(match(rule('a', 'a'), 'a')).toBeNull();
  });
  it('validates malformed regex, unsupported syntax, empty matches and bounds long contexts', () => {
    for (const source of ['', 'abc', '/a/', '/a$/g', '/a$/ii', '/[$/', '/a*$/', '/(?=a)a$/', '/(a)\\1$/']) expect(substitutionError(rule(source, 'x', true))).not.toBeNull();
    expect(match(rule('/(a+)+z$/', 'x', true), 'a'.repeat(100000))).toBeNull();
    expect(match(rule('abc', 'x'), 'a'.repeat(100000) + 'abc')).toEqual({ from: 100000, insert: 'x' });
  });
  it('validates persistent values and preserves explicit empty rule lists', () => {
    for (const raw of [null, '{', 'null', '[]', 'x'.repeat(3 * 1024 * 1024)]) expect(readSubstitutions(raw)).toEqual(defaultSubstitutions);
    expect(readSubstitutions('{"enabled":true,"rules":[]}')).toEqual({ enabled: true, rules: [] });
    expect(readSubstitutions(JSON.stringify({ enabled: true, rules: [rule('a', 'b'), rule('c', 'd'), null, { ...rule('x', 'y'), id: 'long', source: 'x'.repeat(129) }] })).rules).toEqual([rule('a', 'b')]);
  });
  it('persists edits and keeps denied-storage settings usable for the session', () => {
    const values = new Map<string, string>();
    const disk = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const settings = { enabled: false, rules: [rule('abc', 'x')] };
    expect(createSubstitutionsStore(disk).set(settings)).toBe(true); expect(createSubstitutionsStore(disk).get()).toEqual(settings);
    const denied = createSubstitutionsStore({ getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
    expect(denied.set(settings)).toBe(false); expect(denied.get()).toEqual(settings);
    const large = { enabled: true, rules: Array.from({ length: 100 }, (_, index) => ({ ...rule('a', '\u0001'.repeat(2048)), id: String(index) })) };
    expect(createSubstitutionsStore(disk).set(large)).toBe(true); expect(createSubstitutionsStore(disk).get()).toEqual(large);
  });
});
