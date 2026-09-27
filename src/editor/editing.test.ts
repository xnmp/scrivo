import { history, undo } from '@codemirror/commands';
import { codeFolding, ensureSyntaxTree, foldEffect, foldable, foldedRanges, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownEditingKeymap } from './editing';
import { markdownSupport } from './syntax';

function editor(doc: string, ranges: readonly number[] = [doc.length]) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map((pos) => EditorSelection.cursor(pos))),
    extensions: [markdownSupport(), history(), codeFolding(), EditorState.allowMultipleSelections.of(true)],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const target = {
    get state() { return state; },
    dispatch(tr: Transaction) { state = tr.state; },
  } as EditorView;
  const press = (key: string, shifted = false) => {
    const binding = markdownEditingKeymap.find((item) => item.key === key);
    if (!binding) throw new Error(`missing editing binding: ${key}`);
    return (shifted ? binding.shift : binding.run)?.(target) ?? false;
  };
  return { target, press, text: () => state.doc.toString(), selection: () => state.selection };
}

describe('Markdown list editing', () => {
  it.each([
    ['- first', '- first\n- '],
    ['+ first', '+ first\n+ '],
    ['7. first', '7. first\n8. '],
    ['7) first', '7) first\n8) '],
    ['- [x] done', '- [x] done\n- [ ] '],
  ])('continues the surrounding marker for %s', (before, after) => {
    const e = editor(before);
    expect(e.press('Enter')).toBe(true);
    expect(e.text()).toBe(after);
  });

  it('exits an empty list item instead of making the list loose', () => {
    const e = editor('- first\n- ');
    expect(e.press('Enter')).toBe(true);
    expect(e.text()).toBe('- first\n');
    expect(undo(e.target)).toBe(true);
    expect(e.text()).toBe('- first\n- ');
  });

  it('exits one level of an empty nested item', () => {
    const e = editor('- parent\n  - child\n  - ');
    expect(e.press('Enter')).toBe(true);
    expect(e.text()).toBe('- parent\n  - child\n- ');
  });

  it('renumbers following ordered items in the same undo step', () => {
    const before = '1. one\n2. two\n3. three';
    const e = editor(before, [6]);
    expect(e.press('Enter')).toBe(true);
    expect(e.text()).toBe('1. one\n2. \n3. two\n4. three');
    expect(undo(e.target)).toBe(true);
    expect(e.text()).toBe(before);
  });

  it('Backspace removes a list marker at the content boundary', () => {
    const e = editor('- item', [2]);
    expect(e.press('Backspace')).toBe(true);
    expect(e.text()).toBe('item');
  });

  it('indents and outdents selected list lines without changing their markers', () => {
    const before = '- one\n- two';
    const e = editor(before, [0]);
    e.target.dispatch(e.target.state.update({ selection: EditorSelection.range(0, before.length) }));
    expect(e.press('Tab')).toBe(true);
    expect(e.text()).toBe('  - one\n  - two');
    expect(e.press('Tab', true)).toBe(true);
    expect(e.text()).toBe(before);
  });

  it('continues two list cursors together', () => {
    const before = '- one\n- two';
    const e = editor(before, [5, before.length]);
    expect(e.press('Enter')).toBe(true);
    expect(e.text()).toBe('- one\n- \n- two\n- ');
    expect(e.selection().ranges).toHaveLength(2);
    expect(undo(e.target)).toBe(true);
    expect(e.text()).toBe(before);
  });

  it('continues a list cursor when another cursor is in plain text', () => {
    const before = '- one\nplain';
    const e = editor(before, [5, before.length]);
    expect(e.press('Enter')).toBe(true);
    expect(e.text()).toBe('- one\n- \nplain\n');
    expect(e.selection().ranges).toHaveLength(2);
    expect(undo(e.target)).toBe(true);
    expect(e.text()).toBe(before);
  });

  it('continues a list cursor when another cursor is in a code fence', () => {
    const before = '- one\n```\ncode\n```';
    const e = editor(before, [5, before.indexOf('code') + 4]);
    expect(e.press('Enter')).toBe(true);
    expect(e.text()).toBe('- one\n- \n```\ncode\n\n```');
    expect(e.selection().ranges).toHaveLength(2);
  });

  it('lets Enter fall through inside a fenced code block', () => {
    const before = '```\n- code\n```';
    const e = editor(before, [10]);
    expect(e.press('Enter')).toBe(false);
    expect(e.text()).toBe(before);
  });
});

