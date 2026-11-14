/**
 * Pure feature extraction from RGBA pixel data.
 *
 * No DOM dependency: this module operates on raw pixel buffers so it can be
 * unit-tested in Node. All values describe the *image*, not any physical
 * quantity. Pixel color is not interpreted as temperature (or anything else)
 * unless an official legend establishes that relationship.
 */

import { extractPalette, type PaletteColor } from './palette';
import { analyzeRegions, otsuThreshold, type RegionAnalysis } from './regions';

export type { PaletteColor } from './palette';
export type { Region, RegionAnalysis } from './regions';

export interface PixelBuffer {
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A small, fixed-size luminance grid used to compare consecutive frames. */
export interface FrameSignature {
  cols: number;
  rows: number;
  luma: Float32Array;
  /** Luminance-weighted centroid of the signature grid, 0..1. */
  cx: number;
  cy: number;
}

/** Coarse per-cell colour grid used by the image explorer. */
export interface CellGrid {
  cols: number;
  rows: number;
  /** Mean R,G,B per cell (0..1), row-major, 3 values per cell. */
  rgb: Float32Array;
  /** Mean luminance per cell (0..1). */
  luma: Float32Array;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface VisualFeatures {
  /** Number of opaque pixels analyzed. */
  sampleCount: number;
  /** Mean relative luminance (Rec. 709 weights on sRGB values), 0..1. */
  brightness: number;
  /** Mean channel values, 0..1. */
  meanRGB: RGB;
  /** 12 hue bins of 30° each (bin 0 = red, 4 = green, 8 = blue), weighted by saturation, sums to 1 (all 0 if achromatic). */
  hueHistogram: number[];
  /** Saturation-weighted circular mean hue in degrees, or null if the frame is (near) achromatic. */
  dominantHue: number | null;
  /** Mean HSV saturation, 0..1. */
  meanSaturation: number;
  /** 16 luminance bins, sums to 1. */
  intensityHistogram: number[];
  intensityPercentiles: { p10: number; p50: number; p90: number };
  /** Standard deviation of luminance, 0..0.5. */
  contrast: number;
  /** Mean absolute luminance gradient between neighbouring samples, 0..1. */
  edgeDensity: number;
  /** Combined visual variation index (contrast + edge density), 0..1. */
  variation: number;
  /** Luminance-weighted horizontal centre of mass, 0 (left) .. 1 (right). */
  horizontalCentroid: number;
  /** Luminance-weighted vertical centre of mass, 0 (top) .. 1 (bottom). */
  verticalCentroid: number;
  /** Mean luminance in 8 vertical bands, left to right, 0..1. */
  columnEnergy: number[];
  /** Mean luminance in 8 horizontal bands, top to bottom (latitude bands for global maps), 0..1. */
  rowEnergy: number[];
  /** Dominant colours (deterministic k-means, k = 5), largest first. */
  palette: PaletteColor[];
  /**
   * Warm–cool balance of saturated colour, −1 (all cool hues: green-cyan…violet)
   * to +1 (all warm hues: magenta…yellow). Colour-theory categories only, not temperature.
   */
  warmth: number;
  /** Shannon entropy of the 32-bin luminance histogram, normalized 0..1 (visual complexity). */
  entropy: number;
  /** Foreground shapes (Otsu threshold → connected regions). */
  shapes: RegionAnalysis;
  /** True if there are no opaque pixels or the frame is a single flat value. */
  isEmpty: boolean;
  signature: FrameSignature;
  grid: CellGrid;
}

export interface FrameDifference {
  /** Mean absolute luminance difference between signatures, 0..1. */
  meanAbsDiff: number;
  /** Fraction of signature cells whose luminance changed by more than `threshold`. */
  changedFraction: number;
  /** Index of the frame this was compared with, or null for the first frame. */
  comparedTo: number | null;
  /** Shift of the luminance centroid since the compared frame (fractions of width/height; dy < 0 = moved up). */
  motion: { dx: number; dy: number };
  /** Per-cell absolute change (SIGNATURE_COLS × SIGNATURE_ROWS), or null for the first frame. */
  changeMap: Float32Array | null;
}

export const HUE_BINS = 12;
export const INTENSITY_BINS = 16;
export const COLUMN_BANDS = 8;
export const SIGNATURE_COLS = 32;
export const SIGNATURE_ROWS = 16;
export const ROW_BANDS = 8;
export const GRID_COLS = 16;
export const GRID_ROWS = 8;
const ENTROPY_BINS = 32;
/** Below this luminance σ the frame is treated as flat: no foreground shapes. */
const FLAT_CONTRAST = 0.015;
// Hue bins (30° each) treated as warm / cool for the warmth balance.
const WARM_BINS = [0, 1, 2, 10, 11];
const COOL_BINS = [5, 6, 7, 8, 9];
const ALPHA_THRESHOLD = 8;
const ACHROMATIC_SATURATION = 0.08;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function percentileFromHistogram(hist: Uint32Array, total: number, q: number): number {
  const target = q * total;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i] as number;
    if (acc >= target) return (i + 0.5) / hist.length;
  }
  return 1;
}

