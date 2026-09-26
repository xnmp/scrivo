// When does hidden markdown syntax become visible? Typora's rule: formatting marks show
// while the caret is in (or right next to) the element they belong to.

export interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * An element spanning [from, to] is revealed when any selection range overlaps it or
 * touches either end — so a caret just before `**` or just after it counts.
 */
export const touches = (selection: readonly Span[], from: number, to: number): boolean =>
  selection.some((r) => r.from <= to && r.to >= from);

/**
 * Line prefixes (`# `, `> `) hidden at [from, to) are revealed when the selection
 * reaches into them. A caret exactly at `to` — the start of the visible text, where
 * the user normally types — does not reveal them; a caret at `from` does, because
 * text typed there would land in front of the hidden marker.
 */
export const reachesPrefix = (selection: readonly Span[], from: number, to: number): boolean =>
  selection.some((r) => r.from < to && r.to >= from);
