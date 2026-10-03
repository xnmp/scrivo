import { describe, expect, it } from 'vitest';
import { createZoomControls } from './zoom';

describe('window zoom commands', () => {
  it('applies rapid commands in order without losing opposite or reset commands', async () => {
    const scales: number[] = [];
    const zoom = createZoomControls(async scale => { scales.push(scale); });
    await Promise.all([zoom.change('zoomIn'), zoom.change('zoomIn'), zoom.change('zoomOut'), zoom.change('zoomReset')]);
    expect(scales).toEqual([1.1, 1.2, 1.1, 1]);
  });
  it('recovers from failed native application using the last successful level', async () => {
    const scales: number[] = [];
    let fail = true;
    const zoom = createZoomControls(async scale => {
      if (fail) { fail = false; throw new Error('native failed'); }
      scales.push(scale);
    });
    await expect(zoom.change('zoomIn')).rejects.toThrow('native failed');
    await zoom.change('zoomOut');
    expect(scales).toEqual([0.9]);
  });
  it('caps repeated presses without applying redundant scales', async () => {
    const scales: number[] = [];
    const zoom = createZoomControls(async scale => { scales.push(scale); });
    await Promise.all(Array.from({ length: 100 }, () => zoom.change('zoomIn')));
    expect(scales.at(-1)).toBe(2);
    expect(scales).toHaveLength(10);
  });
});
