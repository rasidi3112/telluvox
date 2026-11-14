/**
 * Web Audio engine.
 *
 * All sound in TELLUVOX is synthesized here, in real time, from parameters
 * produced by the sonification mapper. There are no audio files.
 *
 * Signal graph:
 *
 *   bass drone (2 osc) → low-pass → droneGain → panner ──┐
 *   chord pad (5 voices × 2 detuned osc) → low-pass → padGain ──┤
 *   note voices (instrument → envelope → panner) ──────────────┼→ voiceBus ─┬─→ master (volume)
 *   tick voices (noise → band-pass → env → panner) ────────────┘            └─→ reverb send → convolver → wet ─→ master
 *   master → limiter ─┬→ mute → analyser → destination
 *                     └→ recorder (MediaStream, optional)
 *
 * A single AudioContext is created lazily on the first explicit user gesture
 * and reused until dispose().
 */
import type { Instrument } from './sonificationMapper';

export interface ContinuousParams {
  droneFreqs: [number, number];
  droneGain: number;
  dronePan: number;
  filterHz: number;
  padFreqs: number[];
  padGain: number;
}

export interface NoteParams {
  time: number;
  freq: number;
  velocity: number;
  gain: number;
  pan: number;
  duration: number;
  filterHz: number;
  instrument: Instrument;
}

export interface TickParams {
  time: number;
  velocity: number;
  gain: number;
  pan: number;
}

/** The subset of the engine the scheduler depends on (mockable in tests). */
export interface SoundOutput {
  now(): number;
  isRunning(): boolean;
  setContinuous(params: ContinuousParams, at: number): void;
  playNote(params: NoteParams): void;
  playTick(params: TickParams): void;
  /** Cancel every voice scheduled to start at or after `time`. */
  cancelFrom(time: number): void;
}

export type EngineState = 'uninitialized' | 'running' | 'suspended' | 'closed' | 'unsupported';

interface Voice {
  start: number;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  env: GainNode;
}

const MAX_VOICES = 64;
const PAD_VOICES = 5;
const RAMP = 0.12; // seconds, time constant for continuous parameter changes

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Deterministic LCG noise in −1..1 (no Math.random anywhere in the audio path). */
function fillNoise(ch: Float32Array, seed: number): void {
  let s = seed >>> 0;
  for (let i = 0; i < ch.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    ch[i] = (s / 0xffffffff) * 2 - 1;
  }
}

