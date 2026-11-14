/**
 * Dominant color palette by deterministic k-means in RGB.
 * Initial centres are taken at luminance quantiles (no randomness), so the
 * same frame always yields the same palette.
 */

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
  /** Share of analyzed pixels in this cluster, 0..1. */
  weight: number;
  /** HSV hue in degrees, or null when (near) grey. */
  hue: number | null;
  saturation: number;
  /** Relative luminance 0..1. */
  luminance: number;
}

export function rgbToHsv(r: number, g: number, b: number): { h: number | null; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  const s = max === 0 ? 0 : c / max;
  if (c === 0) return { h: null, s, v: max };
  let h: number;
  if (max === r) h = ((g - b) / c) % 6;
  else if (max === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, v: max };
}

export function extractPalette(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  k = 5,
  iterations = 10,
  stride = 2,
): PaletteColor[] {
  // Collect opaque samples
  const samples: number[] = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const o = (y * width + x) * 4;
      if ((data[o + 3] as number) < 8) continue;
      samples.push((data[o] as number) / 255, (data[o + 1] as number) / 255, (data[o + 2] as number) / 255);
    }
  }
  const n = samples.length / 3;
  if (n === 0) return [];
  const kk = Math.min(k, n);

  // Deterministic init at luminance quantiles
  const order = Array.from({ length: n }, (_, i) => i);
  const lum = (i: number) => 0.2126 * (samples[i * 3] as number) + 0.7152 * (samples[i * 3 + 1] as number) + 0.0722 * (samples[i * 3 + 2] as number);
  order.sort((a, b) => lum(a) - lum(b));
  const centres = new Float64Array(kk * 3);
  for (let c = 0; c < kk; c++) {
    const idx = order[Math.min(n - 1, Math.floor(((c + 0.5) / kk) * n))] as number;
    centres[c * 3] = samples[idx * 3] as number;
    centres[c * 3 + 1] = samples[idx * 3 + 1] as number;
    centres[c * 3 + 2] = samples[idx * 3 + 2] as number;
  }

  const assign = new Uint8Array(n);
  const sums = new Float64Array(kk * 3);
  const counts = new Uint32Array(kk);
  for (let it = 0; it < iterations; it++) {
    sums.fill(0);
    counts.fill(0);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const r = samples[i * 3] as number, g = samples[i * 3 + 1] as number, b = samples[i * 3 + 2] as number;
      let best = 0, bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const dr = r - (centres[c * 3] as number), dg = g - (centres[c * 3 + 1] as number), db = b - (centres[c * 3 + 2] as number);
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) moved++;
      assign[i] = best;
      sums[best * 3]! += r;
      sums[best * 3 + 1]! += g;
      sums[best * 3 + 2]! += b;
      counts[best]!++;
    }
    for (let c = 0; c < kk; c++) {
      const cnt = counts[c] as number;
      if (cnt === 0) continue; // keep previous centre for an empty cluster
      centres[c * 3] = (sums[c * 3] as number) / cnt;
      centres[c * 3 + 1] = (sums[c * 3 + 1] as number) / cnt;
      centres[c * 3 + 2] = (sums[c * 3 + 2] as number) / cnt;
    }
    if (it > 0 && moved === 0) break;
  }

  // Build palette, merging near-identical centres (e.g. flat images)
  const out: PaletteColor[] = [];
  for (let c = 0; c < kk; c++) {
    const cnt = counts[c] as number;
    if (cnt === 0) continue;
    const r = centres[c * 3] as number, g = centres[c * 3 + 1] as number, b = centres[c * 3 + 2] as number;
    const existing = out.find((p) => Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b) < 0.03);
    if (existing) {
      existing.weight += cnt / n;
      continue;
    }
    const hsv = rgbToHsv(r, g, b);
    out.push({
      r,
      g,
      b,
      weight: cnt / n,
      hue: hsv.s < 0.08 ? null : hsv.h,
      saturation: hsv.s,
      luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
    });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

export function paletteToCss(p: PaletteColor): string {
  return `rgb(${Math.round(p.r * 255)}, ${Math.round(p.g * 255)}, ${Math.round(p.b * 255)})`;
}
