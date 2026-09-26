// KaTeX is loaded on first use: documents without math never pay for it.
type Katex = typeof import('katex').default;

let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
    katex = m.default;
    return katex;
  });
  return loading;
}

/** Render `tex` into `el`, now if KaTeX is loaded, otherwise once it is. */
export function renderMath(el: HTMLElement, tex: string, display: boolean, onAsyncRender: () => void): void {
  const render = (k: Katex) => {
    try {
      k.render(tex, el, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
    } catch (e) {
      el.textContent = tex;
      el.title = e instanceof Error ? e.message : String(e);
      el.classList.add('cm-lp-math-error');
    }
  };
  if (katex) {
    render(katex);
    return;
  }
  el.textContent = tex;
  el.classList.add('cm-lp-math-pending');
  loadKatex().then(
    (k) => {
      el.classList.remove('cm-lp-math-pending');
      render(k);
      onAsyncRender();
    },
    () => el.classList.add('cm-lp-math-error'),
  );
}
