/**
 * Extract evenly spaced frames from a video file in the browser.
 *
 * Many EIC visualizations are published as animations. This seeks a <video>
 * element to N evenly spaced timestamps, draws each to a canvas and stores it
 * as a lossless PNG object URL, so the rest of the pipeline treats the result
 * exactly like an image sequence. Timestamps are the video's own times.
 */
import type { LocalFrameInput } from './resourceAdapter';

export interface ExtractOptions {
  count: number;
  maxWidth?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ExtractResult {
  frames: LocalFrameInput[];
  width: number;
  height: number;
  duration: number;
}

function once<K extends keyof HTMLVideoElementEventMap>(el: HTMLVideoElement, type: K, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video "${type}".`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('The video could not be decoded by this browser (try MP4/H.264 or WebM).'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(type, onOk);
      el.removeEventListener('error', onErr);
    };
    el.addEventListener(type, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Frame encoding failed.'))), 'image/png'));
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export async function extractVideoFrames(file: File, opts: ExtractOptions): Promise<ExtractResult> {
  const count = Math.max(2, Math.min(240, Math.round(opts.count)));
  const src = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  const made: string[] = [];
  try {
    // Load metadata; retry once, since some browsers occasionally fail the first decode of a fresh blob.
    for (let attempt = 0; ; attempt++) {
      const meta = once(video, 'loadeddata', 20000);
      video.src = src;
      try {
        await meta;
        break;
      } catch (e) {
        if (attempt >= 1) throw e;
        video.removeAttribute('src');
        video.load();
      }
    }
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video has no readable duration.');
    if (video.videoWidth === 0 || video.videoHeight === 0) throw new Error('The video has invalid dimensions.');
    const scale = Math.min(1, (opts.maxWidth ?? 1440) / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available.');

    const frames: LocalFrameInput[] = [];
    for (let i = 0; i < count; i++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // Sample the centre of each of `count` equal slices of the timeline.
      const t = Math.min(duration - 0.001, ((i + 0.5) / count) * duration);
      const seeked = once(video, 'seeked', 15000);
      video.currentTime = t;
      await seeked;
      ctx.drawImage(video, 0, 0, width, height);
      const url = URL.createObjectURL(await canvasToBlob(canvas));
      made.push(url);
      frames.push({ url, label: `${file.name} · ${formatTime(t)}`, timeLabel: `t = ${formatTime(t)}` });
      opts.onProgress?.(i + 1, count);
    }
    return { frames, width, height, duration };
  } catch (e) {
    for (const u of made) URL.revokeObjectURL(u);
    throw e;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(src);
  }
}
