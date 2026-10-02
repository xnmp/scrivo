import { redo, undo, history } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { EditorView, type KeyBinding } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownSupport } from './syntax';
import { formattingKeymap } from './commands';

// --- doc <-> caret/selection markup ---------------------------------------
//
// `|` marks a caret. `⟦...⟧` marks a selection (anchor at `⟦`, head at `⟧`, so
// selection direction is always left-to-right in these fixtures — good enough for
// command tests, which don't depend on anchor/head order). These bracket
// characters were picked because they don't collide with markdown syntax
// (`<`/`>` do, via `<u>` and blockquote's `>`).

function parse(fixture: string): { doc: string; selection: EditorSelection } {
  const ranges: { from: number; to: number }[] = [];
  let doc = '';
  let i = 0;
  while (i < fixture.length) {
    const c = fixture[i];
    if (c === '|') {
      ranges.push({ from: doc.length, to: doc.length });
      i++;
    } else if (c === '⟦') {
      const close = fixture.indexOf('⟧', i);
      if (close === -1) throw new Error(`unclosed selection marker in fixture: ${fixture}`);
      const inner = fixture.slice(i + 1, close);
      ranges.push({ from: doc.length, to: doc.length + inner.length });
      doc += inner;
      i = close + 1;
    } else {
      doc += c;
      i++;
    }
  }
  if (ranges.length === 0) ranges.push({ from: 0, to: 0 });
  return { doc, selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(r.from, r.to))) };
}

function serialize(doc: string, selection: EditorSelection): string {
  const marks: { pos: number; text: string; order: number }[] = [];
  for (const r of selection.ranges) {
    if (r.empty) {
      marks.push({ pos: r.from, text: '|', order: 0 });
    } else {
      marks.push({ pos: r.from, text: '⟦', order: 0 });
      marks.push({ pos: r.to, text: '⟧', order: 1 });
    }
  }
  marks.sort((a, b) => a.pos - b.pos || a.order - b.order);
  let out = '';
  let last = 0;
  for (const m of marks) {
    out += doc.slice(last, m.pos) + m.text;
    last = m.pos;
  }
  out += doc.slice(last);
  return out;
}

function makeState(fixture: string): EditorState {
  const { doc, selection } = parse(fixture);
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdownSupport(), history(), EditorState.allowMultipleSelections.of(true)],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function findBinding(key: string): KeyBinding {
  const binding = formattingKeymap.find((b) => b.key === key);
  if (!binding) throw new Error(`no binding for ${key}`);
  return binding;
}

/** A minimal stand-in for `EditorView` that a `StateCommand` can dispatch through. */
function makeTarget(state: EditorState): { state: EditorState; dispatch: (tr: Transaction) => void; latest(): EditorState } {
  let current = state;
  return {
    get state() {
      return current;
    },
    dispatch: (tr: Transaction) => {
      current = tr.state;
    },
    latest: () => current,
  };
}

/** Runs a keybinding's `run` handler against a fixture state and returns the resulting state. */
function apply(cmd: (view: EditorView) => boolean, state: EditorState): EditorState {
  const target = makeTarget(state);
  cmd(target as unknown as EditorView);
  return target.latest();
}

/** Runs the command bound to `key` against a fixture and returns the resulting fixture. */
function run(key: string, fixture: string): string {
  const state = makeState(fixture);
  const binding = findBinding(key);
  const result = apply(binding.run!, state);
  return serialize(result.doc.toString(), result.selection);
}

