import type { FrameDifference, PixelBuffer } from '../src/analyzer/featureExtractor';
import type { ContinuousParams, NoteParams, SoundOutput, TickParams } from '../src/audio/audioEngine';

export function solid(width: number, height: number, rgba: [number, number, number, number]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { data, width, height };
}

export function paint(
  buf: PixelBuffer,
  fn: (x: number, y: number) => [number, number, number, number] | null,
): PixelBuffer {
  for (let y = 0; y < buf.height; y++)
    for (let x = 0; x < buf.width; x++) {
      const c = fn(x, y);
      if (c) buf.data.set(c, (y * buf.width + x) * 4);
    }
  return buf;
}

/** Deterministic noise image. */
export function noisy(width: number, height: number, seed = 1): PixelBuffer {
  const buf = solid(width, height, [0, 0, 0, 255]);
  let s = seed >>> 0;
  return paint(buf, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = s & 255;
    return [v, v, v, 255];
  });
}

export class FakeOutput implements SoundOutput {
  time = 0;
  running = true;
  notes: NoteParams[] = [];
  ticks: TickParams[] = [];
  continuous: { params: ContinuousParams; at: number }[] = [];
  cancels: number[] = [];
  now() {
    return this.time;
  }
  isRunning() {
    return this.running;
  }
  setContinuous(params: ContinuousParams, at: number) {
    this.continuous.push({ params, at });
  }
  playNote(p: NoteParams) {
    this.notes.push(p);
  }
  playTick(p: TickParams) {
    this.ticks.push(p);
  }
  cancelFrom(time: number) {
    this.cancels.push(time);
    // Emulate the engine: drop voices that have not started yet.
    this.notes = this.notes.filter((n) => n.time < time - 1e-4);
    this.ticks = this.ticks.filter((t) => t.time < time - 1e-4);
  }
}

export const manualTimer = {
  setInterval: () => 1,
  clearInterval: () => {},
};

export function diffOf(partial: Partial<FrameDifference> = {}): FrameDifference {
  return { meanAbsDiff: 0, changedFraction: 0, comparedTo: null, motion: { dx: 0, dy: 0 }, changeMap: null, ...partial };
}

/** Black canvas with filled white rectangles (x0,y0,x1,y1 in pixels, exclusive end). */
export function rects(width: number, height: number, boxes: [number, number, number, number][], color: [number, number, number, number] = [255, 255, 255, 255]): PixelBuffer {
  return paint(solid(width, height, [0, 0, 0, 255]), (x, y) => (boxes.some(([a, b, c, d]) => x >= a && x < c && y >= b && y < d) ? color : null));
}
