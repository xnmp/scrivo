// Markdown editing keys. Reuse CodeMirror's syntax-aware list commands so
// numbering and nested container markers follow the installed parser.
import { deleteCharBackward, indentLess, indentMore, insertNewlineAndIndent } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { foldCode, forceParsing, syntaxTree, unfoldCode } from '@codemirror/language';
import { EditorSelection, type EditorState, type SelectionRange, type Transaction } from '@codemirror/state';
import type { Command, EditorView, KeyBinding } from '@codemirror/view';

function runIsolated(command: Command, state: EditorState): { handled: boolean; transaction: Transaction | null } {
  let transaction: Transaction | null = null;
  const target = { state, dispatch: (next: Transaction) => { transaction = next; } } as EditorView;
  return { handled: command(target), transaction };
}

/**
 * CodeMirror's Markdown commands decline the whole action when one of several
 * cursors is outside markup. Apply each cursor against the evolving document in
 * that case, then compose the changes into one undoable transaction.
 */
function withMixedContexts(primary: Command, fallback: Command, userEvent: string): Command {
  return (target) => {
    if (primary(target)) return true;
    const original = target.state;
    if (original.selection.ranges.length < 2 || original.readOnly) return false;
    let working = original;
    let combined = original.changes([]);
    const selections: Array<SelectionRange | null> = original.selection.ranges.map(() => null);
    let changed = false;

    for (let index = selections.length - 1; index >= 0; index--) {
      const range = original.selection.ranges[index]!;
      const anchor = combined.mapPos(range.anchor, 1);
      const head = combined.mapPos(range.head, 1);
      const local = working.update({ selection: EditorSelection.single(anchor, head) }).state;
      const first = runIsolated(primary, local);
      const transaction = first.handled ? first.transaction : runIsolated(fallback, local).transaction;
      if (!transaction) {
        selections[index] = EditorSelection.range(anchor, head);
        continue;
      }
      changed ||= !transaction.changes.empty;
      for (let later = index + 1; later < selections.length; later++) {
        selections[later] = selections[later]!.map(transaction.changes);
      }
      selections[index] = transaction.state.selection.main;
      combined = combined.compose(transaction.changes);
      working = transaction.state;
    }
    if (!changed) return false;
    target.dispatch(original.update({
      changes: combined,
      selection: EditorSelection.create(selections as SelectionRange[]),
      scrollIntoView: true,
      userEvent,
    }));
    return true;
  };
}

const continueParsedList = withMixedContexts(
  insertNewlineContinueMarkupCommand({ nonTightLists: false }), insertNewlineAndIndent, 'input',
);
const smartBackspace = withMixedContexts(deleteMarkupBackward, deleteCharBackward, 'delete');

const continueList: Command = view => {
  if (view.state.readOnly) return false;
  const upto = view.state.selection.ranges.reduce((furthest, range) => range.empty ? Math.max(furthest, range.to) : furthest, 0);
  // A newly focused position can be beyond the background parser's viewport.
  // Publish a bounded parse before the syntax-aware command reads its context;
  // guessing from line text would turn markers inside code into real lists.
  if (syntaxTree(view.state).length < upto) forceParsing(view, upto, 100);
  return continueParsedList(view);
};

export const markdownEditingKeymap: readonly KeyBinding[] = [
  // An empty list item exits one nesting level instead of creating a loose
  // list. This matches the expected note-taking editor behavior.
  { key: 'Enter', run: continueList },
  { key: 'Backspace', run: smartBackspace },
  { key: 'Tab', run: indentMore, shift: indentLess },
  // The standard fold shortcuts conflict with Scrivo's list-format shortcuts.
  { key: 'Mod-Alt-[', run: foldCode },
  { key: 'Mod-Alt-]', run: unfoldCode },
];
