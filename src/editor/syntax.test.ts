import { describe, expect, it } from 'vitest';
import { scrivoMarkdown } from './syntax';

/** `Name[from,to]` for every node of the given names, in document order. */
function nodes(doc: string, ...names: string[]): string[] {
  const out: string[] = [];
  scrivoMarkdown.parser.parse(doc).iterate({
    enter: (n) => {
      if (names.includes(n.name)) out.push(`${n.name}:${doc.slice(n.from, n.to)}`);
    },
  });
  return out;
}

describe('inline math', () => {
  it('parses $...$ with its delimiters', () => {
    expect(nodes('a $x^2$ b', 'InlineMath', 'InlineMathMark')).toEqual([
      'InlineMath:$x^2$',
      'InlineMathMark:$',
      'InlineMathMark:$',
    ]);
  });

  it.each([
    ['prices', 'costs $5 and $10 today'],
    ['space after opening', 'a $ x$ b'],
    ['space before closing', 'a $x $ b'],
    ['empty', 'a $$ b'],
    ['escaped dollar', 'a \\$x$ b'],
    ['unclosed', 'a $x b'],
  ])('does not treat %s as math', (_, doc) => {
    expect(nodes(doc, 'InlineMath')).toEqual([]);
  });

  it('allows escaped dollars inside math', () => {
    expect(nodes('$a\\$b$', 'InlineMath')).toEqual(['InlineMath:$a\\$b$']);
  });

  it('is not parsed inside code spans', () => {
    expect(nodes('`$x$`', 'InlineMath')).toEqual([]);
  });
});

describe('block math', () => {
  it('parses a multi-line block', () => {
    expect(nodes('p\n\n$$\na+b\n$$\n\nq', 'BlockMath')).toEqual(['BlockMath:$$\na+b\n$$']);
  });

  it('parses a single-line block', () => {
    expect(nodes('$$ e=mc^2 $$', 'BlockMath')).toEqual(['BlockMath:$$ e=mc^2 $$']);
  });

  it('runs to the end of the document when unterminated', () => {
    expect(nodes('$$\na\nb', 'BlockMath')).toEqual(['BlockMath:$$\na\nb']);
  });

  it('does not swallow a paragraph that merely starts with $$ text', () => {
    expect(nodes('$$a$$ and more', 'BlockMath')).toEqual([]);
  });

  it('ends with its enclosing blockquote', () => {
    expect(nodes('> $$\n> x\n\nafter', 'BlockMath')).toEqual(['BlockMath:$$\n> x']);
  });
});

describe('front matter', () => {
  it('parses YAML front matter instead of a setext heading', () => {
    const doc = '---\ntitle: x\n---\n# H';
    expect(nodes(doc, 'FrontMatter', 'SetextHeading2', 'ATXHeading1')).toEqual([
      'FrontMatter:---\ntitle: x\n---',
      'ATXHeading1:# H',
    ]);
  });

  it('accepts ... as the closing fence', () => {
    expect(nodes('---\na: 1\n...\n', 'FrontMatter')).toEqual(['FrontMatter:---\na: 1\n...']);
  });

  it('leaves an unterminated leading --- as a horizontal rule', () => {
    expect(nodes('---\ntext', 'FrontMatter', 'HorizontalRule')).toEqual(['HorizontalRule:---']);
  });

  it('only applies at the start of the document', () => {
    expect(nodes('x\n\n---\na: 1\n---\n', 'FrontMatter')).toEqual([]);
  });
});

describe('GFM', () => {
  it('parses tables, task lists and strikethrough', () => {
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~';
    expect(nodes(doc, 'Table', 'TaskMarker', 'Strikethrough')).toEqual([
      'Table:| a | b |\n|---|---|\n| 1 | 2 |',
      'TaskMarker:[x]',
      'Strikethrough:~~gone~~',
    ]);
  });
});