describe('folding', () => {
  it('folds a heading through nested subheadings but stops at its next peer', () => {
    const text = '# First\nbody\n## Child\nchild text\n# Next\nend';
    const e = editor(text);
    const first = e.target.state.doc.line(1);
    const child = e.target.state.doc.line(3);
    const next = e.target.state.doc.line(5);
    expect(foldable(e.target.state, first.from, first.to)).toEqual({ from: first.to, to: child.to + '\nchild text'.length });
    expect(foldable(e.target.state, child.from, child.to)).toEqual({ from: child.to, to: e.target.state.doc.line(4).to });
    expect(foldable(e.target.state, next.from, next.to)).toEqual({ from: next.to, to: e.target.state.doc.line(6).to });
  });

  it('folds a nested list without changing its Markdown source', () => {
    const text = '- parent\n  - child\n  - second\n- sibling';
    const e = editor(text);
    const line = e.target.state.doc.line(1);
    const range = foldable(e.target.state, line.from, line.to);
    expect(range).toEqual({ from: line.to, to: e.target.state.doc.line(3).to });
    e.target.dispatch(e.target.state.update({ effects: foldEffect.of(range!) }));
    expect(e.text()).toBe(text);
    expect(foldedRanges(e.target.state).size).toBeGreaterThan(0);
  });

  it('does not offer a fold for a lone heading or text that only looks like one in code', () => {
    const e = editor('```\n# code\n```\n\n# Alone');
    const code = e.target.state.doc.line(2);
    const lone = e.target.state.doc.line(5);
    expect(foldable(e.target.state, code.from, code.to)).toBeNull();
    expect(foldable(e.target.state, lone.from, lone.to)).toBeNull();
  });

  it('folds a large section past the incomplete initial parse', () => {
    const content = 'paragraph text.\n\n'.repeat(1000);
    const text = `# Top\n${content}# Next\nend`;
    const state = EditorState.create({ doc: text, extensions: [markdownSupport(), codeFolding()] });
    expect(syntaxTree(state).length).toBeLessThan(text.length);
    const first = state.doc.line(1);
    expect(foldable(state, first.from, first.to)).toEqual({
      from: first.to,
      to: state.doc.lineAt(text.indexOf('# Next') - 1).to,
    });
  });

  it.each([
    ['HTML script block', '<script>\n# fake\n</script>\n\nend', false],
    ['HTML div block', '<div>\n---\n</div>\n\nend', false],
    ['indented code before a rule', '\tTitle\n---\nend', false],
    ['two thematic rules', '---\n---\nend', false],
    ['asterisk rule before a dash rule', '***\n---\nend', false],
    ['nested list heading', '- item\n  ## nested\n  text\n\nend', false],
    ['heading after a nested list', '- item\n  - child\n  ## nested\n# Peer\nend', true],
    ['tab-indented list before a peer', '-\titem\n  ## Peer\nend', true],
    ['mixed-space list before a peer', '- \titem\n   ## Peer\nend', true],
    ['wide list marker before a nested heading', '-     item\n  ## Peer\nend', false],
    ['ordered marker inside a paragraph before a peer', 'paragraph\n2. item\n   ## Peer\nend', true],
    ['Setext peer', 'Peer\n---\nend', true],
    ['invalid backtick fence before a peer', '```a`b\n## Peer\nrest\n```\nend', true],
    ['inline HTML before a peer', 'para\n<custom>\n## Peer\nend', true],
  ])('finds the correct large-section boundary through %s', (_name, tail, peer) => {
    const text = `## Top\n${'para\n\n'.repeat(600)}${tail}`;
    const state = EditorState.create({ doc: text, extensions: [markdownSupport(), codeFolding()] });
    expect(syntaxTree(state).length).toBeLessThan(text.length);
    const first = state.doc.line(1);
    const peerText = tail.includes('## Peer') ? '## Peer' : tail.includes('# Peer') ? '# Peer' : 'Peer\n---';
    const peerLineStart = text.lastIndexOf('\n', text.indexOf(peerText)) + 1;
    const expected = peer ? state.doc.lineAt(peerLineStart - 1).to : text.length;
    expect(foldable(state, first.from, first.to)).toEqual({ from: first.to, to: expected });
  });

  it('does not extend a nested heading fold beyond its parsed list item', () => {
    const text = '- ## Top\n  one\n- ## Peer\n  two\n' + 'para\n\n'.repeat(600);
    const state = EditorState.create({ doc: text, extensions: [markdownSupport(), codeFolding()] });
    const first = state.doc.line(1);
    expect(foldable(state, first.from, first.to)).toEqual({ from: first.to, to: state.doc.line(2).to });
  });
});