export function validatePixelBuffer(buf: PixelBuffer): string | null {
  if (!Number.isInteger(buf.width) || !Number.isInteger(buf.height) || buf.width <= 0 || buf.height <= 0) {
    return `Invalid dimensions ${buf.width}×${buf.height}`;
  }
  if (buf.data.length < buf.width * buf.height * 4) return 'Pixel buffer is smaller than width × height × 4';
  return null;
}

export function extractFeatures(buf: PixelBuffer): VisualFeatures {
  const problem = validatePixelBuffer(buf);
  if (problem) throw new RangeError(problem);

  const { data, width, height } = buf;
  const n = width * height;
  const luma = new Float32Array(n);
  const opaque = new Uint8Array(n);

  const hueWeights = new Float64Array(HUE_BINS);
  const intensityHist = new Uint32Array(INTENSITY_BINS);
  const fineHist = new Uint32Array(256);
  const colSum = new Float64Array(COLUMN_BANDS);
  const colCount = new Uint32Array(COLUMN_BANDS);
  const rowSum = new Float64Array(ROW_BANDS);
  const rowCount = new Uint32Array(ROW_BANDS);
  const gridSum = new Float64Array(GRID_COLS * GRID_ROWS * 4);
  const gridCount = new Uint32Array(GRID_COLS * GRID_ROWS);

  let count = 0;
  let sumR = 0, sumG = 0, sumB = 0, sumL = 0, sumL2 = 0, sumS = 0;
  let wx = 0, wy = 0;
  let hueX = 0, hueY = 0, hueW = 0;
  let minL = 1, maxL = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const o = p * 4;
      if ((data[o + 3] as number) < ALPHA_THRESHOLD) continue;
      opaque[p] = 1;
      const r = (data[o] as number) / 255;
      const g = (data[o + 1] as number) / 255;
      const b = (data[o + 2] as number) / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luma[p] = l;
      count++;
      sumR += r; sumG += g; sumB += b;
      sumL += l; sumL2 += l * l;
      if (l < minL) minL = l;
      if (l > maxL) maxL = l;
      wx += l * (x + 0.5);
      wy += l * (y + 0.5);
      intensityHist[Math.min(INTENSITY_BINS - 1, Math.floor(l * INTENSITY_BINS))]!++;
      fineHist[Math.min(255, Math.round(l * 255))]!++;
      const band = Math.min(COLUMN_BANDS - 1, Math.floor((x / width) * COLUMN_BANDS));
      colSum[band]! += l;
      colCount[band]!++;
      const rband = Math.min(ROW_BANDS - 1, Math.floor((y / height) * ROW_BANDS));
      rowSum[rband]! += l;
      rowCount[rband]!++;
      const gc = Math.min(GRID_COLS - 1, Math.floor((x / width) * GRID_COLS));
      const gr = Math.min(GRID_ROWS - 1, Math.floor((y / height) * GRID_ROWS));
      const gi = gr * GRID_COLS + gc;
      gridSum[gi * 4]! += r;
      gridSum[gi * 4 + 1]! += g;
      gridSum[gi * 4 + 2]! += b;
      gridSum[gi * 4 + 3]! += l;
      gridCount[gi]!++;

      // HSV hue / saturation
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;
      const s = max === 0 ? 0 : chroma / max;
      sumS += s;
      if (chroma > 0 && s >= ACHROMATIC_SATURATION) {
        let h: number;
        if (max === r) h = ((g - b) / chroma) % 6;
        else if (max === g) h = (b - r) / chroma + 2;
        else h = (r - g) / chroma + 4;
        h *= 60;
        if (h < 0) h += 360;
        // Weight by saturation × value so dark, washed-out pixels count less.
        const w = s * max;
        hueWeights[Math.min(HUE_BINS - 1, Math.floor(h / (360 / HUE_BINS)))]! += w;
        const rad = (h * Math.PI) / 180;
        hueX += Math.cos(rad) * w;
        hueY += Math.sin(rad) * w;
        hueW += w;
      }
    }
  }

  const signature = buildSignature(luma, opaque, width, height);
  const grid = buildGrid(gridSum, gridCount);

  if (count === 0) {
    return emptyFeatures(signature, grid);
  }

  const brightness = sumL / count;
  const variance = Math.max(0, sumL2 / count - brightness * brightness);
  const contrast = Math.sqrt(variance);

  // Edge density: mean |dL/dx| + |dL/dy| over opaque neighbours.
  let gradSum = 0, gradCount = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const p = y * width + x;
      if (!opaque[p] || !opaque[p + 1] || !opaque[p + width]) continue;
      gradSum += Math.abs((luma[p + 1] as number) - (luma[p] as number)) + Math.abs((luma[p + width] as number) - (luma[p] as number));
      gradCount++;
    }
  }
  const edgeDensity = gradCount > 0 ? clamp01(gradSum / gradCount) : 0;

  const hueTotal = hueWeights.reduce((a, b) => a + b, 0);
  const hueHistogram = Array.from(hueWeights, (w) => (hueTotal > 0 ? w / hueTotal : 0));
  let dominantHue: number | null = null;
  if (hueW > 0 && hueW / count > 0.01) {
    dominantHue = (Math.atan2(hueY, hueX) * 180) / Math.PI;
    if (dominantHue < 0) dominantHue += 360;
  }

  const isFlat = maxL - minL < 1 / 255 && hueTotal === 0;

  // Entropy of luminance (32 bins from the 256-bin histogram)
  let entropy = 0;
  for (let b = 0; b < ENTROPY_BINS; b++) {
    let c = 0;
    for (let i = b * 8; i < b * 8 + 8; i++) c += fineHist[i] as number;
    if (c > 0) {
      const p = c / count;
      entropy -= p * Math.log2(p);
    }
  }
  entropy /= Math.log2(ENTROPY_BINS);

  // Warm / cool balance of saturated colour
  let warm = 0, cool = 0;
  for (const b of WARM_BINS) warm += hueWeights[b] as number;
  for (const b of COOL_BINS) cool += hueWeights[b] as number;
  const warmth = warm + cool > 1e-6 && (warm + cool) / count > 0.01 ? (warm - cool) / (warm + cool) : 0;

  // Shapes: Otsu threshold (only when the frame has real contrast)
  const thr = contrast >= FLAT_CONTRAST ? otsuThreshold(fineHist, count) : null;
  const shapes = analyzeRegions(luma, opaque, width, height, thr);

  return {
    sampleCount: count,
    brightness,
    meanRGB: { r: sumR / count, g: sumG / count, b: sumB / count },
    hueHistogram,
    dominantHue,
    meanSaturation: sumS / count,
    intensityHistogram: Array.from(intensityHist, (c) => c / count),
    intensityPercentiles: {
      p10: percentileFromHistogram(fineHist, count, 0.1),
      p50: percentileFromHistogram(fineHist, count, 0.5),
      p90: percentileFromHistogram(fineHist, count, 0.9),
    },
    contrast,
    edgeDensity,
    variation: variationIndex(contrast, edgeDensity),
    horizontalCentroid: sumL > 0 ? wx / sumL / width : 0.5,
    verticalCentroid: sumL > 0 ? wy / sumL / height : 0.5,
    columnEnergy: Array.from(colSum, (s, i) => ((colCount[i] as number) > 0 ? s / (colCount[i] as number) : 0)),
    rowEnergy: Array.from(rowSum, (s, i) => ((rowCount[i] as number) > 0 ? s / (rowCount[i] as number) : 0)),
    palette: extractPalette(data, width, height),
    warmth,
    entropy,
    shapes,
    isEmpty: isFlat,
    signature,
    grid,
  };
}