describe('inline toggles', () => {
  it('bold wraps a selection', () => {
    expect(run('Mod-b', 'a ⟦word⟧ b')).toBe('a **⟦word⟧** b');
  });

  it('bold unwraps a selection that is already bold', () => {
    expect(run('Mod-b', 'a **⟦word⟧** b')).toBe('a ⟦word⟧ b');
  });

  it('bold unwraps when the selection includes the markers', () => {
    expect(run('Mod-b', 'a ⟦**word**⟧ b')).toBe('a ⟦word⟧ b');
  });

  it('bold on empty selection inside a word applies to (and selects) the whole word', () => {
    expect(run('Mod-b', 'a wo|rd b')).toBe('a **⟦word⟧** b');
  });

  it('bold on empty selection not touching a word inserts empty markers with caret between', () => {
    expect(run('Mod-b', 'a | b')).toBe('a **|** b');
  });

  it('bold with caret at the start of a word wraps that word (caret counts as touching it)', () => {
    expect(run('Mod-b', '|word')).toBe('**⟦word⟧**');
  });

  it('bold with caret at the end of a word wraps that word', () => {
    expect(run('Mod-b', 'word|')).toBe('**⟦word⟧**');
  });

  it('bold on an empty document inserts empty markers with caret between', () => {
    expect(run('Mod-b', '|')).toBe('**|**');
  });

  it('bold via a caret inside a bold word unwraps using the syntax tree, selecting the word', () => {
    expect(run('Mod-b', '**wo|rd**')).toBe('⟦word⟧');
  });

  it('italic wraps a selection', () => {
    expect(run('Mod-i', 'a ⟦word⟧ b')).toBe('a *⟦word⟧* b');
  });

  it('italic does not strip bold from a bold word (it adds emphasis on top)', () => {
    expect(run('Mod-i', 'a **⟦bold⟧** b')).toBe('a ***⟦bold⟧*** b');
  });

  it('italic on triple-emphasis unwraps only the inner single-star marks, leaving bold', () => {
    expect(run('Mod-i', '***⟦both⟧***')).toBe('**⟦both⟧**');
  });

  it('bold on triple-emphasis unwraps only the outer double-star marks, leaving italic', () => {
    expect(run('Mod-b', '***⟦both⟧***')).toBe('*⟦both⟧*');
  });

  it('underline wraps a selection', () => {
    expect(run('Mod-u', 'a ⟦word⟧ b')).toBe('a <u>⟦word⟧</u> b');
  });

  it('underline unwraps a selection that is already underlined', () => {
    expect(run('Mod-u', 'a <u>⟦word⟧</u> b')).toBe('a ⟦word⟧ b');
  });

  it('inline code wraps a selection', () => {
    expect(run('Mod-Shift-`', 'a ⟦word⟧ b')).toBe('a `⟦word⟧` b');
  });

  it('inline code unwraps via the syntax tree from a caret inside it', () => {
    expect(run('Mod-Shift-`', '`wo|rd`')).toBe('⟦word⟧');
  });

  it('strikethrough wraps a selection', () => {
    expect(run('Alt-Shift-5', 'a ⟦word⟧ b')).toBe('a ~~⟦word⟧~~ b');
  });

  it('strikethrough unwraps a selection that is already struck through', () => {
    expect(run('Alt-Shift-5', 'a ~~⟦word⟧~~ b')).toBe('a ⟦word⟧ b');
  });

  it('supports multiple selections, each mapped through its own change', () => {
    expect(run('Mod-b', '⟦one⟧ and ⟦two⟧')).toBe('**⟦one⟧** and **⟦two⟧**');
  });

  it('multiple empty cursors not touching a word each insert their own markers', () => {
    expect(run('Mod-b', 'a | b | c')).toBe('a **|** b **|** c');
  });
});

describe('links', () => {
  it('wraps a text selection as a markdown link with the url placeholder selected', () => {
    expect(run('Mod-k', 'see ⟦this⟧ page')).toBe('see [this](⟦url⟧) page');
  });

  it('turns a URL-like selection into a link with the caret in the brackets', () => {
    expect(run('Mod-k', 'go to ⟦https://example.com⟧ now')).toBe('go to [|](https://example.com) now');
  });

  it('inserts an empty link template at an empty selection', () => {
    expect(run('Mod-k', 'x|y')).toBe('x[](⟦url⟧)y');
  });
});

describe('headings', () => {
  it('Mod-1 sets an h1 on the current line', () => {
    expect(run('Mod-1', 'hel|lo')).toBe('# hel|lo');
  });

  it('pressing the same heading level again reverts to a paragraph', () => {
    expect(run('Mod-1', '# hel|lo')).toBe('hel|lo');
  });

  it('switching heading level replaces the marker cleanly', () => {
    expect(run('Mod-3', '# hel|lo')).toBe('### hel|lo');
  });

  it('Mod-0 converts a heading back to a paragraph', () => {
    expect(run('Mod-0', '## hel|lo')).toBe('hel|lo');
  });

  it('Mod-0 on a paragraph is a no-op', () => {
    expect(run('Mod-0', 'hel|lo')).toBe('hel|lo');
  });

  it('applies to every line touched by a multi-line selection', () => {
    expect(run('Mod-2', '⟦one\ntwo⟧\nthree')).toBe('## ⟦one\n## two⟧\nthree');
  });

  it('increase heading level: paragraph -> h6', () => {
    expect(run('Mod-=', 'hel|lo')).toBe('###### hel|lo');
  });

  it('increase heading level: h6 -> h5 -> ... -> h1, clamped at h1', () => {
    expect(run('Mod-=', '# hel|lo')).toBe('# hel|lo');
    expect(run('Mod-=', '## hel|lo')).toBe('# hel|lo');
  });

  it('decrease heading level: h1 -> h2 -> ... -> h6 -> paragraph', () => {
    expect(run('Mod--', '# hel|lo')).toBe('## hel|lo');
    expect(run('Mod--', '###### hel|lo')).toBe('hel|lo');
  });

  it('decrease heading level on a paragraph is a no-op', () => {
    expect(run('Mod--', 'hel|lo')).toBe('hel|lo');
  });

  it('leaves setext headings alone (treated as plain paragraph text)', () => {
    // Known limitation: setext underlines are not recognised or converted.
    expect(run('Mod-1', 'Title|\n=====')).toBe('# Title|\n=====');
  });
});

