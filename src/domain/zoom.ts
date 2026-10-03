export type ZoomCommand = 'zoomIn' | 'zoomOut' | 'zoomReset';
export const isZoomCommand = (id: string): id is ZoomCommand => ['zoomIn', 'zoomOut', 'zoomReset'].includes(id);

/** Integer percentages avoid rounding drift after repeated opposite commands. */
export function nextZoom(current: number, command: ZoomCommand): number {
  if (command === 'zoomReset') return 100;
  const normalized = Number.isFinite(current) ? Math.round(current / 10) * 10 : 100;
  return Math.min(200, Math.max(50, normalized + (command === 'zoomIn' ? 10 : -10)));
}
