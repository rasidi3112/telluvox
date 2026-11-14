/**
 * Frame-based visualization player.
 *
 * Framework-agnostic and clock-injectable so it can be driven by the Web Audio
 * clock (AudioContext.currentTime) when audio is running, or by
 * performance.now() otherwise. Frame boundaries are kept on an exact grid
 * (start += duration) so the audio phrase for each frame can be scheduled at
 * the same instant the frame begins.
 *
 * The player does not render anything; call `tick()` from a
 * requestAnimationFrame loop.
 */

export type Clock = () => number; // seconds

export type FrameChangeReason = 'load' | 'advance' | 'step' | 'seek' | 'resync';

export interface PlayerState {
  frameIndex: number;
  frameCount: number;
  isPlaying: boolean;
  /** Playback speed multiplier (1 = base rate). */
  speed: number;
  /** Seconds each frame is displayed at the current speed. */
  frameDuration: number;
  /** Clock time (seconds) at which the current frame started. */
  frameStartTime: number;
  loop: boolean;
}

export interface FrameEvent {
  type: 'frame';
  reason: FrameChangeReason;
  frameIndex: number;
  previousIndex: number | null;
  frameStartTime: number;
  frameDuration: number;
}

export interface StateEvent {
  type: 'state';
}

export type PlayerEvent = FrameEvent | StateEvent;
export type PlayerListener = (state: Readonly<PlayerState>, event: PlayerEvent) => void;

export const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

export interface PlayerOptions {
  clock?: Clock;
  /** Seconds per frame at speed 1. */
  baseFrameDuration?: number;
  loop?: boolean;
}

const defaultClock: Clock = () => performance.now() / 1000;

export class VisualizationPlayer {
  private clock: Clock;
  private readonly baseFrameDuration: number;
  private state: PlayerState;
  private listeners = new Set<PlayerListener>();

  constructor(options: PlayerOptions = {}) {
    this.clock = options.clock ?? defaultClock;
    this.baseFrameDuration = options.baseFrameDuration ?? 2;
    this.state = {
      frameIndex: 0,
      frameCount: 0,
      isPlaying: false,
      speed: 1,
      frameDuration: this.baseFrameDuration,
      frameStartTime: this.clock(),
      loop: options.loop ?? true,
    };
  }

  getState(): Readonly<PlayerState> {
    return this.state;
  }

  now(): number {
    return this.clock();
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Swap the time source (e.g. to the AudioContext clock once audio starts).
   * The current frame keeps its elapsed progress, re-expressed in the new clock.
   */
  setClock(clock: Clock): void {
    const elapsed = this.clock() - this.state.frameStartTime;
    this.clock = clock;
    this.state = { ...this.state, frameStartTime: this.clock() - elapsed };
    this.emitFrame('resync', null);
  }

  load(frameCount: number): void {
    if (!Number.isInteger(frameCount) || frameCount < 0) throw new RangeError('frameCount must be a non-negative integer');
    this.state = { ...this.state, frameCount, frameIndex: 0, isPlaying: false, frameStartTime: this.clock() };
    if (frameCount > 0) this.emitFrame('load', null);
    else this.emitState();
  }

  play(): void {
    if (this.state.frameCount === 0 || this.state.isPlaying) return;
    let frameIndex = this.state.frameIndex;
    // If we finished a non-looping sequence, restart from the beginning.
    if (!this.state.loop && frameIndex >= this.state.frameCount - 1) frameIndex = 0;
    const changed = frameIndex !== this.state.frameIndex;
    const previous = this.state.frameIndex;
    // A frame resumes from its beginning so its full audio phrase is heard.
    this.state = { ...this.state, frameIndex, isPlaying: true, frameStartTime: this.clock() };
    this.emitFrame(changed ? 'seek' : 'resync', changed ? previous : null);
  }

  pause(): void {
    if (!this.state.isPlaying) return;
    this.state = { ...this.state, isPlaying: false };
    this.emitState();
  }

  toggle(): void {
    if (this.state.isPlaying) this.pause();
    else this.play();
  }

  next(): void {
    this.step(1);
  }

  prev(): void {
    this.step(-1);
  }

  seek(index: number): void {
    const { frameCount } = this.state;
    if (frameCount === 0) return;
    const clamped = Math.min(frameCount - 1, Math.max(0, Math.round(index)));
    this.goTo(clamped, 'seek');
  }

  setSpeed(speed: number): void {
    if (!(speed > 0) || !Number.isFinite(speed)) throw new RangeError('speed must be a positive number');
    const frameDuration = this.baseFrameDuration / speed;
    // Restart the current frame on the new grid so audio and visuals stay aligned.
    this.state = { ...this.state, speed, frameDuration, frameStartTime: this.clock() };
    this.emitFrame('resync', null);
  }

  setLoop(loop: boolean): void {
    this.state = { ...this.state, loop };
    this.emitState();
  }

  /** Progress through the whole sequence, 0..1. */
  getProgress(): number {
    const { frameCount, frameIndex } = this.state;
    if (frameCount <= 1) return frameCount === 1 ? 1 : 0;
    return frameIndex / (frameCount - 1);
  }

  /** Progress through the current frame, 0..1. */
  getFrameProgress(): number {
    if (!this.state.isPlaying) return 0;
    const p = (this.clock() - this.state.frameStartTime) / this.state.frameDuration;
    return Math.min(1, Math.max(0, p));
  }

  /** Advance playback if the current frame's duration has elapsed. Call every animation frame. */
  tick(): void {
    const s = this.state;
    if (!s.isPlaying || s.frameCount === 0) return;
    const now = this.clock();
    const elapsed = now - s.frameStartTime;
    if (elapsed < s.frameDuration) return;

    let steps = Math.floor(elapsed / s.frameDuration);
    let nextStart = s.frameStartTime + steps * s.frameDuration;
    // After a long stall (e.g. a background tab), do not fast-forward through
    // many frames: advance one and re-anchor to now.
    if (steps > 2) {
      steps = 1;
      nextStart = now;
    }

    let nextIndex = s.frameIndex + steps;
    if (nextIndex >= s.frameCount) {
      if (s.loop) nextIndex %= s.frameCount;
      else {
        this.state = { ...s, frameIndex: s.frameCount - 1, isPlaying: false };
        if (s.frameIndex !== s.frameCount - 1) this.emitFrame('advance', s.frameIndex);
        else this.emitState();
        return;
      }
    }
    const previous = s.frameIndex;
    this.state = { ...s, frameIndex: nextIndex, frameStartTime: nextStart };
    this.emitFrame('advance', previous);
  }

  private step(delta: number): void {
    const { frameCount, frameIndex, loop } = this.state;
    if (frameCount === 0) return;
    let next = frameIndex + delta;
    if (loop) next = ((next % frameCount) + frameCount) % frameCount;
    else next = Math.min(frameCount - 1, Math.max(0, next));
    this.goTo(next, 'step');
  }

  private goTo(index: number, reason: FrameChangeReason): void {
    const previous = this.state.frameIndex;
    this.state = { ...this.state, frameIndex: index, frameStartTime: this.clock() };
    this.emitFrame(reason, index === previous ? null : previous);
  }

  private emitFrame(reason: FrameChangeReason, previousIndex: number | null): void {
    const s = this.state;
    const event: FrameEvent = {
      type: 'frame',
      reason,
      frameIndex: s.frameIndex,
      previousIndex,
      frameStartTime: s.frameStartTime,
      frameDuration: s.frameDuration,
    };
    for (const l of this.listeners) l(s, event);
  }

  private emitState(): void {
    for (const l of this.listeners) l(this.state, { type: 'state' });
  }
}
