import type { Heading } from '../app/ports';

/** Coalesce typing, serialize each session's requests, and reject stale results. */
export function createHeadingObserver(options: {
  readonly source: () => string;
  readonly index: (source: string) => Promise<readonly Heading[]>;
  readonly changed: (headings: readonly Heading[]) => void;
  readonly failed: (error: unknown) => void;
}) {
  let version = 0;
  let busy = false;
  let pending = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (disposed || busy || !pending) return;
    busy = true;
    pending = false;
    const requestedVersion = version;
    try {
      const headings = await options.index(options.source());
      if (!disposed && requestedVersion === version) options.changed(headings);
    } catch (error) {
      if (!disposed && requestedVersion === version) options.failed(error);
    } finally {
      busy = false;
      if (!disposed && pending) timer = setTimeout(() => void run(), 0);
    }
  };
  return {
    refresh(delay = 250) {
      version++;
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), delay);
    },
    dispose() { disposed = true; pending = false; clearTimeout(timer); },
  };
}
