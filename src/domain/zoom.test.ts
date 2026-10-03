import { describe, expect, it } from 'vitest';
import { nextZoom } from './zoom';

describe('zoom percentages', () => {
  it('uses reversible ten-percent steps and reset', () => {
    expect(nextZoom(100, 'zoomIn')).toBe(110);
    expect(nextZoom(110, 'zoomOut')).toBe(100);
    expect(nextZoom(50, 'zoomReset')).toBe(100);
  });
  it('bounds repeated commands and recovers malformed levels', () => {
    expect(nextZoom(200, 'zoomIn')).toBe(200);
    expect(nextZoom(50, 'zoomOut')).toBe(50);
    expect(nextZoom(Number.NaN, 'zoomIn')).toBe(110);
    expect(nextZoom(Infinity, 'zoomOut')).toBe(90);
  });
});
