/**
 * Audio-visual synchronization controller.
 *
 *   player frame event
 *     → load frame image (cached)
 *     → analyze pixels (once per source frame, cached)
 *     → frame difference vs. previously displayed frame
 *     → sonification mapping
 *     → scheduler.setPhrase() aligned to the frame's start time
 *     → UI snapshot update
 *
 * Race-condition handling: every frame event gets a request id; any async
 * result belonging to an older request is discarded, so stale analysis can
 * never be scheduled or displayed.
 *
 * Clock: while audio runs, the player is driven by AudioContext.currentTime,
 * so frame boundaries and phrase start times are on the same clock. When audio
 * is off or suspended, the player falls back to performance.now().
 *
 * Pause behaviour (user-selectable):
 *   'hold':    the current frame's phrase keeps looping while paused, so a
 *               single frame can be studied by ear (default).
 *   'silence': pausing silences audio; stepping to another frame while
 *               paused plays that frame's phrase once.
 */
import { computeFrameDifference, type FrameDifference, type FrameSignature, type VisualFeatures } from '../analyzer/featureExtractor';
import { AnalysisCache, type AnalysisOutcome, type AnalysisSuccess } from '../analyzer/frameAnalyzer';
import type { EngineState, SoundOutput } from '../audio/audioEngine';
import type { AudioScheduler, Playhead } from '../audio/audioScheduler';
import {
  DEFAULT_CONFIG,
  describeSonification,
  hueBinToMidi,
  mapFeaturesToSound,
  type LegendContext,
  midiToFreq,
  type Instrument,
  type MappingKey,
  type SonificationConfig,
  type SonificationParams,
} from '../audio/sonificationMapper';
import { HUE_BINS, type PixelBuffer } from '../analyzer/featureExtractor';
import { buildLegendLUT, readLegendValues, type LegendLUT, type LegendReading } from '../analyzer/legendReader';
import { rgbToHsv } from '../analyzer/palette';
import type { FrameDescriptor, ResourceSummary, VisualizationCollection } from '../eic/resourceAdapter';
import type { FrameEvent, PlayerState, VisualizationPlayer } from '../eic/visualizationPlayer';

export type PauseMode = 'hold' | 'silence';
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface EngineControl extends SoundOutput {
  readonly state: EngineState;
  start(): Promise<void>;
  stop(): Promise<void>;
  hush(): void;
  fadeDrone(): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  onStateChange(listener: (s: EngineState) => void): () => void;
  setReverb(amount: number): void;
  playProbe(freq: number, pan: number, level: number): void;
  startRecording(): void;
  stopRecording(): Promise<Blob>;
  isRecording(): boolean;
}

export interface ProbeCell {
  col: number;
  row: number;
}

export interface RecordingInfo {
  url: string;
  mime: string;
  bytes: number;
  seconds: number;
  name: string;
}

export interface ImportState {
  busy: boolean;
  message: string | null;
  progress: number | null;
  error: string | null;
}

export interface FrameAnalysis {
  frameIndex: number;
  frameUrl: string;
  features: VisualFeatures;
  diff: FrameDifference;
  sampleWidth: number;
  sampleHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  durationMs: number;
  fromCache: boolean;
  /** Values estimated from the published colour bar, when the collection has a readable numeric legend. */
  legend: LegendReading | null;
}

export interface PipelineSnapshot {
  collection: VisualizationCollection | null;
  loadState: LoadState;
  loadError: string | null;
  player: PlayerState;
  frame: FrameDescriptor | null;
  image: CanvasImageSource | null;
  analysis: FrameAnalysis | null;
  analysisError: string | null;
  params: SonificationParams | null;
  description: string;
  engineState: EngineState;
  audioWanted: boolean;
  clock: 'audio' | 'system';
  volume: number;
  muted: boolean;
  config: SonificationConfig;
  pauseMode: PauseMode;
  generation: number;
  framesAnalyzed: number;
  library: ResourceSummary[];
  selectedId: string | null;
  importState: ImportState;
  probe: ProbeCell | null;
  reverb: number;
  recording: { active: boolean; startedAt: number | null; last: RecordingInfo | null; error: string | null };
  prefs: { haptics: boolean; narrate: boolean };
}

