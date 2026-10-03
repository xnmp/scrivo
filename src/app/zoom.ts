import { nextZoom, type ZoomCommand } from '../domain/zoom';

/** Serialize the native zoom calls without losing rapid repeated keypresses. */
export function createZoomControls(apply: (scale: number) => Promise<void>) {
  let requested = 100, applied = 100, revision = 0;
  let tail = Promise.resolve();
  return {
    change(command: ZoomCommand): Promise<void> {
      requested = nextZoom(requested, command);
      const percent = requested, request = ++revision;
      const result = tail.then(async () => {
        if (percent !== applied) await apply(percent / 100);
        applied = percent;
      }).catch(error => {
        if (request === revision) requested = applied;
        throw error;
      });
      tail = result.catch(() => {});
      return result;
    },
  };
}
