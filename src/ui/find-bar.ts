// The reading view's find bar: a query field, "n of m", previous/next and close.
// Enter / Shift+Enter step through matches; Escape closes.
import '../styles/find.css';
import type { FindState, Finder } from '../viewer/find';

export interface FindBar {
  /** Show the bar (or focus it if already shown) with its text selected. */
  open(): void;
  /** Hide the bar and its highlights, leaving focus alone. */
  close(): void;
  /** Close as the user would: then focus goes back to the document. */
  dismiss(): void;
  isOpen(): boolean;
  /** Step through matches from outside the field (F3, Mod+G). */
  next(direction: 1 | -1): void;
  /** Search again: the document changed under an open bar. */
  refresh(): void;
}

/** `onDismiss` runs when the user closes the bar (Escape, ✕), to put focus back. */
export function createFindBar(host: HTMLElement, finder: Finder, onDismiss: () => void): FindBar {
  const bar = document.createElement('div');
  bar.className = 'find-bar';
  bar.setAttribute('role', 'search');
  bar.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Find';
  input.setAttribute('aria-label', 'Find in document');
  input.spellcheck = false;

  const count = document.createElement('span');
  count.className = 'find-count';
  count.setAttribute('aria-live', 'polite');

  const button = (label: string, text: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', action);
    return b;
  };

  const show = (s: FindState) => {
    const none = input.value !== '' && s.count === 0;
    bar.classList.toggle('no-match', none);
    count.textContent = input.value === '' ? '' : none ? 'No matches' : `${s.current + 1} of ${s.count}${s.capped ? '+' : ''}`;
  };

  const search = () => show(finder.search(input.value));
  const next = (direction: 1 | -1) => show(finder.next(direction));
  const close = () => {
    bar.hidden = true;
    finder.clear();
  };
  const dismiss = () => {
    if (bar.hidden) return;
    close();
    onDismiss();
  };

  input.addEventListener('input', search);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      next(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    }
  });

  bar.append(input, count, button('Previous match', '↑', () => next(-1)), button('Next match', '↓', () => next(1)), button('Close', '✕', dismiss));
  host.appendChild(bar);

  return {
    open() {
      const wasHidden = bar.hidden;
      bar.hidden = false;
      input.focus();
      input.select();
      if (wasHidden && input.value !== '') search();
    },
    close,
    dismiss,
    isOpen: () => !bar.hidden,
    next(direction) {
      if (!bar.hidden) next(direction);
    },
    refresh() {
      if (!bar.hidden && input.value !== '') search();
    },
  };
}
