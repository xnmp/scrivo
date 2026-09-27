// Accessible fold controls over CodeMirror's syntax-derived fold ranges.
import { codeFolding, foldEffect, foldable, foldedRanges, language, syntaxTree, unfoldEffect } from '@codemirror/language';
import { RangeSet, RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export function foldButtonName(text: string, line: number, expanded: boolean): string {
  const heading = /^\s{0,3}#{1,6}[ \t]+/.test(text);
  const list = /^\s*(?:[-+*]|\d+[.)])[ \t]+/.test(text);
  const label = text
    .replace(/^\s{0,3}#{1,6}[ \t]+/, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/, '')
    .trim()
    .slice(0, 80);
  const kind = heading ? 'heading' : list ? 'list' : 'section';
  return `${expanded ? 'Fold' : 'Unfold'} ${kind}${label ? ` ${label}` : ''} (line ${line})`;
}

class FoldButton extends GutterMarker {
  constructor(readonly line: number, readonly name: string, readonly expanded: boolean) { super(); }

  override eq(other: GutterMarker): boolean {
    return other instanceof FoldButton && other.line === this.line
      && other.name === this.name && other.expanded === this.expanded;
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-fold-toggle';
    button.textContent = this.expanded ? '⌄' : '›';
    button.setAttribute('aria-label', this.name);
    button.setAttribute('aria-expanded', String(this.expanded));
    button.title = this.name;
    button.dataset.line = String(this.line);
    return button;
  }
}

class FoldSpacer extends GutterMarker {
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = '›';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

function foldedOnLine(view: EditorView, from: number, to: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(view.state).between(from, to, (foldFrom, foldTo) => {
    if (!found || found.from > foldFrom) found = { from: foldFrom, to: foldTo };
  });
  return found;
}

function buildMarkers(view: EditorView): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const block of view.viewportLineBlocks) {
    const line = view.state.doc.lineAt(block.from);
    const folded = foldedOnLine(view, line.from, line.to);
    if (!folded && !foldable(view.state, line.from, line.to)) continue;
    builder.add(line.from, line.from, new FoldButton(
      line.number, foldButtonName(line.text, line.number, !folded), !folded,
    ));
  }
  return builder.finish();
}

export function accessibleFoldGutter(): Extension {
  const markers = ViewPlugin.fromClass(class {
    markers: RangeSet<GutterMarker>;
    constructor(view: EditorView) { this.markers = buildMarkers(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged
        || update.startState.facet(language) !== update.state.facet(language)
        || foldedRanges(update.startState) !== foldedRanges(update.state)
        || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.markers = buildMarkers(update.view);
      }
    }
  });

  return [markers, gutter({
    class: 'cm-foldGutter',
    markers: (view) => view.plugin(markers)?.markers ?? RangeSet.empty,
    initialSpacer: () => new FoldSpacer(),
    domEventHandlers: {
      click: (view, block, event) => {
        if (!(event.target instanceof Element) || !event.target.closest('.cm-fold-toggle')) return false;
        const line = view.state.doc.lineAt(block.from);
        const folded = foldedOnLine(view, line.from, line.to);
        const range = folded ?? foldable(view.state, line.from, line.to);
        if (!range) return false;
        const action = folded ? 'Unfolded' : 'Folded';
        view.dispatch({ effects: [
          folded ? unfoldEffect.of(range) : foldEffect.of(range),
          EditorView.announce.of(`${action} ${line.text.trim()} at line ${line.number}`),
        ] });
        view.dom.querySelector<HTMLButtonElement>(`.cm-fold-toggle[data-line="${line.number}"]`)?.focus();
        return true;
      },
    },
  }), codeFolding()];
}
