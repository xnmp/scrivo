import { WidgetType, type EditorView } from '@codemirror/view';
import type { Align } from '../../domain/table';
import type { InlineNode } from './inline-ast';
import { renderMath } from './math';

const BULLETS = ['•', '◦', '▪'];

export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  override eq(other: BulletWidget) {
    return other.depth === this.depth;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-lp-bullet';
    el.textContent = BULLETS[this.depth % BULLETS.length]!;
    return el;
  }
}

/** Replaces `[ ]` / `[x]`. Clicking toggles the marker in the source. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-lp-checkbox';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'Completed task' : 'Open task');
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      const current = view.state.sliceDoc(pos + 1, pos + 2);
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: current === ' ' ? 'x' : ' ' },
        userEvent: 'input.toggle-task',
      });
    });
    box.addEventListener('click', (e) => e.preventDefault()); // state comes from the source
    return box;
  }
  override ignoreEvent() {
    return true;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly alt: string,
  ) {
    super();
  }
  override eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(view: EditorView) {
    if (this.src === null) {
      const missing = document.createElement('span');
      missing.className = 'cm-lp-image cm-lp-image-missing';
      missing.textContent = this.alt || 'image';
      missing.title = 'Save the document to resolve relative image paths';
      return missing;
    }
    const img = document.createElement('img');
    img.className = 'cm-lp-image';
    img.alt = this.alt;
    img.src = this.src;
    img.draggable = false;
    img.decoding = 'async';
    img.addEventListener('load', () => view.requestMeasure());
    img.addEventListener('error', () => {
      img.classList.add('cm-lp-image-broken');
      view.requestMeasure();
    });
    return img;
  }
  override get estimatedHeight() {
    return this.src ? 200 : -1;
  }
}

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  override eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-lp-math cm-lp-math-display' : 'cm-lp-math';
    renderMath(el, this.tex, this.display, () => view.requestMeasure());
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

export interface TableModel {
  readonly align: readonly Align[];
  /** Row 0 is the header. */
  readonly rows: readonly (readonly InlineNode[][])[];
}

/**
 * Rendered GFM table. The model is built lazily — only tables scrolled into view pay
 * for it. Clicking a cell hands the caret to that cell's source.
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly model: () => TableModel,
    readonly onCellClick: (view: EditorView, tableFrom: number, row: number, col: number) => void,
    readonly renderInline: (nodes: readonly InlineNode[], parent: HTMLElement, view: EditorView) => void,
  ) {
    super();
  }
  override eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    const { align, rows } = this.model();
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-table-wrap';
    const table = document.createElement('table');
    table.className = 'cm-lp-table';
    const cols = align.length;
    rows.forEach((cells, r) => {
      const section = r === 0 ? table.createTHead() : (table.tBodies[0] ?? table.createTBody());
      const tr = section.insertRow();
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement(r === 0 ? 'th' : 'td');
        const a = align[c];
        if (a) cell.style.textAlign = a;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        this.renderInline(cells[c] ?? [], cell, view);
        tr.appendChild(cell);
      }
    });
    table.addEventListener('mousedown', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('th,td');
      if (!cell || (e.target as HTMLElement).closest('a')) return;
      e.preventDefault();
      this.onCellClick(view, view.posAtDOM(wrap), Number(cell.dataset.row), Number(cell.dataset.col));
    });
    wrap.appendChild(table);
    return wrap;
  }
  override ignoreEvent() {
    return true;
  }
}
