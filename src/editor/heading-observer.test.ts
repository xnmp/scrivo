import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Heading } from '../app/ports';
import { createHeadingObserver } from './heading-observer';

afterEach(() => vi.useRealTimers());
const heading = (text: string): readonly Heading[] => [{ text, id: 'line-1', line: 1, level: 1 }];

describe('asynchronous editing heading updates', () => {
  it('publishes the latest text after a burst of edits', async () => {
    vi.useFakeTimers();
    let source = 'Old';
    const delivered: string[] = [];
    const observer = createHeadingObserver({ source: () => source, index: async (text) => heading(text),
      changed: (headings) => delivered.push(headings[0]!.text), failed: () => {} });
    observer.refresh();
    source = 'New';
    observer.refresh();
    await vi.advanceTimersByTimeAsync(300);
    expect(delivered).toEqual(['New']);
    observer.dispose();
  });

  it('never publishes an in-flight result for a document that has changed', async () => {
    vi.useFakeTimers();
    let source = 'First';
    const pending: Array<{ text: string; resolve: (value: readonly Heading[]) => void }> = [];
    const delivered: string[] = [];
    const observer = createHeadingObserver({ source: () => source,
      index: (text) => new Promise((resolve) => pending.push({ text, resolve })),
      changed: (headings) => delivered.push(headings[0]!.text), failed: () => {} });
    observer.refresh(0);
    await vi.advanceTimersByTimeAsync(0);
    source = 'Replacement';
    observer.refresh(0);
    pending[0]!.resolve(heading('First'));
    await vi.advanceTimersByTimeAsync(1);
    expect(delivered).toEqual([]);
    const latest = pending.at(-1)!;
    latest.resolve(heading(latest.text));
    await vi.advanceTimersByTimeAsync(1);
    expect(delivered).toEqual(['Replacement']);
    observer.dispose();
  });

  it('reports a failed update, retries on new edits, and ignores results after disposal', async () => {
    vi.useFakeTimers();
    let fail = true;
    let resolve!: (value: readonly Heading[]) => void;
    const errors: unknown[] = [];
    const delivered: string[] = [];
    const observer = createHeadingObserver({ source: () => 'Text', index: () => fail
      ? Promise.reject('failed') : new Promise((done) => { resolve = done; }),
      changed: (headings) => delivered.push(headings[0]!.text), failed: (error) => errors.push(error) });
    observer.refresh(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toEqual(['failed']);
    fail = false;
    observer.refresh(0);
    await vi.advanceTimersByTimeAsync(1);
    observer.dispose();
    resolve(heading('Text'));
    await vi.advanceTimersByTimeAsync(1);
    expect(delivered).toEqual([]);
  });
});
