/**
 * Look-ahead audio scheduler ("two clocks" pattern).
 *
 * A coarse JS timer wakes every `intervalMs` and schedules any phrase steps
 * that fall within the next `lookahead` seconds on the precise AudioContext
 * clock. Each displayed frame owns one phrase of `stepsPerFrame` steps that
 * spans exactly the frame's display duration, starting at the frame's start
 * time, so sound and image change together.
 *
 * Synchronization rules:
 *  - setPhrase() increments a generation counter and cancels every voice not
 *    yet started, so a new frame never overlaps with a stale one.
 *  - Steps whose time has already passed (e.g. analysis finished a few ms after
 *    the frame boundary) are skipped, keeping the rhythm on the frame's grid
 *    instead of shifting it late.
 *  - `loop` repeats the phrase (used when paused in "hold" mode).
 */
import type { SoundOutput } from './audioEngine';
import type { SonificationParams } from './sonificationMapper';

export interface PhraseOptions {
  startTime: number;
  stepDuration: number;
  loop: boolean;
}

export interface Playhead {
  generation: number;
  step: number;
  stepsPerFrame: number;
  /** Phrase start in output clock seconds (advances when looping). */
  phraseStart: number;
}

export interface SchedulerTimer {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const browserTimer: SchedulerTimer = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/** Steps up to this many seconds late are still played (snapped to "now"). */
const LATE_TOLERANCE = 0.03;

export class AudioScheduler {
  private params: SonificationParams | null = null;
  private phraseStart = 0;
  private stepDuration = 0.125;
  private loop = false;
  private nextStep = 0;
  private generation = 0;
  private timerId: unknown = null;
  private readonly lookahead: number;
  private readonly intervalMs: number;
  private readonly timer: SchedulerTimer;
  /** Steps scheduled for the current generation (exposed for tests and UI). */
  readonly scheduledSteps: number[] = [];

  constructor(
    private readonly output: SoundOutput,
    options: { lookahead?: number; intervalMs?: number; timer?: SchedulerTimer } = {},
  ) {
    this.lookahead = options.lookahead ?? 0.12;
    this.intervalMs = options.intervalMs ?? 25;
    this.timer = options.timer ?? browserTimer;
  }

  getGeneration(): number {
    return this.generation;
  }

  isActive(): boolean {
    return this.params !== null;
  }

  start(): void {
    if (this.timerId !== null) return;
    this.timerId = this.timer.setInterval(() => this.pump(), this.intervalMs);
  }

  stopTimer(): void {
    if (this.timerId !== null) this.timer.clearInterval(this.timerId);
    this.timerId = null;
  }

  /** Replace the current phrase. Returns the new generation number. */
  setPhrase(params: SonificationParams, opts: PhraseOptions): number {
    this.generation++;
    const now = this.output.now();
    // Nothing from a previous generation may start from here on.
    this.output.cancelFrom(now);
    this.params = params;
    this.stepDuration = Math.max(0.01, opts.stepDuration);
    this.loop = opts.loop;
    this.phraseStart = opts.startTime;
    this.nextStep = 0;
    this.scheduledSteps.length = 0;
    // If the phrase started in the past and we are looping, jump to the current cycle.
    const phraseDur = this.stepDuration * params.stepsPerFrame;
    if (this.loop && now - this.phraseStart >= phraseDur) {
      const cycles = Math.floor((now - this.phraseStart) / phraseDur);
      this.phraseStart += cycles * phraseDur;
    }
    this.output.setContinuous(
      {
        droneFreqs: params.drone.freqs,
        droneGain: params.drone.gain,
        dronePan: params.drone.pan,
        filterHz: params.filterHz,
        padFreqs: params.pad.freqs,
        padGain: params.pad.gain,
      },
      Math.max(now, this.phraseStart),
    );
    this.pump();
    return this.generation;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  /** Stop scheduling and cancel all voices that have not started. */
  clear(): void {
    this.generation++;
    this.params = null;
    this.scheduledSteps.length = 0;
    this.output.cancelFrom(this.output.now());
  }

  getPlayhead(): Playhead | null {
    const p = this.params;
    if (!p) return null;
    const now = this.output.now();
    const phraseDur = this.stepDuration * p.stepsPerFrame;
    let elapsed = now - this.phraseStart;
    if (elapsed < 0) return { generation: this.generation, step: -1, stepsPerFrame: p.stepsPerFrame, phraseStart: this.phraseStart };
    if (this.loop) elapsed %= phraseDur;
    const step = Math.floor(elapsed / this.stepDuration);
    return {
      generation: this.generation,
      step: step >= p.stepsPerFrame ? -1 : step,
      stepsPerFrame: p.stepsPerFrame,
      phraseStart: this.phraseStart,
    };
  }

  /** Schedule all steps that fall inside the look-ahead window. */
  pump(): void {
    const p = this.params;
    if (!p || !this.output.isRunning()) return;
    const now = this.output.now();
    const horizon = now + this.lookahead;
    // Bound the work per pump to avoid runaway loops on clock jumps.
    for (let guard = 0; guard < p.stepsPerFrame * 2; guard++) {
      if (this.nextStep >= p.stepsPerFrame) {
        if (!this.loop) return;
        this.phraseStart += this.stepDuration * p.stepsPerFrame;
        this.nextStep = 0;
        this.scheduledSteps.length = 0;
      }
      const time = this.phraseStart + this.nextStep * this.stepDuration;
      if (time >= horizon) return;
      if (time >= now - LATE_TOLERANCE) this.scheduleStep(p, this.nextStep, Math.max(time, now));
      this.nextStep++;
    }
  }

  private scheduleStep(p: SonificationParams, step: number, time: number): void {
    this.scheduledSteps.push(step);
    for (const n of p.notes) {
      if (n.step !== step) continue;
      this.output.playNote({
        time,
        freq: n.freq,
        velocity: n.velocity,
        gain: p.gain,
        pan: n.pan,
        duration: n.durationSteps * this.stepDuration * p.articulation,
        filterHz: p.filterHz,
        instrument: p.instrument,
      });
    }
    for (const t of p.ticks) {
      if (t.step !== step) continue;
      this.output.playTick({ time, velocity: t.velocity, gain: p.gain * 0.8, pan: t.pan });
    }
  }
}