export interface PipelineDeps {
  player: VisualizationPlayer;
  engine: EngineControl;
  scheduler: AudioScheduler;
  loadFrameImage: (frame: FrameDescriptor) => Promise<CanvasImageSource>;
  analyze: (image: CanvasImageSource) => AnalysisOutcome;
  /** Load a legend (colour-bar) image as pixels. Optional: without it, legends are shown but not read. */
  readLegendImage?: (url: string) => Promise<PixelBuffer>;
  systemClock?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class PipelineController {
  private snapshot: PipelineSnapshot;
  private listeners = new Set<() => void>();
  private requestId = 0;
  private cache = new AnalysisCache();
  private lastDisplayed: { index: number; signature: FrameSignature } | null = null;
  private legendLut: LegendLUT | null = null;
  /** Analyzed pixels per frame URL, for (re-)reading the legend. */
  private pixelCache = new Map<string, PixelBuffer>();
  private rafId: number | null = null;
  private unsubs: (() => void)[] = [];
  private readonly systemClock: () => number;

  constructor(private readonly deps: PipelineDeps) {
    this.systemClock = deps.systemClock ?? (() => performance.now() / 1000);
    this.snapshot = {
      collection: null,
      loadState: 'idle',
      loadError: null,
      player: deps.player.getState(),
      frame: null,
      image: null,
      analysis: null,
      analysisError: null,
      params: null,
      description: '',
      engineState: deps.engine.state,
      audioWanted: false,
      clock: 'system',
      volume: 0.7,
      muted: false,
      config: DEFAULT_CONFIG,
      pauseMode: 'hold',
      generation: 0,
      framesAnalyzed: 0,
      library: [],
      selectedId: null,
      importState: { busy: false, message: null, progress: null, error: null },
      probe: null,
      reverb: 0.3,
      recording: { active: false, startedAt: null, last: null, error: null },
      prefs: { haptics: false, narrate: false },
    };
    this.unsubs.push(deps.player.subscribe((state, ev) => this.onPlayerEvent(state, ev)));
    this.unsubs.push(deps.engine.onStateChange((s) => this.onEngineState(s)));
  }

  // ---- external store API (useSyncExternalStore) ----
  getSnapshot = (): PipelineSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<PipelineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  // ---- lifecycle ----
  startLoop(): void {
    const raf = this.deps.requestFrame ?? ((cb: () => void) => requestAnimationFrame(cb));
    if (this.rafId !== null) return;
    const loop = () => {
      this.deps.player.tick();
      this.rafId = raf(loop);
    };
    this.rafId = raf(loop);
  }

  stopLoop(): void {
    const cancel = this.deps.cancelFrame ?? ((id: number) => cancelAnimationFrame(id));
    if (this.rafId !== null) cancel(this.rafId);
    this.rafId = null;
  }

  dispose(): void {
    this.stopLoop();
    this.deps.scheduler.clear();
    this.deps.scheduler.stopTimer();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.listeners.clear();
  }

  // ---- resources ----
  setCollection(collection: VisualizationCollection): void {
    this.cache.clear();
    this.pixelCache.clear();
    this.legendLut = null;
    this.prepareLegend(collection);
    this.lastDisplayed = null;
    this.requestId++;
    this.update({
      collection,
      loadState: 'ready',
      loadError: null,
      analysis: null,
      params: null,
      image: null,
      frame: null,
      analysisError: null,
      description: '',
      probe: null,
      selectedId: collection.id,
    });
    this.deps.player.load(collection.frames.length);
  }

  setLoading(): void {
    this.update({ loadState: 'loading', loadError: null });
  }

  setLibrary(library: ResourceSummary[]): void {
    this.update({ library });
  }

  setSelected(id: string | null): void {
    this.update({ selectedId: id });
  }

  setImportState(patch: Partial<ImportState>): void {
    this.update({ importState: { ...this.snapshot.importState, ...patch } });
  }

  setPrefs(patch: Partial<PipelineSnapshot['prefs']>): void {
    this.update({ prefs: { ...this.snapshot.prefs, ...patch } });
  }

  setReverb(v: number): void {
    this.deps.engine.setReverb(v);
    this.update({ reverb: v });
  }

  setInstrument(instrument: Instrument): void {
    this.setConfig({ ...this.snapshot.config, instrument });
  }

  setKey(rootMidi: number): void {
    this.setConfig({ ...this.snapshot.config, rootMidi });
  }

  /**
   * Image explorer probe: report and (if audio runs) sound one grid cell of the
   * current frame. Pitch follows the cell's hue on the same ladder as the
   * melody, loudness its brightness, stereo position its column.
   */
  setProbe(cell: ProbeCell | null): void {
    this.update({ probe: cell });
    const a = this.snapshot.analysis;
    if (!cell || !a || !this.deps.engine.isRunning() || !this.snapshot.audioWanted) return;
    const g = a.features.grid;
    const i = cell.row * g.cols + cell.col;
    const r = g.rgb[i * 3] ?? 0, gg = g.rgb[i * 3 + 1] ?? 0, b = g.rgb[i * 3 + 2] ?? 0;
    const hsv = rgbToHsv(r, gg, b);
    const mode = this.snapshot.params?.mode ?? 'major';
    const root = this.snapshot.config.rootMidi + 12;
    const midi = hsv.h === null || hsv.s < 0.08 ? root + Math.round((g.luma[i] ?? 0) * 12) : hueBinToMidi(Math.floor(hsv.h / (360 / HUE_BINS)) % HUE_BINS, root, mode);
    const pan = ((cell.col + 0.5) / g.cols) * 2 - 1;
    this.deps.engine.playProbe(midiToFreq(midi), pan * 0.9, g.luma[i] ?? 0);
  }

  startRecording(): void {
    if (!this.deps.engine.isRunning()) {
      this.update({ recording: { ...this.snapshot.recording, error: 'Start sound before recording.' } });
      return;
    }
    try {
      this.deps.engine.startRecording();
      this.update({ recording: { ...this.snapshot.recording, active: true, startedAt: Date.now(), error: null } });
    } catch (e) {
      this.update({ recording: { ...this.snapshot.recording, active: false, error: errMsg(e) } });
    }
  }

  async stopRecording(): Promise<void> {
    const started = this.snapshot.recording.startedAt ?? Date.now();
    try {
      const blob = await this.deps.engine.stopRecording();
      const prev = this.snapshot.recording.last;
      if (prev) URL.revokeObjectURL(prev.url);
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const slug = (this.snapshot.collection?.title ?? 'soundscape').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const last: RecordingInfo = {
        url: URL.createObjectURL(blob),
        mime: blob.type,
        bytes: blob.size,
        seconds: (Date.now() - started) / 1000,
        name: `telluvox-${slug}.${ext}`,
      };
      this.update({ recording: { active: false, startedAt: null, last, error: null } });
    } catch (e) {
      this.update({ recording: { ...this.snapshot.recording, active: false, startedAt: null, error: errMsg(e) } });
    }
  }

  setLoadError(message: string): void {
    this.update({ loadState: 'error', loadError: message });
  }

  // ---- audio ----
  /** Must be invoked from a user gesture. */
  async startAudio(): Promise<void> {
    this.update({ audioWanted: true });
    try {
      await this.deps.engine.start();
    } catch (e) {
      this.update({ audioWanted: false, analysisError: `Audio could not start: ${errMsg(e)}` });
      return;
    }
    this.useAudioClock();
  }

  async stopAudio(): Promise<void> {
    if (this.deps.engine.isRecording()) await this.stopRecording();
    this.update({ audioWanted: false });
    this.deps.scheduler.clear();
    this.deps.scheduler.stopTimer();
    this.useSystemClock();
    await this.deps.engine.stop();
  }

  setVolume(v: number): void {
    this.deps.engine.setVolume(v);
    this.update({ volume: v });
  }

  setMuted(m: boolean): void {
    this.deps.engine.setMuted(m);
    this.update({ muted: m });
  }

  setPauseMode(mode: PauseMode): void {
    this.update({ pauseMode: mode });
    if (this.snapshot.player.isPlaying) return;
    if (mode === 'silence') this.silence();
    else this.reschedule(true);
  }

  setMappingEnabled(key: MappingKey, enabled: boolean): void {
    this.setConfig({ ...this.snapshot.config, enabled: { ...this.snapshot.config.enabled, [key]: enabled } });
  }

  setConfig(config: SonificationConfig): void {
    this.update({ config });
    const a = this.snapshot.analysis;
    if (!a) return;
    const ctx = this.legendContext(a.legend);
    const params = mapFeaturesToSound(a.features, a.diff, config, ctx);
    this.update({ params, description: describeSonification(a.features, a.diff, params, ctx) });
    this.reschedule(false);
  }

  /** Build the colour→value table from the collection's colour bar (async, once per collection). */
  private prepareLegend(collection: VisualizationCollection): void {
    const lg = collection.legend;
    const read = this.deps.readLegendImage;
    if (!read || !lg || lg.categorical || !lg.image || !lg.strip || lg.min === undefined || lg.max === undefined) return;
    const { min, max, strip } = lg;
    const id = collection.id;
    read(lg.image)
      .then((px) => {
        if (this.snapshot.collection?.id !== id) return;
        this.legendLut = buildLegendLUT(px, strip, min, max, lg.match ?? 'rgb');
        // Re-read the frame already on screen.
        const a = this.snapshot.analysis;
        const pixels = a ? this.pixelCache.get(a.frameUrl) : undefined;
        if (a && pixels) {
          const legend = readLegendValues(pixels, this.legendLut);
          const ctx = this.legendContext(legend);
          const params = mapFeaturesToSound(a.features, a.diff, this.snapshot.config, ctx);
          this.update({ analysis: { ...a, legend }, params, description: describeSonification(a.features, a.diff, params, ctx) });
          this.reschedule(false);
        }
      })
      .catch((e) => console.warn('[TELLUVOX] legend could not be read:', e));
  }

  private legendContext(reading: LegendReading | null): LegendContext | undefined {
    const lg = this.snapshot.collection?.legend;
    if (!reading || !lg) return undefined;
    return { reading, quantity: lg.quantity, units: lg.units };
  }

  getPlayhead(): Playhead | null {
    return this.deps.engine.isRunning() ? this.deps.scheduler.getPlayhead() : null;
  }

  // ---- internals ----
  private useAudioClock(): void {
    if (!this.deps.engine.isRunning()) return;
    this.deps.scheduler.start();
    if (this.snapshot.clock !== 'audio') {
      this.update({ clock: 'audio' });
      this.deps.player.setClock(() => this.deps.engine.now()); // emits 'resync' → phrase scheduled
    } else {
      this.reschedule(false);
    }
  }

  private useSystemClock(): void {
    if (this.snapshot.clock === 'system') return;
    this.update({ clock: 'system' });
    this.deps.player.setClock(this.systemClock);
  }

  private onEngineState(state: EngineState): void {
    this.update({ engineState: state });
    if (state === 'running' && this.snapshot.audioWanted) this.useAudioClock();
    else if (state !== 'running' && this.snapshot.clock === 'audio') {
      // Context suspended by the browser/OS: the audio clock freezes, so visuals switch clocks.
      this.deps.scheduler.stopTimer();
      this.useSystemClock();
    }
  }

  private onPlayerEvent(state: Readonly<PlayerState>, ev: FrameEvent | { type: 'state' }): void {
    const wasPlaying = this.snapshot.player.isPlaying;
    this.update({ player: { ...state } });
    if (ev.type === 'state') {
      if (wasPlaying && !state.isPlaying) this.onPaused();
      return;
    }
    void this.processFrame(ev);
  }

  private onPaused(): void {
    if (this.snapshot.pauseMode === 'silence') this.silence();
    else this.deps.scheduler.setLoop(true);
  }

  private silence(): void {
    this.deps.scheduler.clear();
    this.deps.engine.hush();
    this.deps.engine.fadeDrone();
    this.update({ generation: this.deps.scheduler.getGeneration() });
  }

  /** Process a frame event. Returns when the frame's phrase has been scheduled (or discarded as stale). */
  async processFrame(ev: FrameEvent): Promise<void> {
    const collection = this.snapshot.collection;
    const frame = collection?.frames[ev.frameIndex];
    if (!collection || !frame) return;
    const req = ++this.requestId;
    if (this.snapshot.frame !== frame) this.update({ frame });

    let image: CanvasImageSource;
    try {
      image = await this.deps.loadFrameImage(frame);
    } catch (e) {
      if (req !== this.requestId) return;
      this.deps.scheduler.clear();
      this.update({ image: null, analysis: null, params: null, analysisError: errMsg(e), description: '' });
      return;
    }
    if (req !== this.requestId) return; // a newer frame superseded this one

    let result: AnalysisSuccess | undefined = this.cache.get(frame.url);
    const fromCache = result !== undefined;
    if (!result) {
      const outcome = this.deps.analyze(image);
      if (!outcome.ok) {
        this.deps.scheduler.clear();
        this.update({ image, analysis: null, params: null, analysisError: outcome.message, description: '' });
        return;
      }
      result = outcome;
      this.cache.set(frame.url, result);
    }

    const prev = this.snapshot.analysis;
    const sameFrame = this.lastDisplayed?.index === ev.frameIndex;
    // Re-displaying the same frame (resync / speed change / resume) keeps its original difference.
    const diff =
      sameFrame && prev && prev.frameIndex === ev.frameIndex
        ? prev.diff
        : computeFrameDifference(this.lastDisplayed?.signature ?? null, result.features.signature, this.lastDisplayed?.index ?? null);
    this.lastDisplayed = { index: ev.frameIndex, signature: result.features.signature };

    this.pixelCache.set(frame.url, result.pixels);
    const legendReading = this.legendLut ? readLegendValues(result.pixels, this.legendLut) : null;
    const ctx = this.legendContext(legendReading);
    const params = mapFeaturesToSound(result.features, diff, this.snapshot.config, ctx);
    const analysis: FrameAnalysis = {
      frameIndex: ev.frameIndex,
      frameUrl: frame.url,
      features: result.features,
      diff,
      sampleWidth: result.sampleWidth,
      sampleHeight: result.sampleHeight,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      durationMs: result.durationMs,
      fromCache,
      legend: legendReading,
    };
    this.update({
      image,
      analysis,
      params,
      analysisError: null,
      description: describeSonification(result.features, diff, params, ctx),
      framesAnalyzed: this.snapshot.framesAnalyzed + (fromCache ? 0 : 1),
    });
    this.schedule(ev.reason === 'resync');
  }

  private schedule(isResync: boolean): void {
    const params = this.snapshot.params;
    const { engine, scheduler, player } = this.deps;
    if (!params || !engine.isRunning() || !this.snapshot.audioWanted) return;
    const ps = player.getState();
    if (!ps.isPlaying && this.snapshot.pauseMode === 'silence' && isResync) return;
    const startTime = this.snapshot.clock === 'audio' ? ps.frameStartTime : engine.now();
    const generation = scheduler.setPhrase(params, {
      startTime,
      stepDuration: ps.frameDuration / params.stepsPerFrame,
      loop: !ps.isPlaying && this.snapshot.pauseMode === 'hold',
    });
    this.update({ generation });
  }

  /** Re-issue the current frame's phrase (after a config or pause-mode change). */
  private reschedule(fromNow: boolean): void {
    const params = this.snapshot.params;
    const { engine, scheduler, player } = this.deps;
    if (!params || !engine.isRunning() || !this.snapshot.audioWanted) return;
    const ps = player.getState();
    if (!ps.isPlaying && this.snapshot.pauseMode === 'silence') return;
    const generation = scheduler.setPhrase(params, {
      startTime: fromNow || this.snapshot.clock !== 'audio' ? engine.now() : ps.frameStartTime,
      stepDuration: ps.frameDuration / params.stepsPerFrame,
      loop: !ps.isPlaying && this.snapshot.pauseMode === 'hold',
    });
    this.update({ generation });
  }
}
