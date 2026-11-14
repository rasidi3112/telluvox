/**
 * Legend reader: estimate data values from pixel colours using the
 * publisher's own colour bar.
 *
 *  1. buildLegendLUT samples the colour gradient inside the published
 *     colour-bar image (strip coordinates are set by hand per resource) and
 *     pairs each sampled colour with a value, linearly from min to max.
 *  2. readLegendValues finds, for every analyzed pixel, the closest colour in
 *     that table. Pixels farther than `tolerance` from every legend colour
 *     (land, labels, background) are ignored.
 *
 * Matching modes:
 *  - 'rgb':    plain RGB distance (surfaces drawn with unshaded colour).
 *  - 'chroma': RGB divided by its maximum channel, so dimmed or blended
 *               lines (e.g. flow lines over a dark background) still match
 *               their hue; very dark pixels are skipped.
 *
 * Results are ESTIMATES: shading, blending, compression and resizing all
 * shift colours. The share of matched pixels is always reported.
 */
import type { PixelBuffer } from './featureExtractor';

export type LegendMatchMode = 'rgb' | 'chroma';

export interface LegendStrip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LegendLUT {
  /** r,g,b (0..1) per entry. */
  colors: Float32Array;
  values: Float32Array;
  min: number;
  max: number;
  mode: LegendMatchMode;
}

export interface LegendReading {
  /** Share of opaque pixels whose colour matched the legend. */
  matchedShare: number;
  matchedPixels: number;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  /** 8-bin histogram of matched values over [min, max], sums to 1. */
  histogram: number[];
  min: number;
  max: number;
}

const DARK = 0.12;

function normalize(r: number, g: number, b: number, mode: LegendMatchMode): [number, number, number] {
  if (mode === 'rgb') return [r, g, b];
  const m = Math.max(r, g, b, 1e-6);
  return [r / m, g / m, b / m];
}

/** Sample `samples` colours along the long axis of the strip (averaging its middle half across). */
export function buildLegendLUT(
  img: PixelBuffer,
  strip: LegendStrip,
  min: number,
  max: number,
  mode: LegendMatchMode = 'rgb',
  samples = 64,
): LegendLUT {
  const { data, width, height } = img;
  const x0 = Math.round(strip.x0 * width), x1 = Math.round(strip.x1 * width);
  const y0 = Math.round(strip.y0 * height), y1 = Math.round(strip.y1 * height);
  const horizontal = x1 - x0 >= y1 - y0;
  const colors = new Float32Array(samples * 3);
  const values = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    let r = 0, g = 0, b = 0, n = 0;
    if (horizontal) {
      const x = Math.min(width - 1, Math.floor(x0 + t * (x1 - x0)));
      const ya = Math.floor(y0 + (y1 - y0) * 0.25), yb = Math.ceil(y0 + (y1 - y0) * 0.75);
      for (let y = ya; y <= Math.max(ya, yb - 1); y++) {
        const o = (Math.min(height - 1, y) * width + x) * 4;
        r += data[o] as number; g += data[o + 1] as number; b += data[o + 2] as number; n++;
      }
    } else {
      // Vertical bars: high values at the top.
      const y = Math.min(height - 1, Math.floor(y1 - t * (y1 - y0)));
      const xa = Math.floor(x0 + (x1 - x0) * 0.25), xb = Math.ceil(x0 + (x1 - x0) * 0.75);
      for (let x = xa; x <= Math.max(xa, xb - 1); x++) {
        const o = (y * width + Math.min(width - 1, x)) * 4;
        r += data[o] as number; g += data[o + 1] as number; b += data[o + 2] as number; n++;
      }
    }
    colors[i * 3] = r / n / 255;
    colors[i * 3 + 1] = g / n / 255;
    colors[i * 3 + 2] = b / n / 255;
    values[i] = min + t * (max - min);
  }
  return { colors, values, min, max, mode };
}

export function readLegendValues(pixels: PixelBuffer, lut: LegendLUT, tolerance = 0.12): LegendReading {
  const { data, width, height } = pixels;
  const n = lut.values.length;
  const norm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [a, b, c] = normalize(lut.colors[i * 3] as number, lut.colors[i * 3 + 1] as number, lut.colors[i * 3 + 2] as number, lut.mode);
    norm[i * 3] = a; norm[i * 3 + 1] = b; norm[i * 3 + 2] = c;
  }
  const tol2 = tolerance * tolerance;
  const matched: number[] = [];
  let opaque = 0;
  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    if ((data[o + 3] as number) < 8) continue;
    opaque++;
    const r = (data[o] as number) / 255, g = (data[o + 1] as number) / 255, b = (data[o + 2] as number) / 255;
    if (lut.mode === 'chroma' && Math.max(r, g, b) < DARK) continue;
    const [nr, ng, nb] = normalize(r, g, b, lut.mode);
    let best = -1, bestD = tol2;
    for (let i = 0; i < n; i++) {
      const dr = nr - (norm[i * 3] as number), dg = ng - (norm[i * 3 + 1] as number), db = nb - (norm[i * 3 + 2] as number);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) matched.push(lut.values[best] as number);
  }
  const histogram = new Array(8).fill(0);
  if (matched.length === 0) {
    return { matchedShare: 0, matchedPixels: 0, mean: NaN, p10: NaN, p50: NaN, p90: NaN, histogram, min: lut.min, max: lut.max };
  }
  matched.sort((a, b) => a - b);
  const q = (f: number) => matched[Math.min(matched.length - 1, Math.floor(f * matched.length))] as number;
  const span = lut.max - lut.min || 1;
  let sum = 0;
  for (const v of matched) {
    sum += v;
    histogram[Math.min(7, Math.floor(((v - lut.min) / span) * 8))]++;
  }
  return {
    matchedShare: opaque > 0 ? matched.length / opaque : 0,
    matchedPixels: matched.length,
    mean: sum / matched.length,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    histogram: histogram.map((c) => c / matched.length),
    min: lut.min,
    max: lut.max,
  };
}
