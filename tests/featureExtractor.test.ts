import { describe, expect, it } from 'vitest';
import {
  computeFrameDifference,
  extractFeatures,
  HUE_BINS,
  INTENSITY_BINS,
} from '../src/analyzer/featureExtractor';
import { noisy, paint, solid } from './helpers';

describe('extractFeatures', () => {
  it('measures a black frame as zero brightness and empty/flat', () => {
    const f = extractFeatures(solid(40, 20, [0, 0, 0, 255]));
    expect(f.brightness).toBe(0);
    expect(f.isEmpty).toBe(true);
    expect(f.dominantHue).toBeNull();
    expect(f.intensityHistogram[0]).toBeCloseTo(1);
  });

  it('measures a white frame as full brightness', () => {
    const f = extractFeatures(solid(40, 20, [255, 255, 255, 255]));
    expect(f.brightness).toBeCloseTo(1, 5);
    expect(f.meanRGB).toEqual({ r: 1, g: 1, b: 1 });
    expect(f.intensityHistogram[INTENSITY_BINS - 1]).toBeCloseTo(1);
    expect(f.contrast).toBeCloseTo(0);
  });

  it('computes average RGB', () => {
    const f = extractFeatures(solid(10, 10, [255, 0, 51, 255]));
    expect(f.meanRGB.r).toBeCloseTo(1);
    expect(f.meanRGB.g).toBeCloseTo(0);
    expect(f.meanRGB.b).toBeCloseTo(0.2);
  });

  it('puts pure hues into the expected histogram bins', () => {
    const red = extractFeatures(solid(10, 10, [255, 0, 0, 255]));
    const green = extractFeatures(solid(10, 10, [0, 255, 0, 255]));
    const blue = extractFeatures(solid(10, 10, [0, 0, 255, 255]));
    expect(red.hueHistogram[0]).toBeCloseTo(1);
    expect(green.hueHistogram[4]).toBeCloseTo(1);
    expect(blue.hueHistogram[8]).toBeCloseTo(1);
    expect(blue.dominantHue).toBeCloseTo(240, 0);
    expect(red.hueHistogram).toHaveLength(HUE_BINS);
  });

  it('splits color distribution by area', () => {
    // left 3/4 blue, right 1/4 red
    const buf = paint(solid(40, 10, [0, 0, 255, 255]), (x) => (x >= 30 ? [255, 0, 0, 255] : null));
    const f = extractFeatures(buf);
    expect(f.hueHistogram[8]).toBeCloseTo(0.75, 2);
    expect(f.hueHistogram[0]).toBeCloseTo(0.25, 2);
  });

  it('ignores transparent pixels', () => {
    const buf = paint(solid(20, 10, [255, 255, 255, 0]), (x) => (x < 10 ? [0, 0, 0, 255] : null));
    const f = extractFeatures(buf);
    expect(f.sampleCount).toBe(100);
    expect(f.brightness).toBe(0);
  });

  it('treats fully transparent frames as empty', () => {
    const f = extractFeatures(solid(8, 8, [255, 255, 255, 0]));
    expect(f.isEmpty).toBe(true);
    expect(f.sampleCount).toBe(0);
  });

  it('locates the horizontal centroid of bright content', () => {
    const left = extractFeatures(paint(solid(100, 20, [0, 0, 0, 255]), (x) => (x < 20 ? [255, 255, 255, 255] : null)));
    const right = extractFeatures(paint(solid(100, 20, [0, 0, 0, 255]), (x) => (x >= 80 ? [255, 255, 255, 255] : null)));
    expect(left.horizontalCentroid).toBeCloseTo(0.1, 2);
    expect(right.horizontalCentroid).toBeCloseTo(0.9, 2);
    expect(left.columnEnergy[0]).toBeGreaterThan(left.columnEnergy[7] as number);
  });

  it('reports higher variation for detailed frames than smooth ones', () => {
    const smooth = extractFeatures(paint(solid(64, 32, [0, 0, 0, 255]), (x) => [x * 4, x * 4, x * 4, 255]));
    const detailed = extractFeatures(noisy(64, 32));
    expect(detailed.variation).toBeGreaterThan(smooth.variation);
    expect(detailed.edgeDensity).toBeGreaterThan(smooth.edgeDensity);
  });

  it('computes intensity percentiles', () => {
    // half black, half white
    const f = extractFeatures(paint(solid(20, 10, [0, 0, 0, 255]), (x) => (x >= 10 ? [255, 255, 255, 255] : null)));
    expect(f.intensityPercentiles.p10).toBeLessThan(0.05);
    expect(f.intensityPercentiles.p90).toBeGreaterThan(0.95);
  });

  it('rejects invalid dimensions', () => {
    expect(() => extractFeatures({ data: new Uint8ClampedArray(0), width: 0, height: 10 })).toThrow(RangeError);
    expect(() => extractFeatures({ data: new Uint8ClampedArray(4), width: 10, height: 10 })).toThrow(RangeError);
  });
});

describe('computeFrameDifference', () => {
  it('is zero for identical frames and positive for changed frames', () => {
    const a = extractFeatures(solid(64, 32, [20, 20, 20, 255]));
    const b = extractFeatures(solid(64, 32, [20, 20, 20, 255]));
    const c = extractFeatures(solid(64, 32, [200, 200, 200, 255]));
    expect(computeFrameDifference(a.signature, b.signature, 0).meanAbsDiff).toBe(0);
    const d = computeFrameDifference(a.signature, c.signature, 0);
    expect(d.meanAbsDiff).toBeGreaterThan(0.5);
    expect(d.changedFraction).toBe(1);
    expect(d.comparedTo).toBe(0);
  });

  it('reports no comparison for the first frame', () => {
    const a = extractFeatures(solid(8, 8, [20, 20, 20, 255]));
    expect(computeFrameDifference(null, a.signature, null)).toMatchObject({ meanAbsDiff: 0, changedFraction: 0, comparedTo: null, changeMap: null });
  });
});
