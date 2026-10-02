import { describe, expect, it } from 'vitest';
import { addProperty, changeProperty, readProperties, type SourceChange } from './properties';

const apply = (source: string, change: SourceChange | null) => change
  ? source.slice(0, change.from) + change.insert + source.slice(change.to) : source;

describe('YAML properties', () => {
  it('edits one value while retaining comments, key order, and unknown YAML bytes', () => {
    const source = '---\n# before\ntitle: Old  # inline\nunknown: !custom value\nnested:\n  x: [1, 2]\ntags:\n  - a # list comment\n---\n# Body\n';
    const next = apply(source, changeProperty(source, 'title', 'New: "quoted" 😀'));
    expect(next).toBe(source.replace('title: Old', 'title: "New: \\"quoted\\" 😀"'));
    expect(readProperties(next)).toEqual({ kind: 'ready', entries: [{ key: 'title', value: 'New: "quoted" 😀' }], unsupported: 3 });
  });

  it('supports numbers and checkboxes without converting their types', () => {
    const source = '---\nscore: 0x10 # number\ndone: false # bool\ntitle: "true"\n---\n';
    const scored = apply(source, changeProperty(source, 'score', 20));
    const next = apply(scored, changeProperty(scored, 'done', true));
    expect(next).toBe('---\nscore: 20 # number\ndone: true # bool\ntitle: "true"\n---\n');
    expect(readProperties(next)).toEqual({ kind: 'ready', entries: [
      { key: 'score', value: 20 }, { key: 'done', value: true }, { key: 'title', value: 'true' },
    ], unsupported: 0 });
  });

  it('preserves CRLF, BOM, quoted keys, anchors, and the end marker', () => {
    const source = '\ufeff---\r\n"my title": &name \'Old\' # keep\r\nalias: *name\r\n...\r\nBody\r\n';
    const next = apply(source, changeProperty(source, 'my title', 'New'));
    expect(next).toBe(source.replace("'Old'", '"New"'));
    expect(apply(next, addProperty(next, 'author', 'Ada'))).toBe(next.replace('...\r\n', 'author: "Ada"\r\n...\r\n'));
  });

  it('adds a property to empty front matter or a new document', () => {
    expect(apply('---\n---\nBody', addProperty('---\n---\nBody', 'author', 'Ada'))).toBe('---\nauthor: "Ada"\n---\nBody');
    expect(apply('\ufeff# Body\r\n', addProperty('\ufeff# Body\r\n', 'done', false))).toBe('\ufeff---\r\ndone: false\r\n---\r\n# Body\r\n');
    expect(readProperties('Body')).toEqual({ kind: 'none', entries: [] });
  });

  it.each(['---', '---\ntitle: x', '---\ntitle: [bad\n---', '---\na: x\na: y\n---', '---\n- sequence\n---', '---\ntitle: x\n--- trailing'])('leaves malformed front matter untouched: %s', (source) => {
    expect(readProperties(source).kind).toBe('invalid');
    expect(changeProperty(source, 'title', 'new')).toBeNull();
    expect(addProperty(source, 'new', 'value')).toBeNull();
  });

  it('leaves null, multiline, custom tags, aliases, nested maps and lists in source', () => {
    const source = '---\nempty:\nblock: |\n  words\nplain: folded\n  words\ntagged: !!str hi\nalias: &n name\nref: *n\nmap: {x: y}\nlist: [a, b]\n---';
    expect(readProperties(source)).toEqual({ kind: 'ready', entries: [{ key: 'alias', value: 'name' }], unsupported: 7 });
    for (const key of ['empty', 'block', 'plain', 'tagged', 'ref', 'map', 'list']) expect(changeProperty(source, key, 'x')).toBeNull();
  });

  it('rejects stale drafts, duplicate additions, invalid keys, nonfinite and oversized values', () => {
    const source = '---\ntitle: Current\n---\n';
    expect(changeProperty(source, 'title', 'New', 'Old')).toBeNull();
    expect(changeProperty(source, 'title', 'Current')).toBeNull();
    expect(addProperty(source, 'title', 'Duplicate')).toBeNull();
    expect(addProperty(source, 'invalid: key', 'x')).toBeNull();
    expect(addProperty(source, 'num', Number.NaN)).toBeNull();
    expect(changeProperty(source, 'title', 'x'.repeat(65537))).toBeNull();
    expect(addProperty('---\n{title: old}\n---', 'author', 'Ada')).toBeNull();
  });

  it('recomputes positions against the current source after unrelated edits', () => {
    const source = '---\n# a new comment\ntitle: Current\n---\n';
    expect(apply(source, changeProperty(source, 'title', 'New', 'Current'))).toBe(source.replace('Current', '"New"'));
  });

  it('leaves integers beyond exact numeric precision available only in source', () => {
    const source = '---\nid: 9007199254740993\nsmall: 42\n---\n';
    expect(readProperties(source)).toEqual({ kind: 'ready', entries: [{ key: 'small', value: 42 }], unsupported: 1 });
    expect(changeProperty(source, 'id', 4)).toBeNull();
    expect(addProperty(source, 'large', 9007199254740992)).toBeNull();
  });

  it('quotes empty strings, control characters, and YAML-looking text safely', () => {
    for (const value of ['', 'false', '# comment', 'a\tb\u0000', '---', 'a: b']) {
      const source = '---\ntitle: Old\n---\n';
      expect(readProperties(apply(source, changeProperty(source, 'title', value)))).toEqual({ kind: 'ready', entries: [{ key: 'title', value }], unsupported: 0 });
    }
  });

  it('leaves escaped multiline strings in source rather than showing a truncated single-line input', () => {
    const source = '---\ntitle: "first\\nsecond" # keep\n---\n';
    expect(readProperties(source)).toEqual({ kind: 'ready', entries: [], unsupported: 1 });
    expect(changeProperty(source, 'title', 'new')).toBeNull();
  });

  it('bounds oversized or very long front matter without editing it', () => {
    for (const source of ['---\ntitle: ' + 'x'.repeat(270000) + '\n---', '---\n' + '# comment\n'.repeat(1001) + '---']) {
      expect(readProperties(source).kind).toBe('invalid');
      expect(addProperty(source, 'author', 'Ada')).toBeNull();
    }
  });
});
