import '../styles/outline.css';
import type { Heading } from '../app/ports';

export interface Outline {
  setHeadings(headings: readonly Heading[]): void;
  close(): void;
}

/** A keyboard-accessible table of contents for the current reading document. */
export function createOutline(host: HTMLElement, onNavigate: (id: string) => void, focusDocument: () => void): Outline {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'outline-toggle';
  toggle.textContent = 'Contents';
  toggle.hidden = true;
  toggle.setAttribute('aria-controls', 'outline-panel');
  toggle.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('aside');
  panel.id = 'outline-panel';
  panel.className = 'outline-panel';
  panel.hidden = true;

  const title = document.createElement('h2');
  title.textContent = 'Contents';
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Document contents');
  panel.append(title, nav);

  const close = () => {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    delete document.body.dataset.outline;
  };
  const open = () => {
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
    setHeadings(headings) {
      close();
      toggle.hidden = headings.length === 0;
      const list = document.createElement('ol');
      for (const heading of headings) {
        const item = document.createElement('li');
        item.className = `outline-level-${Math.min(6, Math.max(1, heading.level))}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = heading.text;
        button.title = heading.text;
        button.setAttribute('aria-label', `Heading level ${heading.level}: ${heading.text}`);
        button.addEventListener('click', () => {
          onNavigate(heading.id);
          if (window.matchMedia('(max-width: 900px)').matches) {
            close();
            focusDocument();
          }
        });
        item.appendChild(button);
        list.appendChild(item);
      }
      nav.replaceChildren(list);
    },
    close,
  };
}
