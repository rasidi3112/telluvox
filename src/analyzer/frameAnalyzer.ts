/**
 * Canvas-based frame analyzer.
 *
 * Draws the displayed frame onto a reusable offscreen canvas at a reduced
 * resolution (sampling strategy: area-averaged downscale by the browser, max
 * `maxSampleWidth` px wide), reads the pixels once, and hands them to the pure
 * feature extractor. Expensive work happens once per *source* frame; callers
 * should cache results (see AnalysisCache).
 */
import { extractFeatures, type PixelBuffer, type VisualFeatures } from './featureExtractor';

export type AnalysisErrorCode = 'missing-image' | 'invalid-dimensions' | 'canvas-unavailable' | 'cross-origin' | 'canvas-error';

export interface AnalysisSuccess {
  ok: true;
  features: VisualFeatures;
  /** The downscaled RGBA pixels that were analyzed (kept for legend reading). */
  pixels: PixelBuffer;
  sourceWidth: number;
  sourceHeight: number;
  sampleWidth: number;
  sampleHeight: number;
  durationMs: number;
}

export interface AnalysisFailure {
  ok: false;
  code: AnalysisErrorCode;
  message: string;
}

export type AnalysisOutcome = AnalysisSuccess | AnalysisFailure;

export interface FrameAnalyzerOptions {
  maxSampleWidth?: number;
  maxSampleHeight?: number;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  const s = src as { width?: unknown; height?: unknown };
  const w = typeof s.width === 'number' ? s.width : 0;
  const h = typeof s.height === 'number' ? s.height : 0;
  return { w, h };
}

export class FrameAnalyzer {
  private canvas: AnyCanvas | null = null;
  private ctx: AnyContext | null = null;
  private readonly maxW: number;
  private readonly maxH: number;

  constructor(options: FrameAnalyzerOptions = {}) {
    this.maxW = options.maxSampleWidth ?? 160;
    this.maxH = options.maxSampleHeight ?? 160;
  }

  private ensureContext(w: number, h: number): AnyContext | null {
    if (!this.canvas) {
      if (typeof OffscreenCanvas !== 'undefined') this.canvas = new OffscreenCanvas(w, h);
      else if (typeof document !== 'undefined') this.canvas = document.createElement('canvas');
      else return null;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as AnyContext | null;
    }
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    return this.ctx;
  }

  analyze(source: CanvasImageSource | null | undefined): AnalysisOutcome {
    const t0 = performance.now();
    if (!source) return { ok: false, code: 'missing-image', message: 'No frame image is available to analyze.' };

    const { w, h } = sourceSize(source);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return { ok: false, code: 'invalid-dimensions', message: `Frame has invalid dimensions (${w}×${h}).` };
    }

    const scale = Math.min(1, this.maxW / w, this.maxH / h);
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));

    const ctx = this.ensureContext(sw, sh);
    if (!ctx) return { ok: false, code: 'canvas-unavailable', message: '2D canvas is not available in this environment.' };

    let pixels: ImageData;
    try {
      ctx.clearRect(0, 0, sw, sh);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(source, 0, 0, sw, sh);
      pixels = ctx.getImageData(0, 0, sw, sh);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        return {
          ok: false,
          code: 'cross-origin',
          message: 'Pixels cannot be read: the image is cross-origin without CORS permission.',
        };
      }
      return { ok: false, code: 'canvas-error', message: `Canvas error: ${err instanceof Error ? err.message : String(err)}` };
    }

    const features = extractFeatures({ data: pixels.data, width: sw, height: sh });
    return {
      ok: true,
      features,
      pixels: { data: pixels.data, width: sw, height: sh },
      sourceWidth: w,
      sourceHeight: h,
      sampleWidth: sw,
      sampleHeight: sh,
      durationMs: performance.now() - t0,
    };
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.ctx = null;
  }
}

/** Caches successful analyses by frame URL so each source frame is analyzed once. */
export class AnalysisCache {
  private map = new Map<string, AnalysisSuccess>();
  get(key: string): AnalysisSuccess | undefined {
    return this.map.get(key);
  }
  set(key: string, value: AnalysisSuccess): void {
    this.map.set(key, value);
  }
  clear(): void {
    this.map.clear();
  }
}
