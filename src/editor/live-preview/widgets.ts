import { WidgetType, type EditorView } from '@codemirror/view';
import { escapeCellPipes, type Align } from '../../domain/table';
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
  readonly sourceCells: readonly (readonly string[])[];
  inlineNodes(row: number, col: number): readonly InlineNode[];
}

export type TableAction =
  | 'insert-row-above' | 'insert-row-below' | 'delete-row'
  | 'move-row-up' | 'move-row-down' | 'sort-ascending' | 'sort-descending'
  | 'insert-column-left' | 'insert-column-right' | 'delete-column'
  | 'move-column-left' | 'move-column-right'
  | 'align-left' | 'align-center' | 'align-right' | 'align-default';

const renderedTables = new WeakMap<HTMLElement, TableWidget>();
const tableMenus = new WeakMap<HTMLElement, () => void>();
const tableAt = (view: EditorView, from: number) =>
  [...view.dom.querySelectorAll<HTMLElement>('.cm-lp-table-wrap')]
    .find((candidate) => view.posAtDOM(candidate) === from);
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Find the source-text caret nearest a click in a rendered cell. */
function caretAtClick(input: HTMLInputElement, clientX: number): number {
  const rect = input.getBoundingClientRect();
  if (input.value.length > 2048) {
    // Measuring many long prefixes on the UI thread makes large cells feel frozen.
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const estimate = Math.round(input.value.length * fraction);
    const segment = graphemes.segment(input.value).containing(Math.min(estimate, input.value.length - 1));
    if (!segment) return input.value.length;
    return estimate - segment.index < segment.segment.length / 2
      ? segment.index : segment.index + segment.segment.length;
  }
  const style = getComputedStyle(input);
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return input.value.length;
  context.font = style.font;
  const width = context.measureText(input.value).width;
  const alignment = style.textAlign;
  const left = alignment === 'right' || alignment === 'end'
    ? rect.width - width
    : alignment === 'center' ? (rect.width - width) / 2 : 0;
  const x = clientX - rect.left - left + input.scrollLeft;
  const boundaries = [0];
  let offset = 0;
  for (const { segment } of graphemes.segment(input.value)) boundaries.push(offset += segment.length);
  let low = 0;
  let high = boundaries.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const midpoint = (context.measureText(input.value.slice(0, boundaries[middle]!)).width
      + context.measureText(input.value.slice(0, boundaries[middle + 1]!)).width) / 2;
    if (x < midpoint) high = middle;
    else low = middle + 1;
  }
  return boundaries[low]!;
}

/**
 * Rendered GFM table. The model is built lazily — only tables scrolled into view pay
 * for it. Inputs write through to the Markdown document, keeping it the source of truth.
 */
export class TableWidget extends WidgetType {
  private cachedModel: TableModel | null = null;
  constructor(
    readonly source: string,
    readonly model: () => TableModel,
    readonly onCellInput: (view: EditorView, tableFrom: number, row: number, col: number, value: string) => void,
    readonly onAppendRow: (view: EditorView, tableFrom: number, rows: number, columns: number) => void,
    readonly onAction: (view: EditorView, tableFrom: number, row: number, col: number, rows: number, columns: number, action: TableAction) => void,
    readonly renderInline: (nodes: readonly InlineNode[], parent: HTMLElement, view: EditorView) => void,
  ) {
    super();
  }
  override eq(other: TableWidget) {
    return other.source === this.source;
  }
  private currentModel(): TableModel {
    return this.cachedModel ??= this.model();
  }
  private renderCell(cell: HTMLElement, row: number, col: number, view: EditorView, nodes = this.currentModel().inlineNodes(row, col)) {
    cell.replaceChildren();
    this.renderInline(nodes, cell, view);
  }