function buildGrid(sum: Float64Array, cnt: Uint32Array): CellGrid {
  const cells = GRID_COLS * GRID_ROWS;
  const rgb = new Float32Array(cells * 3);
  const luma = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    const c = cnt[i] as number;
    if (c === 0) continue;
    rgb[i * 3] = (sum[i * 4] as number) / c;
    rgb[i * 3 + 1] = (sum[i * 4 + 1] as number) / c;
    rgb[i * 3 + 2] = (sum[i * 4 + 2] as number) / c;
    luma[i] = (sum[i * 4 + 3] as number) / c;
  }
  return { cols: GRID_COLS, rows: GRID_ROWS, rgb, luma };
}

/**
 * Combined variation index. Contrast of 0.3 and a mean neighbour gradient of
 * 0.12 each saturate their half of the scale; these reference points were
 * chosen empirically for 160 px-wide analysis grids.
 */
export function variationIndex(contrast: number, edgeDensity: number): number {
  return clamp01(0.5 * clamp01(contrast / 0.3) + 0.5 * clamp01(edgeDensity / 0.12));
}

function emptyFeatures(signature: FrameSignature, grid: CellGrid): VisualFeatures {
  return {
    sampleCount: 0,
    brightness: 0,
    meanRGB: { r: 0, g: 0, b: 0 },
    hueHistogram: new Array(HUE_BINS).fill(0),
    dominantHue: null,
    meanSaturation: 0,
    intensityHistogram: new Array(INTENSITY_BINS).fill(0),
    intensityPercentiles: { p10: 0, p50: 0, p90: 0 },
    contrast: 0,
    edgeDensity: 0,
    variation: 0,
    horizontalCentroid: 0.5,
    verticalCentroid: 0.5,
    columnEnergy: new Array(COLUMN_BANDS).fill(0),
    rowEnergy: new Array(ROW_BANDS).fill(0),
    palette: [],
    warmth: 0,
    entropy: 0,
    shapes: { threshold: null, coverage: 0, count: 0, regions: [], meanElongation: 1, largest: 0 },
    isEmpty: true,
    signature,
    grid,
  };
}

