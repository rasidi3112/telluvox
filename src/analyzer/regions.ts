/**
 * Shape analysis: Otsu threshold → foreground mask → connected regions
 * (8-connectivity) with area, centroid, elongation and orientation from
 * second-order image moments.
 */

export interface Region {
  /** Share of analyzed pixels, 0..1. */
  area: number;
  /** Centroid, normalized 0..1 (x right, y down). */
  cx: number;
  cy: number;
  /** sqrt(λ1/λ2) of the pixel covariance: 1 = round/square, larger = elongated. Capped at 10. */
  elongation: number;
  /** Major-axis angle in degrees, −90..90, 0 = horizontal, positive = rising to the right. */
  orientation: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface RegionAnalysis {
  /** Luminance threshold (0..1) separating foreground from background, or null if the frame is too flat. */
  threshold: number | null;
  /** Share of pixels above the threshold ("spatial pixel density"). */
  coverage: number;
  /** Number of regions at or above the minimum size. */
  count: number;
  /** Up to 12 largest regions, largest first. */
  regions: Region[];
  /** Area-weighted mean elongation of the listed regions (1 if none). */
  meanElongation: number;
  /** Area of the largest region, 0..1. */
  largest: number;
}

/** Otsu's method on a 256-bin histogram. Returns threshold in 0..1. */
export function otsuThreshold(hist: ArrayLike<number>, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * (hist[i] as number);
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] as number;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] as number);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return (best + 0.5) / 255;
}

export function analyzeRegions(
  luma: Float32Array,
  opaque: Uint8Array,
  width: number,
  height: number,
  threshold: number | null,
  minFraction = 0.002,
): RegionAnalysis {
  const n = width * height;
  const empty: RegionAnalysis = { threshold, coverage: 0, count: 0, regions: [], meanElongation: 1, largest: 0 };
  if (threshold === null) return empty;

  const mask = new Uint8Array(n);
  let fg = 0, total = 0;
  for (let i = 0; i < n; i++) {
    if (!opaque[i]) continue;
    total++;
    if ((luma[i] as number) > threshold) {
      mask[i] = 1;
      fg++;
    }
  }
  if (total === 0) return empty;

  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const minPx = Math.max(3, Math.round(minFraction * total));
  const found: Region[] = [];
  let count = 0;
  let next = 1;

  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    while (sp > 0) {
      const p = stack[--sp] as number;
      const x = p % width, y = (p - x) / width;
      area++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (mask[q] && !labels[q]) {
            labels[q] = label;
            stack[sp++] = q;
          }
        }
      }
    }
    if (area < minPx) continue;
    count++;
    const mx = sx / area, my = sy / area;
    // Covariance (+1/12 per pixel for the pixel's own extent)
    const cxx = sxx / area - mx * mx + 1 / 12;
    const cyy = syy / area - my * my + 1 / 12;
    const cxy = sxy / area - mx * my;
    const tr = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
    // Image y points down; negate so positive angles rise to the right.
    const theta = -0.5 * Math.atan2(2 * cxy, cxx - cyy);
    found.push({
      area: area / total,
      cx: (mx + 0.5) / width,
      cy: (my + 0.5) / height,
      elongation: Math.min(10, Math.sqrt(l1 / l2)),
      orientation: (theta * 180) / Math.PI,
      bbox: { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height },
    });
  }

  found.sort((a, b) => b.area - a.area);
  const regions = found.slice(0, 12);
  const wsum = regions.reduce((s, r) => s + r.area, 0);
  const meanElongation = wsum > 0 ? regions.reduce((s, r) => s + r.elongation * r.area, 0) / wsum : 1;
  return { threshold, coverage: fg / total, count, regions, meanElongation, largest: regions[0]?.area ?? 0 };
}
