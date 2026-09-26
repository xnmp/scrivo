import { describe, expect, it } from 'vitest';
import { createIdleCallbacks, IDLE_BUDGET_MS } from './idle-callback';

/** A deterministic clock with frames and timers. */
function fakeScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const frames = new Map<number, () => void>();
  return {
    requestAnimationFrame(cb: () => void) {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
    setTimeout(cb: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { at: now + ms, cb });
      return id;
    },
    clearTimeout(id: unknown) {
      timers.delete(id as number);
    },
    now: () => now,
    /** Render a frame, then run timers that are due. */
    frame() {
      const due = [...frames.values()];
      frames.clear();
      due.forEach((cb) => cb());
      this.advance(0);
    },
    advance(ms: number) {
      now += ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) return;
        timers.delete(next[0]);
        next[1].cb();
      }
    },
    spend(ms: number) {
      now += ms;
    },
  };
}

describe('idle callback shim', () => {
  it('runs the callback after the next frame, not before', () => {
    const s = fakeScheduler();
    const { requestIdleCallback } = createIdleCallbacks(s);
    const calls: IdleDeadline[] = [];
    requestIdleCallback((d) => calls.push(d));
    s.advance(100);
    expect(calls).toHaveLength(0);
    s.frame();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.didTimeout).toBe(false);
  });

  it('grants a bounded budget that shrinks as the callback works', () => {
    const s = fakeScheduler();
    const { requestIdleCallback } = createIdleCallbacks(s);
    const remaining: number[] = [];
    requestIdleCallback((d) => {
      remaining.push(d.timeRemaining());
      s.spend(5);
      remaining.push(d.timeRemaining());
      s.spend(100);
      remaining.push(d.timeRemaining());
    });
    s.frame();
    expect(remaining).toEqual([IDLE_BUDGET_MS, IDLE_BUDGET_MS - 5, 0]);
  });

  it('fires with didTimeout when no frame arrives before the timeout', () => {
    const s = fakeScheduler();
    const { requestIdleCallback } = createIdleCallbacks(s);
    const calls: IdleDeadline[] = [];
    requestIdleCallback((d) => calls.push(d), { timeout: 400 });
    s.advance(399);
    expect(calls).toHaveLength(0);
    s.advance(1);
    expect(calls.map((d) => d.didTimeout)).toEqual([true]);
  });

  it('runs each callback once even if both the frame and the timeout come', () => {
    const s = fakeScheduler();
    const { requestIdleCallback } = createIdleCallbacks(s);
    let calls = 0;
    requestIdleCallback(() => calls++, { timeout: 50 });
    s.frame();
    s.advance(1000);
    s.frame();
    expect(calls).toBe(1);
  });

  it('never runs a cancelled callback', () => {
    const s = fakeScheduler();
    const { requestIdleCallback, cancelIdleCallback } = createIdleCallbacks(s);
    let calls = 0;
    const id = requestIdleCallback(() => calls++, { timeout: 50 });
    cancelIdleCallback(id);
    s.frame();
    s.advance(1000);
    expect(calls).toBe(0);
  });

  it('ignores cancelling unknown or already-run ids', () => {
    const s = fakeScheduler();
    const { requestIdleCallback, cancelIdleCallback } = createIdleCallbacks(s);
    let calls = 0;
    const id = requestIdleCallback(() => calls++);
    s.frame();
    expect(() => {
      cancelIdleCallback(id);
      cancelIdleCallback(12345);
    }).not.toThrow();
    expect(calls).toBe(1);
  });

  it('keeps independent callbacks independent', () => {
    const s = fakeScheduler();
    const { requestIdleCallback, cancelIdleCallback } = createIdleCallbacks(s);
    const ran: string[] = [];
    requestIdleCallback(() => ran.push('a'));
    const b = requestIdleCallback(() => ran.push('b'));
    requestIdleCallback(() => ran.push('c'));
    cancelIdleCallback(b);
    s.frame();
    expect(ran).toEqual(['a', 'c']);
  });
});
