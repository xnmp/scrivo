import { textStats } from '../domain/stats';

export interface StatusBar {
  set(text: string): void;
  readonly element: HTMLElement;
}

/** The small status line in the corner. */
export function createStatusBar(host: HTMLElement): StatusBar {
  const el = document.createElement('div');
  el.className = 'status-bar';
  const words = document.createElement('span');
  el.appendChild(words);
  host.appendChild(el);
  return {
    set(text) {
      words.textContent = text;
    },
    element: el,
  };
}

/** Word count of a document, recomputed when typing pauses. */
export function wordCounter(status: StatusBar, getText: () => Iterable<string>, getMode: () => string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const render = () => {
    const { words } = textStats(getText());
    const mode = getMode();
    status.set(`${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}${mode ? ` · ${mode}` : ''}`);
  };
  return {
    /** Schedule an update; cheap to call on every keystroke. */
    update(delayMs = 300) {
      clearTimeout(timer);
      timer = setTimeout(render, delayMs);
    },
    cancel() { clearTimeout(timer); },
  };
}