/** Box-average luminance into a fixed SIGNATURE_COLS × SIGNATURE_ROWS grid. */
export function buildSignature(luma: Float32Array, opaque: Uint8Array, width: number, height: number): FrameSignature {
  const cols = SIGNATURE_COLS, rows = SIGNATURE_ROWS;
  const sums = new Float64Array(cols * rows);
  const counts = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(rows - 1, Math.floor((y / height) * rows));
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!opaque[p]) continue;
      const cx = Math.min(cols - 1, Math.floor((x / width) * cols));
      sums[cy * cols + cx]! += luma[p] as number;
      counts[cy * cols + cx]!++;
    }
  }
  const out = new Float32Array(cols * rows);
  let w = 0, wx = 0, wy = 0;
  for (let i = 0; i < out.length; i++) {
    const v = (counts[i] as number) > 0 ? (sums[i] as number) / (counts[i] as number) : 0;
    out[i] = v;
    w += v;
    wx += v * ((i % cols) + 0.5);
    wy += v * (Math.floor(i / cols) + 0.5);
  }
  return { cols, rows, luma: out, cx: w > 0 ? wx / w / cols : 0.5, cy: w > 0 ? wy / w / rows : 0.5 };
}

export function computeFrameDifference(
  previous: FrameSignature | null,
  current: FrameSignature,
  comparedTo: number | null,
  threshold = 0.06,
): FrameDifference {
  if (!previous || previous.cols !== current.cols || previous.rows !== current.rows) {
    return { meanAbsDiff: 0, changedFraction: 0, comparedTo: null, motion: { dx: 0, dy: 0 }, changeMap: null };
  }
  let sum = 0, changed = 0;
  const n = current.luma.length;
  const changeMap = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs((current.luma[i] as number) - (previous.luma[i] as number));
    changeMap[i] = d;
    sum += d;
    if (d > threshold) changed++;
  }
  return {
    meanAbsDiff: n > 0 ? sum / n : 0,
    changedFraction: n > 0 ? changed / n : 0,
    comparedTo,
    motion: { dx: current.cx - previous.cx, dy: current.cy - previous.cy },
    changeMap,
  };
}

export function hueBinName(bin: number): string {
  const names = ['red', 'orange', 'yellow', 'yellow-green', 'green', 'green-cyan', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'rose'];
  return names[((bin % HUE_BINS) + HUE_BINS) % HUE_BINS] as string;
}

export function hueName(deg: number | null): string {
  if (deg === null) return 'neutral (no dominant hue)';
  return hueBinName(Math.floor((((deg % 360) + 360) % 360) / (360 / HUE_BINS)));
}
