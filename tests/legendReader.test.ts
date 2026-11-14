import { describe, expect, it } from 'vitest';
import { buildLegendLUT, readLegendValues } from '../src/analyzer/legendReader';
import { paint, solid } from './helpers';

/** A 100×20 colour bar: blue (0) → red (1) across x, with a 10 px white margin top and bottom. */
function bar() {
  return paint(solid(100, 40, [255, 255, 255, 255]), (x, y) => (y >= 10 && y < 30 ? [Math.round((x / 99) * 255), 0, Math.round((1 - x / 99) * 255), 255] : null));
}
const strip = { x0: 0, y0: 0.25, x1: 1, y1: 0.75 };

describe('legend reader', () => {
  it('samples the gradient and assigns values from min to max', () => {
    const lut = buildLegendLUT(bar(), strip, 0, 32, 'rgb', 32);
    expect(lut.values[0]).toBeCloseTo(0.5, 1);
    expect(lut.values[31]).toBeCloseTo(31.5, 1);
    expect(lut.colors[2]).toBeGreaterThan(0.9); // first sample is blue
    expect(lut.colors[31 * 3]).toBeGreaterThan(0.9); // last sample is red
  });

  it('reads values of pixels whose colours are on the bar', () => {
    const lut = buildLegendLUT(bar(), strip, 0, 32, 'rgb');
    const red = readLegendValues(solid(10, 10, [255, 0, 0, 255]), lut);
    const blue = readLegendValues(solid(10, 10, [0, 0, 255, 255]), lut);
    const mid = readLegendValues(solid(10, 10, [128, 0, 127, 255]), lut);
    expect(red.matchedShare).toBe(1);
    expect(red.p50).toBeGreaterThan(30);
    expect(blue.p50).toBeLessThan(2);
    expect(mid.p50).toBeCloseTo(16, 0);
  });

  it('ignores colours that are not on the bar (land, labels, background)', () => {
    const lut = buildLegendLUT(bar(), strip, 0, 32, 'rgb');
    const r = readLegendValues(solid(10, 10, [90, 200, 90, 255]), lut);
    expect(r.matchedShare).toBe(0);
    expect(Number.isNaN(r.p50)).toBe(true);
  });

  it('chroma mode matches dimmed versions of legend colours; rgb mode does not', () => {
    const dimRed = solid(10, 10, [110, 0, 0, 255]);
    expect(readLegendValues(dimRed, buildLegendLUT(bar(), strip, 0, 32, 'chroma')).p50).toBeGreaterThan(30);
    expect(readLegendValues(dimRed, buildLegendLUT(bar(), strip, 0, 32, 'rgb')).matchedShare).toBe(0);
  });

  it('reports the matched share and histogram for mixed frames', () => {
    const lut = buildLegendLUT(bar(), strip, 0, 32, 'rgb');
    const mixed = paint(solid(20, 10, [40, 40, 40, 255]), (x) => (x < 5 ? [255, 0, 0, 255] : null)); // 25% red, rest grey
    const r = readLegendValues(mixed, lut);
    expect(r.matchedShare).toBeCloseTo(0.25, 5);
    expect(r.histogram[7]).toBe(1);
  });

  it('reads vertical bars with high values at the top', () => {
    const v = paint(solid(20, 100, [255, 255, 255, 255]), (x, y) => (x >= 5 && x < 15 ? [Math.round((1 - y / 99) * 255), 0, Math.round((y / 99) * 255), 255] : null));
    const lut = buildLegendLUT(v, { x0: 0.25, y0: 0, x1: 0.75, y1: 1 }, 0, 50, 'rgb');
    expect(readLegendValues(solid(4, 4, [255, 0, 0, 255]), lut).p50).toBeGreaterThan(45);
  });
});
