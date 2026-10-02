import { icon } from './icons';
import '../styles/outline.css';
import type { Heading } from '../app/ports';

export interface Outline {
  setHeadings(headings: readonly Heading[]): void;
  close(): void;
  toggle(): void;
}

/** A keyboard-accessible table of contents for the active reading or editing document. */
export function createOutline(host: HTMLElement, onNavigate: (heading: Heading) => void, focusDocument: () => void): Outline {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'outline-toggle';
  toggle.append(icon('contents'));
  toggle.setAttribute('aria-label', 'Contents');
  toggle.title = 'Contents';
  toggle.hidden = true;
  toggle.setAttribute('aria-controls', 'outline-panel');
  toggle.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('aside');
  panel.id = 'outline-panel';
  panel.className = 'outline-panel';
  panel.setAttribute('aria-label', 'Contents');
  panel.hidden = true;

  const title = document.createElement('h2');
  title.textContent = 'Contents';
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Document contents');
  const list = document.createElement('ol');
  nav.append(list);
  panel.append(title, nav);
  let headings: readonly Heading[] = [];
  const rows: Array<{ item: HTMLLIElement; button: HTMLButtonElement; heading: Heading }> = [];

  const render = () => {
    const focused = rows.find((row) => row.button === document.activeElement)?.heading;
    for (let index = 0; index < headings.length; index++) {
      const heading = headings[index]!;
      let row = rows[index];
      if (!row) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        row = { item, button, heading };
        const current = row;
        button.addEventListener('click', () => {
          onNavigate(current.heading);
          if (window.matchMedia('(max-width: 900px)').matches) { close(); focusDocument(); }
        });
        item.append(button);
        list.append(item);
        rows.push(row);
      }
      row.heading = heading;
      const className = `outline-level-${Math.min(6, Math.max(1, heading.level))}`;
      if (row.item.className !== className) row.item.className = className;
      if (row.button.textContent !== heading.text) row.button.textContent = heading.text;
      if (row.button.title !== heading.text) row.button.title = heading.text;
      const name = `Heading level ${heading.level}: ${heading.text}`;
      if (row.button.getAttribute('aria-label') !== name) row.button.setAttribute('aria-label', name);
    }
    while (rows.length > headings.length) rows.pop()!.item.remove();
    if (focused) {
      (rows.find((row) => row.heading.id === focused.id)
        ?? rows.find((row) => row.heading.text === focused.text && row.heading.level === focused.level))?.button.focus();
    }
  };

  const close = () => {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    delete document.body.dataset.outline;
  };
  const open = () => {
    render();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.dataset.outline = 'open';
  };

  toggle.addEventListener('click', () => panel.hidden ? open() : close());
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
    toggle.focus();
  });

  host.append(toggle, panel);

  return {
    setHeadings(next) {
      headings = next;
      toggle.hidden = headings.length === 0;
      if (!headings.length) {
        if (panel.contains(document.activeElement)) focusDocument();
        close();
      }
      if (!panel.hidden) render();
    },
    close,
    toggle: () => panel.hidden ? open() : close(),
  };
}