  private activateCell(wrap: HTMLElement, cell: HTMLElement, view: EditorView, activation: 'select' | 'end' | number = 'select') {
    if (cell.querySelector('input')) return;
    const current = renderedTables.get(wrap) ?? this;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const rendered = cell.textContent ?? '';
    const input = document.createElement('input');
    input.className = 'cm-lp-table-input';
    input.type = 'text';
    input.value = current.currentModel().sourceCells[row]?.[col] ?? '';
    input.dataset.source = input.value;
    const header = current.currentModel().sourceCells[0]?.[col]?.trim();
    input.setAttribute('aria-label', `Row ${row + 1}, ${header || `column ${col + 1}`}`);
    cell.replaceChildren(input);
    const write = () => {
      input.dataset.source = escapeCellPipes(input.value).trim();
      (renderedTables.get(wrap) ?? this).onCellInput(view, view.posAtDOM(wrap), row, col, input.value);
    };
    input.addEventListener('input', (event) => { if (!(event as InputEvent).isComposing) write(); });
    input.addEventListener('compositionend', write);
    input.addEventListener('blur', () => (renderedTables.get(wrap) ?? this).renderCell(cell, row, col, view));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cell.focus();
        return;
      }
      if (event.key !== 'Tab' && event.key !== 'Enter' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)) return;
      const { sourceCells: rows, align } = (renderedTables.get(wrap) ?? this).currentModel();
      if (align.length === 0) return;
      const backwards = event.key === 'Tab' && event.shiftKey;
      if (backwards && row === 0 && col === 0) return;
      if (event.key === 'ArrowUp' && row === 0) return;
      if (event.key === 'ArrowDown' && row + 1 >= rows.length) return;
      event.preventDefault();
      const target = event.key === 'ArrowUp' || event.key === 'ArrowDown'
        ? { row: row + (event.key === 'ArrowDown' ? 1 : -1), col }
        : event.key === 'Enter'
          ? { row: row + 1, col }
          : backwards
            ? { row: col === 0 ? row - 1 : row, col: col === 0 ? align.length - 1 : col - 1 }
            : { row: col + 1 === align.length ? row + 1 : row, col: col + 1 === align.length ? 0 : col + 1 };
      const tableFrom = view.posAtDOM(wrap);
      if (target.row >= rows.length) this.onAppendRow(view, tableFrom, rows.length, align.length);
      requestAnimationFrame(() => {
        const currentWrap = tableAt(view, tableFrom);
        const next = currentWrap?.querySelector<HTMLElement>(`[data-row="${target.row}"][data-col="${target.col}"]`);
        if (currentWrap && next) (renderedTables.get(currentWrap) ?? this).activateCell(currentWrap, next, view);
      });
    });
    input.focus();
    if (typeof activation === 'number') {
      // Rendered links and emphasis hide Markdown punctuation. A pixel offset in
      // rendered text cannot safely identify a source position in those cells.
      const offset = rendered === input.value ? caretAtClick(input, activation) : input.value.length;
      input.setSelectionRange(offset, offset);
    } else if (activation === 'end') {
      input.setSelectionRange(input.value.length, input.value.length);
    } else input.select();
  }

  private openMenu(wrap: HTMLElement, cell: HTMLElement, view: EditorView, x: number, y: number) {
    tableMenus.get(wrap)?.();
    const current = renderedTables.get(wrap) ?? this;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const { sourceCells: rows, align } = current.currentModel();
    const menu = document.createElement('div');
    menu.className = 'cm-lp-table-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Table actions');
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 210))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - Math.min(window.innerHeight * 0.7, 480) - 8))}px`;
    const controller = new AbortController();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      controller.abort();
      menu.remove();
      tableMenus.delete(wrap);
    };
    tableMenus.set(wrap, close);
    const groups: readonly (readonly (readonly [TableAction, string, boolean])[])[] = [
      [
        ['insert-row-above', 'Insert row above', row === 0],
        ['insert-row-below', 'Insert row below', false],
        ['delete-row', 'Delete row', row === 0],
        ['move-row-up', 'Move row up', row <= 1],
        ['move-row-down', 'Move row down', row === 0 || row + 1 >= rows.length],
      ],
      [
        ['insert-column-left', 'Insert column left', false],
        ['insert-column-right', 'Insert column right', false],
        ['delete-column', 'Delete column', align.length <= 1],
        ['move-column-left', 'Move column left', col === 0],
        ['move-column-right', 'Move column right', col + 1 >= align.length],
      ],
      [
        ['align-left', 'Align left', align[col] === 'left'],
        ['align-center', 'Align center', align[col] === 'center'],
        ['align-right', 'Align right', align[col] === 'right'],
        ['align-default', 'Clear alignment', align[col] === null],
      ],
      [
        ['sort-ascending', 'Sort ascending', rows.length <= 2],
        ['sort-descending', 'Sort descending', rows.length <= 2],
      ],
    ];
    groups.forEach((actions, group) => {
      if (group > 0) {
        const separator = document.createElement('div');
        separator.setAttribute('role', 'separator');
        menu.appendChild(separator);
      }
      for (const [action, label, disabled] of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener('click', () => {
          const tableFrom = view.posAtDOM(wrap);
          close();
          (renderedTables.get(wrap) ?? this).onAction(view, tableFrom, row, col, rows.length, align.length, action);
          const targetRow = action === 'insert-row-below' || action === 'move-row-down' ? row + 1
            : action === 'move-row-up' ? row - 1
              : action === 'delete-row' ? Math.min(row, rows.length - 2) : row;
          const targetCol = action === 'insert-column-right' || action === 'move-column-right' ? col + 1
            : action === 'move-column-left' ? col - 1
              : action === 'delete-column' ? Math.min(col, align.length - 2) : col;
          const restoreFocus = () => {
            const currentWrap = tableAt(view, tableFrom);
            const target = currentWrap?.querySelector<HTMLElement>(`[data-row="${Math.max(0, targetRow)}"][data-col="${Math.max(0, targetCol)}"]`);
            if (target) { target.focus(); return true; }
            return false;
          };
          if (!restoreFocus()) requestAnimationFrame(() => { if (!restoreFocus()) view.focus(); });
        });
        menu.appendChild(button);
      }
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); cell.focus(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const enabled = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const active = enabled.indexOf(document.activeElement as HTMLButtonElement);
      enabled[(active + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]?.focus();
    });
    menu.addEventListener('focusout', (event) => {
      if (!menu.contains(event.relatedTarget as Node | null)) close();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!menu.contains(event.target as Node)) close();
    }, { capture: true, signal: controller.signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.isConnected) close();
    }, { signal: controller.signal });
    document.body.appendChild(menu);
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  toDOM(view: EditorView) {
    const model = this.currentModel();
    const { align, sourceCells: rows } = model;
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
        cell.tabIndex = 0;
        this.renderInline(model.inlineNodes(r, c), cell, view);
        tr.appendChild(cell);
      }
    });
    table.addEventListener('mousedown', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('th,td');
      if (!cell || (e.target as HTMLElement).closest('a,input')) return;
      e.preventDefault();
      (renderedTables.get(wrap) ?? this).activateCell(wrap, cell, view, e.clientX);
    });
    table.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        const cell = (e.target as HTMLElement).closest<HTMLElement>('th,td');
        if (cell) {
          e.preventDefault();
          const rect = cell.getBoundingClientRect();
          (renderedTables.get(wrap) ?? this).openMenu(wrap, cell, view, rect.left, rect.bottom);
        }
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>('th,td');
      if (!cell) return;
      if (e.key.startsWith('Arrow') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        const targetRow = row + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0);
        const targetCol = col + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
        const next = table.querySelector<HTMLElement>(`[data-row="${targetRow}"][data-col="${targetCol}"]`);
        if (next) { e.preventDefault(); next.focus(); }
        return;
      }
      if (e.key === 'Process' || e.isComposing) {
        (renderedTables.get(wrap) ?? this).activateCell(wrap, cell, view, 'end');
        return;
      }
      if ([...e.key].length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const current = renderedTables.get(wrap) ?? this;
        current.activateCell(wrap, cell, view);
        const input = cell.querySelector<HTMLInputElement>('input');
        if (input) {
          input.value = e.key;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.setSelectionRange(input.value.length, input.value.length);
        }
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      (renderedTables.get(wrap) ?? this).activateCell(wrap, cell, view, 'end');
    });
    table.addEventListener('contextmenu', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('th,td');
      if (!cell) return;
      e.preventDefault();
      (renderedTables.get(wrap) ?? this).openMenu(wrap, cell, view, e.clientX, e.clientY);
    });
    wrap.appendChild(table);
    renderedTables.set(wrap, this);
    return wrap;
  }
  override updateDOM(dom: HTMLElement, view: EditorView, from: this): boolean {
    const next = this.currentModel();
    const previous = from.currentModel();
    const { sourceCells: rows, align } = next;
    const cells = [...dom.querySelectorAll<HTMLElement>('th,td')];
    if (previous.sourceCells.length !== rows.length || previous.align.length !== align.length || cells.length !== rows.length * align.length) return false;
    renderedTables.set(dom, this);
    for (const cell of cells) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      cell.style.textAlign = align[col] ?? '';
      const input = cell.querySelector<HTMLInputElement>('input');
      if (input) {
        if (next.sourceCells[row]?.[col] !== input.dataset.source) {
          if (document.activeElement === input) input.blur();
          else this.renderCell(cell, row, col, view, next.inlineNodes(row, col));
        }
        continue;
      }
      if (next.sourceCells[row]?.[col] !== previous.sourceCells[row]?.[col]) {
        this.renderCell(cell, row, col, view, next.inlineNodes(row, col));
      }
    }
    return true;
  }
  override destroy(dom: HTMLElement) {
    tableMenus.get(dom)?.();
  }
  override ignoreEvent() {
    return true;
  }
}
