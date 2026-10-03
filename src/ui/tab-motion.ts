/** Animate only the bounded tab strip; document selection/closure stays immediate. */
export function createTabMotion(settled: () => void) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map<HTMLElement, { animation: Animation; finish: () => void }>();
  const animate = (item: HTMLElement, frames: Keyframe[], duration: number, finish = () => {}) => {
    running.get(item)?.animation.cancel();
    item.classList.add('tab-moving');
    const animation = item.animate(frames, { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    const complete = () => {
      if (running.get(item)?.animation !== animation) return;
      running.delete(item); item.classList.remove('tab-moving'); finish(); settled();
    };
    running.set(item, { animation, finish: complete });
    void animation.finished.then(complete, () => {});
  };
  preference.addEventListener('change', () => {
    if (!preference.matches) return;
    for (const { animation, finish } of [...running.values()]) { animation.cancel(); finish(); }
  });
  return {
    enter(item: HTMLElement) {
      if (preference.matches) return;
      const style = getComputedStyle(item);
      const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      animate(item, [{ width: '0px', marginRight: `${-border}px`, opacity: 0 },
        { width: style.width, marginRight: '0px', opacity: 1 }], 180);
    },
    exit(item: HTMLElement) {
      // Sample the visible state before canceling a still-opening tab.
      const style = getComputedStyle(item);
      const start = { width: style.width, marginRight: style.marginRight, opacity: style.opacity };
      const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      const select = item.querySelector('[aria-selected]');
      if (select?.getAttribute('aria-selected') === 'true') item.classList.add('tab-was-active');
      select?.removeAttribute('aria-selected');
      item.inert = true; item.setAttribute('aria-hidden', 'true');
      if (preference.matches) { running.get(item)?.animation.cancel(); running.delete(item); item.remove(); return; }
      item.style.width = '0px'; item.style.marginRight = `${-border}px`; item.style.opacity = '0';
      animate(item, [start, { width: '0px', marginRight: `${-border}px`, opacity: 0 }], 140, () => item.remove());
    },
  };
}
