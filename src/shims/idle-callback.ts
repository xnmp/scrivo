// requestIdleCallback for engines without it (WebKit: WKWebView on macOS, WebKitGTK).
//
// CodeMirror parses large documents in the background. Without requestIdleCallback it
// works in 100 ms slices, long enough to swallow keystrokes; with it, each slice is
// bounded by the idle deadline (25 ms at least). @codemirror/language checks for the API
// once when it loads, so this module must be evaluated first (see boot.ts).

/** Idle time granted per callback: what's left of a 60 Hz frame after rendering. */
export const IDLE_BUDGET_MS = 12;

interface Scheduler {
  requestAnimationFrame(cb: () => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  now(): number;
}

type IdleCallbacks = Pick<typeof globalThis, 'requestIdleCallback' | 'cancelIdleCallback'>;

/**
 * An idle callback runs right after the next frame, when the engine has just rendered
 * and input has been handled, with `IDLE_BUDGET_MS` to spend. `timeout` still fires it
 * when no frames come (e.g. the window is hidden).
 */
export function createIdleCallbacks(s: Scheduler): IdleCallbacks {
  const cancels = new Map<number, () => void>();
  let lastId = 0;

  const requestIdleCallback = (callback: IdleRequestCallback, options?: IdleRequestOptions): number => {
    const id = ++lastId;
    let tick: unknown;
    const frame = s.requestAnimationFrame(() => {
      tick = s.setTimeout(() => run(false), 0);
    });
    const timeout = options?.timeout;
    const deadlineTimer = timeout !== undefined && timeout > 0 ? s.setTimeout(() => run(true), timeout) : undefined;
    const cancel = () => {
      cancels.delete(id);
      s.cancelAnimationFrame(frame);
      s.clearTimeout(tick);
      s.clearTimeout(deadlineTimer);
    };
    const run = (didTimeout: boolean) => {
      if (!cancels.has(id)) return;
      cancel();
      const start = s.now();
      callback({ didTimeout, timeRemaining: () => Math.max(0, IDLE_BUDGET_MS - (s.now() - start)) });
    };
    cancels.set(id, cancel);
    return id;
  };

  const cancelIdleCallback = (id: number): void => cancels.get(id)?.();

  return { requestIdleCallback, cancelIdleCallback };
}

if (typeof globalThis.requestIdleCallback !== 'function' && typeof globalThis.requestAnimationFrame === 'function') {
  Object.assign(
    globalThis,
    createIdleCallbacks({
      requestAnimationFrame: (cb) => requestAnimationFrame(cb),
      cancelAnimationFrame: (id) => cancelAnimationFrame(id),
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      now: () => performance.now(),
    }),
  );
}