export class AudioEngine implements SoundOutput {
  private ctx: AudioContext | null = null;
  private voiceBus!: GainNode;
  private master!: GainNode;
  private muteGain!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private analyser!: AnalyserNode;
  private reverbSend!: GainNode;
  private reverbWet!: GainNode;
  private droneOscs: OscillatorNode[] = [];
  private droneFilter!: BiquadFilterNode;
  private droneGain!: GainNode;
  private dronePanner!: AudioNode & { pan?: AudioParam };
  private padOscs: OscillatorNode[][] = [];
  private padVoiceGains: GainNode[] = [];
  private padFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private noiseBuffer: AudioBuffer | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];
  private voices = new Set<Voice>();
  private listeners = new Set<(s: EngineState) => void>();
  private volume = 0.7;
  private muted = false;
  private reverb = 0.3;
  /** Count of note/tick voices actually scheduled (diagnostics). */
  public stats = { notes: 0, ticks: 0, cancelled: 0, dropped: 0 };

  static isSupported(): boolean {
    return getAudioContextCtor() !== null;
  }

  static isRecordingSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';
  }

  get state(): EngineState {
    if (!AudioEngine.isSupported()) return 'unsupported';
    if (!this.ctx) return 'uninitialized';
    if (this.ctx.state === 'running') return 'running';
    if (this.ctx.state === 'closed') return 'closed';
    return 'suspended';
  }

  onStateChange(listener: (s: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const s = this.state;
    for (const l of this.listeners) l(s);
  }

  /** Must be called from a user gesture (click/keypress) to satisfy autoplay policies. */
  async start(): Promise<void> {
    if (!this.ctx || this.ctx.state === 'closed') this.build();
    const ctx = this.ctx as AudioContext;
    if (ctx.state !== 'running') await ctx.resume();
    this.emit();
  }

  /** Silence everything and suspend the context (frees CPU). */
  async stop(): Promise<void> {
    if (!this.ctx || this.ctx.state === 'closed') return;
    this.hush();
    this.fadeDrone();
    await new Promise((r) => setTimeout(r, 300));
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
    this.emit();
  }

  async dispose(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    this.voices.clear();
    this.droneOscs = [];
    this.padOscs = [];
    this.padVoiceGains = [];
    this.noiseBuffer = null;
    if (ctx && ctx.state !== 'closed') await ctx.close();
    this.emit();
  }

  now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  getAnalyser(): AnalyserNode | null {
    return this.ctx ? this.analyser : null;
  }

  getSampleRate(): number | null {
    return this.ctx?.sampleRate ?? null;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx) this.master.gain.setTargetAtTime(this.volumeCurve(), this.ctx.currentTime, 0.05);
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.muteGain.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Reverb send amount 0..1. */
  setReverb(amount: number): void {
    this.reverb = Math.min(1, Math.max(0, amount));
    if (this.ctx) this.reverbSend.gain.setTargetAtTime(this.reverb, this.ctx.currentTime, 0.1);
  }

  private volumeCurve(): number {
    return this.volume * this.volume;
  }

  private build(): void {
    const Ctor = getAudioContextCtor();
    if (!Ctor) throw new Error('Web Audio API is not supported in this browser.');
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    ctx.onstatechange = () => this.emit();

    this.voiceBus = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = this.volumeCurve();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.muteGain = ctx.createGain();
    this.muteGain.gain.value = this.muted ? 0 : 1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;

    this.voiceBus.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.muteGain).connect(this.analyser).connect(ctx.destination);

    // Reverb: 2.6 s stereo impulse of exponentially decaying deterministic noise.
    const irLen = Math.round(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      fillNoise(ch, 0x9e3779b9 + c * 7919);
      for (let i = 0; i < irLen; i++) ch[i]! *= Math.exp(-i / (ctx.sampleRate * 0.55)) * (i < 64 ? i / 64 : 1);
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = this.reverb;
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0.55;
    this.voiceBus.connect(this.reverbSend).connect(convolver).connect(this.reverbWet).connect(this.master);

    // Recording tap (post-limiter, pre-mute)
    if (typeof ctx.createMediaStreamDestination === 'function') {
      this.recordDest = ctx.createMediaStreamDestination();
      this.limiter.connect(this.recordDest);
    }

    // Bass drone
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 900;
    this.droneFilter.Q.value = 0.7;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.dronePanner = this.createPanner(0);
    this.droneFilter.connect(this.droneGain).connect(this.dronePanner).connect(this.voiceBus);
    const types: OscillatorType[] = ['sine', 'triangle'];
    this.droneOscs = types.map((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = i === 0 ? 73.4 : 110;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.7 : 0.3;
      osc.connect(g).connect(this.droneFilter);
      osc.start();
      return osc;
    });

    // Chord pad
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1400;
    this.padFilter.Q.value = 0.5;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain).connect(this.voiceBus);
    this.padOscs = [];
    this.padVoiceGains = [];
    for (let v = 0; v < PAD_VOICES; v++) {
      const vg = ctx.createGain();
      vg.gain.value = 0;
      vg.connect(this.padFilter);
      const pair = [-6, 6].map((cents) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 220;
        o.detune.value = cents;
        o.connect(vg);
        o.start();
        return o;
      });
      this.padOscs.push(pair);
      this.padVoiceGains.push(vg);
    }

    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    fillNoise(buf.getChannelData(0), 0x2545f491);
    this.noiseBuffer = buf;
  }

  /** StereoPannerNode where supported; otherwise a pass-through gain (no panning). */
  private createPanner(pan: number): AudioNode & { pan?: AudioParam } {
    const ctx = this.ctx as AudioContext;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.min(1, Math.max(-1, pan));
      return p;
    }
    return ctx.createGain();
  }

  setContinuous(params: ContinuousParams, at: number): void {
    if (!this.ctx) return;
    const t = Math.max(at, this.ctx.currentTime);
    const [f0, f1] = params.droneFreqs;
    this.droneOscs[0]?.frequency.setTargetAtTime(f0, t, RAMP);
    this.droneOscs[1]?.frequency.setTargetAtTime(f1, t, RAMP);
    this.droneGain.gain.setTargetAtTime(Math.min(0.25, Math.max(0, params.droneGain)), t, RAMP * 2);
    this.droneFilter.frequency.setTargetAtTime(Math.min(4000, Math.max(80, params.filterHz * 0.6)), t, RAMP);
    this.dronePanner.pan?.setTargetAtTime(Math.min(1, Math.max(-1, params.dronePan)), t, RAMP * 2);

    const n = Math.min(PAD_VOICES, params.padFreqs.length);
    for (let v = 0; v < PAD_VOICES; v++) {
      const g = this.padVoiceGains[v];
      if (!g) continue;
      if (v < n) {
        const f = params.padFreqs[v] as number;
        for (const o of this.padOscs[v] ?? []) o.frequency.setTargetAtTime(f, t, RAMP * 1.5);
        g.gain.setTargetAtTime(1 / Math.sqrt(n), t, RAMP * 2);
      } else {
        g.gain.setTargetAtTime(0, t, RAMP * 2);
      }
    }
    this.padGain.gain.setTargetAtTime(Math.min(0.2, Math.max(0, params.padGain)), t, RAMP * 3);
    this.padFilter.frequency.setTargetAtTime(Math.min(5000, Math.max(200, params.filterHz)), t, RAMP * 2);
  }

  playNote(p: NoteParams): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.reserveVoice()) return;
    const t = Math.max(p.time, ctx.currentTime);
    const peak = Math.min(0.3, Math.max(0, p.gain * p.velocity));
    const dur = Math.max(0.05, p.duration);
    const env = ctx.createGain();
    const panner = this.createPanner(p.pan);
    const nodes: AudioNode[] = [env, panner];
    const sources: OscillatorNode[] = [];
    let end: number;

    if (p.instrument === 'glass') {
      // Sine fundamental + inharmonic partial (×2.76) with a bell-like decay.
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = p.freq;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = p.freq * 2.76;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.22, t);
      g2.gain.setTargetAtTime(0, t, 0.12);
      o1.connect(env);
      o2.connect(g2).connect(env);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.006);
      env.gain.setTargetAtTime(0, t + 0.006, Math.max(0.12, dur * 0.55));
      end = t + dur * 2.2 + 0.4;
      sources.push(o1, o2);
      nodes.push(o1, o2, g2);
    } else if (p.instrument === 'pluck') {
      // Sawtooth through a low-pass whose cutoff falls quickly: a plucked string feel.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = p.freq;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 1.2;
      const top = Math.min(9000, Math.max(600, p.filterHz * 2.5));
      f.frequency.setValueAtTime(top, t);
      f.frequency.setTargetAtTime(Math.max(200, p.freq * 1.5), t, 0.08);
      o.connect(f).connect(env);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak * 0.7, t + 0.004);
      env.gain.setTargetAtTime(0, t + 0.004, Math.max(0.08, dur * 0.4));
      end = t + dur * 1.6 + 0.3;
      sources.push(o);
      nodes.push(o, f);
    } else {
      // Soft: triangle + octave sine through a low-pass, sustained.
      const o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = p.freq;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = p.freq * 2;
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.min(9000, Math.max(200, p.filterHz * 1.6));
      f.Q.value = 0.8;
      o1.connect(f);
      o2.connect(g2).connect(f);
      f.connect(env);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.015);
      env.gain.setTargetAtTime(peak * 0.55, t + 0.015, 0.08);
      env.gain.setTargetAtTime(0, t + dur, 0.07);
      end = t + dur + 0.45;
      sources.push(o1, o2);
      nodes.push(o1, o2, g2, f);
    }

    env.connect(panner).connect(this.voiceBus);
    for (const s of sources) {
      s.start(t);
      s.stop(end);
    }
    this.track({ start: t, sources, nodes, env });
    this.stats.notes++;
  }

  playTick(p: TickParams): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.noiseBuffer) return;
    if (!this.reserveVoice()) return;
    const t = Math.max(p.time, ctx.currentTime);
    const peak = Math.min(0.25, Math.max(0, p.gain * p.velocity));
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 1.4;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.002);
    env.gain.setTargetAtTime(0, t + 0.004, 0.018);
    const panner = this.createPanner(p.pan);
    src.connect(bp).connect(env).connect(panner).connect(this.voiceBus);
    src.start(t, 0.1, 0.15);
    this.track({ start: t, sources: [src], nodes: [src, bp, env, panner], env });
    this.stats.ticks++;
  }

  /** Short immediate tone for the image explorer (not part of the scheduled phrase). */
  playProbe(freq: number, pan: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const env = ctx.createGain();
    const peak = Math.min(0.22, 0.05 + level * 0.17);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.01);
    env.gain.setTargetAtTime(0, t + 0.05, 0.07);
    const panner = this.createPanner(pan);
    o.connect(env).connect(panner).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
    o.onended = () => {
      o.disconnect();
      env.disconnect();
      panner.disconnect();
    };
  }

  cancelFrom(time: number): void {
    for (const v of this.voices) {
      if (v.start >= time - 1e-4) {
        for (const s of v.sources) {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        }
        v.env.gain.cancelScheduledValues(0);
        v.env.gain.value = 0;
        this.release(v);
        this.stats.cancelled++;
      }
    }
  }

  /** Cancel all future voices and quickly fade the ones currently sounding. */
  hush(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.cancelFrom(now);
    for (const v of this.voices) {
      v.env.gain.cancelScheduledValues(now);
      v.env.gain.setTargetAtTime(0, now, 0.02);
      for (const s of v.sources) {
        try {
          s.stop(now + 0.15);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Fade the continuous layers without stopping the context (used for silent pause). */
  fadeDrone(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.droneGain.gain, this.padGain.gain]) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.08);
    }
  }

  // ---- recording ----
  isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Start recording the engine output. Requires a running context. */
  startRecording(): void {
    if (!this.recordDest || !AudioEngine.isRecordingSupported()) throw new Error('Recording is not supported in this browser.');
    if (this.isRecording()) return;
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    this.recordChunks = [];
    this.recorder = new MediaRecorder(this.recordDest.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordChunks.push(e.data);
    };
    this.recorder.start(250);
  }

  /** Stop recording and return the audio file. */
  stopRecording(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') return Promise.reject(new Error('Not recording.'));
    return new Promise((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(this.recordChunks, { type: rec.mimeType || 'audio/webm' }));
        this.recordChunks = [];
        this.recorder = null;
      };
      rec.stop();
    });
  }

  activeVoiceCount(): number {
    return this.voices.size;
  }

  private reserveVoice(): boolean {
    if (this.voices.size >= MAX_VOICES) {
      this.stats.dropped++;
      return false;
    }
    return true;
  }

  private track(v: Voice): void {
    this.voices.add(v);
    const last = v.sources[v.sources.length - 1];
    if (last) last.onended = () => this.release(v);
  }

  private release(v: Voice): void {
    if (!this.voices.delete(v)) return;
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}
