import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, Facet, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { compileSubstitutions, MAX_CONTEXT, type Substitutions, type SubstitutionMatcher } from '../domain/substitutions';

export const substitutionMatcher = Facet.define<SubstitutionMatcher, SubstitutionMatcher>({ combine: values => values.at(-1) ?? (() => null) });
interface Restore { readonly from: number; readonly to: number; readonly text: string }
const remember = StateEffect.define<readonly Restore[]>();
const lastReplacement = StateField.define<readonly Restore[] | null>({
  create: () => null,
  update(value, transaction) {
    const replacement = transaction.effects.find(effect => effect.is(remember));
    if (replacement) return replacement.value;
    return transaction.docChanged || transaction.selection ? null : value;
  },
});
export function typingSubstitutions(settings: Substitutions): Extension {
  const match = compileSubstitutions(settings);
  return [substitutionMatcher.of(match), lastReplacement,
    Prec.highest(keymap.of([{ key: 'Backspace', run(view) {
      const previous = view.state.field(lastReplacement, false);
      if (!previous || view.composing || previous.length !== view.state.selection.ranges.length) return false;
      const changes = previous.map(range => ({ from: range.from, to: range.to, insert: range.text }));
      const mapped = view.state.changes(changes);
      view.dispatch({ changes, selection: view.state.selection.map(mapped),
        userEvent: 'input.substitution.restore', annotations: isolateHistory.of('full') });
      return true;
    } }])),
    EditorView.inputHandler.of((view, _from, _to, text, insert) => {
      if (view.composing || [...text].length !== 1 || text === '\n') return false;
      const typed = insert();
      if (!typed.isUserEvent('input.type') || typed.isUserEvent('input.type.compose')) return false;
      const replacements = typed.newSelection.ranges.flatMap(range => {
        if (!range.empty) return [];
        const start = Math.max(0, range.head - MAX_CONTEXT);
        const prefix = typed.newDoc.sliceString(start, range.head), found = match(prefix);
        return found ? [{ from: start + found.from, to: range.head, insert: found.insert, text: prefix.slice(found.from) }] : [];
      }).sort((a, b) => a.from - b.from);
      if (!replacements.length || replacements.some((range, index) => index > 0 && range.from < replacements[index - 1]!.to)) return false;
      const changes = typed.state.changes(replacements);
      const restored = replacements.map(range => ({ from: changes.mapPos(range.from, -1), to: changes.mapPos(range.to, 1), text: range.text }));
      const replacement = typed.state.update({ changes, selection: typed.newSelection.map(changes), effects: remember.of(restored),
        userEvent: 'input.substitution', annotations: isolateHistory.of('full') });
      view.dispatch([typed, replacement]); return true;
    }),
  ];
}
