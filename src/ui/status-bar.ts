import { textStats } from '../domain/stats';

/** Word count in the corner, recomputed when typing pauses. */
export function createStatusBar(host: HTMLElement, getText: () => Iterable<string>, getMode: () => string) {
  const el = document.createElement('div');
  el.className = 'status-bar';
  el.setAttribute('aria-live', 'off');
  host.appendChild(el);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    const { words } = textStats(getText());
    const mode = getMode();
    el.textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}${mode ? ` · ${mode}` : ''}`;
  };

  return {
    /** Schedule an update; cheap to call on every keystroke. */
    update(delayMs = 300) {
      clearTimeout(timer);
      timer = setTimeout(render, delayMs);
    },
  };
}