describe('blockquote', () => {
  it('quotes all selected lines when none are quoted', () => {
    expect(run('Mod-Shift-q', '⟦one\ntwo⟧')).toBe('> ⟦one\n> two⟧');
  });

  it('unquotes all selected lines when all are quoted', () => {
    expect(run('Mod-Shift-q', '> ⟦one\n> two⟧')).toBe('⟦one\ntwo⟧');
  });

  it('a mix of quoted and unquoted lines is fully quoted (existing ">" is not stacked)', () => {
    expect(run('Mod-Shift-q', '> ⟦one\ntwo⟧')).toBe('> ⟦one\n> two⟧');
  });
});

describe('lists', () => {
  it('turns selected lines into an ordered list', () => {
    expect(run('Mod-Shift-[', '⟦one\ntwo⟧')).toBe('1. ⟦one\n2. two⟧');
  });

  it('turns selected lines into a bullet list', () => {
    expect(run('Mod-Shift-]', '⟦one\ntwo⟧')).toBe('- ⟦one\n- two⟧');
  });

  it('toggling the same list type off removes the markers', () => {
    expect(run('Mod-Shift-[', '1. ⟦one\n2. two⟧')).toBe('⟦one\ntwo⟧');
    expect(run('Mod-Shift-]', '- ⟦one\n- two⟧')).toBe('⟦one\ntwo⟧');
  });

  it('converting bullet to ordered replaces the marker instead of stacking it', () => {
    expect(run('Mod-Shift-[', '- ⟦one\n- two⟧')).toBe('1. ⟦one\n2. two⟧');
  });

  it('converting ordered to bullet replaces the marker instead of stacking it', () => {
    expect(run('Mod-Shift-]', '1. ⟦one\n2. two⟧')).toBe('- ⟦one\n- two⟧');
  });
});

describe('block inserts', () => {
  it('inserts a fenced code block at an empty caret in the middle of a paragraph', () => {
    expect(run('Mod-Shift-k', 'before |after')).toBe('before \n\n```\n|\n```\n\nafter');
  });

  it('inserts a fenced code block at document start', () => {
    expect(run('Mod-Shift-k', '|hello')).toBe('```\n|\n```\n\nhello');
  });

  it('inserts a fenced code block at document end', () => {
    expect(run('Mod-Shift-k', 'hello|')).toBe('hello\n\n```\n|\n```');
  });

  it('fences the selected lines when there is a selection', () => {
    expect(run('Mod-Shift-k', 'before\n⟦code line⟧\nafter')).toBe('before\n\n```\n⟦code line⟧\n```\n\nafter');
  });

  it('inserts a display math block with the caret inside', () => {
    expect(run('Mod-Shift-m', 'before |after')).toBe('before \n\n$$\n|\n$$\n\nafter');
  });

  it('inserts a math block at document start', () => {
    expect(run('Mod-Shift-m', '|hello')).toBe('$$\n|\n$$\n\nhello');
  });

  it('inserts a GFM table with the first header cell selected', () => {
    const result = run('Mod-Shift-t', 'hello|');
    expect(result).toBe('hello\n\n| ⟦Column 1⟧ | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |');
  });

  it('inserts a table at document start', () => {
    const result = run('Mod-Shift-t', '|');
    expect(result).toBe('| ⟦Column 1⟧ | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |');
  });
});

describe('empty document edge cases', () => {
  it('heading commands on an empty document insert the marker', () => {
    expect(run('Mod-1', '|')).toBe('# |');
  });

  it('block inserts on an empty document still produce a valid block', () => {
    expect(run('Mod-Shift-k', '|')).toBe('```\n|\n```');
  });
});

describe('undo', () => {
  it('bold toggle is a single undo step', () => {
    const state = makeState('a ⟦word⟧ b');
    const target = makeTarget(state);
    findBinding('Mod-b').run!(target as unknown as EditorView);
    expect(serialize(target.latest().doc.toString(), target.latest().selection)).toBe('a **⟦word⟧** b');
    expect(undo(target as unknown as EditorView)).toBe(true);
    expect(target.latest().doc.toString()).toBe('a word b');
  });

  it('multi-line list conversion is a single undo step', () => {
    const state = makeState('⟦one\ntwo⟧');
    const target = makeTarget(state);
    findBinding('Mod-Shift-[').run!(target as unknown as EditorView);
    expect(target.latest().doc.toString()).toBe('1. one\n2. two');
    expect(undo(target as unknown as EditorView)).toBe(true);
    expect(target.latest().doc.toString()).toBe('one\ntwo');
  });

  it('redo restores the formatted text', () => {
    const state = makeState('⟦word⟧');
    const target = makeTarget(state);
    findBinding('Mod-i').run!(target as unknown as EditorView);
    expect(target.latest().doc.toString()).toBe('*word*');
    undo(target as unknown as EditorView);
    expect(target.latest().doc.toString()).toBe('word');
    redo(target as unknown as EditorView);
    expect(target.latest().doc.toString()).toBe('*word*');
  });
});
