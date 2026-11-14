import { describe, expect, it } from 'vitest';
import { computeFrameDifference, extractFeatures } from '../src/analyzer/featureExtractor';
import { extractPalette } from '../src/analyzer/palette';
import { otsuThreshold } from '../src/analyzer/regions';
import { noisy, paint, rects, solid } from './helpers';

describe('extractPalette', () => {
  it('finds the two colours of a half-red / half-blue frame with their shares', () => {
    const buf = paint(solid(40, 20, [0, 0, 255, 255]), (x) => (x < 20 ? [255, 0, 0, 255] : null));
    const pal = extractPalette(buf.data, buf.width, buf.height);
    expect(pal).toHaveLength(2);
    expect(pal.map((p) => Math.round(p.hue ?? -1)).sort((a, b) => a - b)).toEqual([0, 240]);
    for (const p of pal) expect(p.weight).toBeCloseTo(0.5, 1);
  });

  it('is deterministic and weights sum to 1', () => {
    const buf = noisy(48, 24, 21);
    const a = extractPalette(buf.data, buf.width, buf.height);
    expect(a).toEqual(extractPalette(buf.data, buf.width, buf.height));
    expect(a.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 6);
  });

  it('collapses a flat frame to one colour', () => {
    const buf = solid(16, 16, [40, 200, 90, 255]);
    expect(extractPalette(buf.data, 16, 16)).toHaveLength(1);
  });
});

describe('shape analysis', () => {
  it('otsuThreshold separates a bimodal histogram', () => {
    const h = new Array(256).fill(0);
    h[30] = 500;
    h[220] = 500;
    const t = otsuThreshold(h, 1000) * 255;
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThan(220);
  });

  it('counts separate shapes and measures coverage', () => {
    const f = extractFeatures(rects(100, 50, [[5, 5, 15, 15], [40, 5, 50, 15], [70, 30, 80, 40]]));
    expect(f.shapes.count).toBe(3);
    expect(f.shapes.coverage).toBeCloseTo(300 / 5000, 3);
    expect(f.shapes.regions[0]!.area).toBeCloseTo(100 / 5000, 3);
  });

  it('measures elongation and orientation', () => {
    const h = extractFeatures(rects(120, 60, [[10, 28, 110, 32]])).shapes.regions[0]!;
    expect(h.elongation).toBeGreaterThan(8);
    expect(Math.abs(h.orientation)).toBeLessThan(2);
    const v = extractFeatures(rects(120, 60, [[58, 5, 62, 55]])).shapes.regions[0]!;
    expect(Math.abs(Math.abs(v.orientation) - 90)).toBeLessThan(2);
    const sq = extractFeatures(rects(120, 60, [[50, 20, 70, 40]])).shapes.regions[0]!;
    expect(sq.elongation).toBeCloseTo(1, 1);
  });

  it('reports a rising diagonal with a positive angle', () => {
    // pixels on y = 40 - x/2 (rising to the right on screen)
    const buf = paint(solid(80, 50, [0, 0, 0, 255]), (x, y) => (Math.abs(y - (45 - x / 2)) < 1.5 ? [255, 255, 255, 255] : null));
    const r = extractFeatures(buf).shapes.regions[0]!;
    expect(r.orientation).toBeGreaterThan(15);
    expect(r.orientation).toBeLessThan(40);
  });

  it('finds no shapes in a flat frame', () => {
    const f = extractFeatures(solid(40, 20, [120, 120, 120, 255]));
    expect(f.shapes.threshold).toBeNull();
    expect(f.shapes.count).toBe(0);
  });
});

describe('colour balance, entropy, bands and motion', () => {
  it('warmth is +1 for warm hues and −1 for cool hues', () => {
    expect(extractFeatures(solid(10, 10, [240, 80, 20, 255])).warmth).toBeCloseTo(1);
    expect(extractFeatures(solid(10, 10, [20, 80, 240, 255])).warmth).toBeCloseTo(-1);
    expect(extractFeatures(solid(10, 10, [128, 128, 128, 255])).warmth).toBe(0);
  });

  it('entropy is 0 for a flat frame and high for noise', () => {
    expect(extractFeatures(solid(20, 20, [50, 50, 50, 255])).entropy).toBe(0);
    expect(extractFeatures(noisy(64, 32, 2)).entropy).toBeGreaterThan(0.9);
  });

  it('row energy follows bright latitude bands', () => {
    const f = extractFeatures(rects(64, 64, [[0, 0, 64, 8]]));
    expect(f.rowEnergy[0]).toBeCloseTo(1, 2);
    expect(f.rowEnergy[7]).toBeCloseTo(0, 2);
  });

  it('motion reports the bright centre moving up', () => {
    const low = extractFeatures(rects(64, 32, [[28, 22, 36, 30]]));
    const high = extractFeatures(rects(64, 32, [[28, 2, 36, 10]]));
    const d = computeFrameDifference(low.signature, high.signature, 0);
    expect(d.motion.dy).toBeLessThan(-0.4);
    expect(Math.abs(d.motion.dx)).toBeLessThan(0.02);
    expect(d.changeMap).not.toBeNull();
  });

  it('cell grid holds per-cell colour for the explorer', () => {
    const f = extractFeatures(rects(64, 32, [[0, 0, 4, 4]], [255, 0, 0, 255]));
    expect(f.grid.cols * f.grid.rows).toBe(f.grid.luma.length);
    expect(f.grid.rgb[0]).toBeCloseTo(1);
    expect(f.grid.rgb[1]).toBeCloseTo(0);
  });
});
