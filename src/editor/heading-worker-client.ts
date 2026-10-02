import type { Heading } from '../app/ports';

let worker: Worker | undefined;
let requestId = 0;
const requests = new Map<number, { resolve: (headings: readonly Heading[]) => void; reject: (error: Error) => void }>();

/** One worker serves the window's independent document sessions. */
export function indexHeadings(text: string): Promise<readonly Heading[]> {
  if (!worker) {
    const instance = new Worker(new URL('./headings.worker.ts', import.meta.url), { type: 'module' });
    worker = instance;
    instance.onmessage = (event: MessageEvent<{ id: number; headings?: readonly Heading[]; error?: string }>) => {
      if (worker !== instance) return;
      const pending = requests.get(event.data.id);
      requests.delete(event.data.id);
      if (event.data.headings) pending?.resolve(event.data.headings);
      else pending?.reject(new Error(event.data.error ?? 'Could not index headings'));
    };
    instance.onerror = (event) => {
      if (worker !== instance) return;
      instance.terminate();
      worker = undefined;
      for (const pending of requests.values()) pending.reject(new Error(event.message));
      requests.clear();
    };
  }
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    try { worker!.postMessage({ id, text }); }
    catch (error) { requests.delete(id); reject(error); }
  });
}
