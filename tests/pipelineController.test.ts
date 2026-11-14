import { describe, expect, it, vi } from 'vitest';
import { extractFeatures, type PixelBuffer } from '../src/analyzer/featureExtractor';
import type { AnalysisOutcome } from '../src/analyzer/frameAnalyzer';
import { AudioScheduler } from '../src/audio/audioScheduler';
import type { EngineState } from '../src/audio/audioEngine';
import type { FrameDescriptor, VisualizationCollection } from '../src/eic/resourceAdapter';
import { VisualizationPlayer } from '../src/eic/visualizationPlayer';
import { PipelineController, type EngineControl } from '../src/sync/pipelineController';
import { FakeOutput, manualTimer, noisy, paint, solid } from './helpers';

class FakeEngine extends FakeOutput implements EngineControl {
  state: EngineState = 'uninitialized';
  private ls = new Set<(s: EngineState) => void>();
  hushed = 0;
  async start() {
    this.state = 'running';
    this.running = true;
    for (const l of this.ls) l(this.state);
  }
  async stop() {
    this.state = 'suspended';
    this.running = false;
    for (const l of this.ls) l(this.state);
  }
  hush() {
    this.hushed++;
    this.cancelFrom(this.time);
  }
  fadeDrone() {}
  setVolume() {}
  setMuted() {}
  setReverb() {}
  probes: number[] = [];
  playProbe(freq: number) {
    this.probes.push(freq);
  }
  recording = false;
  startRecording() {
    this.recording = true;
  }
  async stopRecording() {
    this.recording = false;
    return new Blob(['x'], { type: 'audio/webm' });
  }
  isRecording() {
    return this.recording;
  }
  onStateChange(l: (s: EngineState) => void) {
    this.ls.add(l);
    return () => this.ls.delete(l);
  }
}

// Four visually distinct frames.
const IMAGES: PixelBuffer[] = [
  solid(64, 32, [20, 30, 90, 255]),
  paint(solid(64, 32, [0, 0, 0, 255]), (x) => (x > 48 ? [255, 220, 40, 255] : null)),
  noisy(64, 32, 11),
  solid(64, 32, [200, 40, 40, 255]),
];

const collection: VisualizationCollection = {
  id: 'test',
  title: 'Test',
  description: '',
  kind: 'demonstration',
  isDemonstration: true,
  provenance: 'unit test',
  attribution: '',
  legend: null,
  georeferenced: false,
  projection: null,
  frames: IMAGES.map((_, index) => ({ index, url: `mem://${index}`, label: `F${index}` })),
};

function setup(loadImpl?: (f: FrameDescriptor) => Promise<CanvasImageSource>) {
  const engine = new FakeEngine();
  engine.running = false;
  let sysT = 0;
  const player = new VisualizationPlayer({ clock: () => sysT, baseFrameDuration: 2 });
  const scheduler = new AudioScheduler(engine, { timer: manualTimer });
  const analyze = vi.fn((img: CanvasImageSource): AnalysisOutcome => {
    const buf = img as unknown as PixelBuffer;
    return { ok: true, features: extractFeatures(buf), pixels: buf, sourceWidth: buf.width, sourceHeight: buf.height, sampleWidth: buf.width, sampleHeight: buf.height, durationMs: 0 };
  });
  const controller = new PipelineController({
    player,
    engine,
    scheduler,
    loadFrameImage: loadImpl ?? (async (f) => IMAGES[f.index] as unknown as CanvasImageSource),
    analyze,
    systemClock: () => sysT,
    requestFrame: () => 0,
    cancelFrame: () => {},
  });
  return { engine, player, scheduler, controller, analyze, setSys: (t: number) => (sysT = t) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PipelineController', () => {
  it('analyzes the displayed frame and updates features when the frame changes', async () => {
    const { controller, player } = setup();
    controller.setCollection(collection);
    await flush();
    const first = controller.getSnapshot();
    expect(first.analysis?.frameIndex).toBe(0);
    player.next();
    await flush();
    const second = controller.getSnapshot();
    expect(second.analysis?.frameIndex).toBe(1);
    expect(second.analysis?.features.brightness).not.toBe(first.analysis?.features.brightness);
    expect(second.analysis?.diff.comparedTo).toBe(0);
    expect(second.params).not.toEqual(first.params);
  });

  it('discards stale analysis that resolves after a newer frame', async () => {
    const pending = new Map<number, (v: CanvasImageSource) => void>();
    const { controller, player } = setup(
      (f) => new Promise<CanvasImageSource>((res) => pending.set(f.index, res)),
    );
    controller.setCollection(collection);
    player.seek(1);
    player.seek(2);
    // Resolve newest first, then the stale ones.
    pending.get(2)!(IMAGES[2] as unknown as CanvasImageSource);
    await flush();
    pending.get(1)!(IMAGES[1] as unknown as CanvasImageSource);
    pending.get(0)!(IMAGES[0] as unknown as CanvasImageSource);
    await flush();
    expect(controller.getSnapshot().analysis?.frameIndex).toBe(2);
    expect(controller.getSnapshot().frame?.index).toBe(2);
  });

  it('analyzes each source frame only once (cache) across loops', async () => {
    const { controller, player, analyze } = setup();
    controller.setCollection(collection);
    await flush();
    for (let i = 0; i < 8; i++) {
      player.next();
      await flush();
    }
    expect(analyze).toHaveBeenCalledTimes(4);
  });

  it('schedules a phrase aligned to the frame start once audio starts, driven by the audio clock', async () => {
    const { controller, player, engine } = setup();
    controller.setCollection(collection);
    await flush();
    engine.time = 50;
    await controller.startAudio();
    await flush();
    expect(controller.getSnapshot().clock).toBe('audio');
    player.play();
    await flush();
    const start = player.getState().frameStartTime;
    expect(start).toBe(50);
    // advance audio time through one frame; scheduler pumps notes
    for (let t = 50; t < 52; t += 0.025) {
      engine.time = t;
      // tick player + pump scheduler as the rAF loop and timer would
      player.tick();
      (controller as unknown as { deps: { scheduler: AudioScheduler } }).deps.scheduler.pump();
    }
    const params = controller.getSnapshot().params!;
    const firstFrameNotes = engine.notes.filter((n) => n.time < 52);
    expect(firstFrameNotes.length).toBe(params.notes.length);
    for (const n of firstFrameNotes) expect(((n.time - 50) / (2 / 16)) % 1).toBeCloseTo(0, 5);
  });

  it('when the frame changes, the generated audio parameters change accordingly', async () => {
    const { controller, player, engine } = setup();
    controller.setCollection(collection);
    await flush();
    await controller.startAudio();
    await flush();
    const g0 = controller.getSnapshot().generation;
    const p0 = controller.getSnapshot().params!;
    player.seek(3); // red frame
    await flush();
    const p3 = controller.getSnapshot().params!;
    expect(controller.getSnapshot().generation).toBeGreaterThan(g0);
    expect(p3.notePool[0]?.hueBin).toBe(0);
    expect(p0.notePool[0]?.hueBin).not.toBe(0);
    expect(engine.continuous.at(-1)?.params.droneGain).toBeCloseTo(p3.drone.gain);
  });

  it('pause in silence mode clears the scheduler; hold mode keeps looping', async () => {
    const { controller, player, engine, scheduler } = setup();
    controller.setCollection(collection);
    await flush();
    await controller.startAudio();
    player.play();
    await flush();
    controller.setPauseMode('hold');
    player.pause();
    expect(scheduler.isActive()).toBe(true);
    player.play();
    await flush();
    controller.setPauseMode('silence');
    player.pause();
    expect(scheduler.isActive()).toBe(false);
    expect(engine.hushed).toBeGreaterThan(0);
    // stepping while paused (silence mode) still plays the newly selected frame once
    player.next();
    await flush();
    expect(scheduler.isActive()).toBe(true);
  });

  it('stopAudio returns to the system clock and stops scheduling', async () => {
    const { controller, scheduler } = setup();
    controller.setCollection(collection);
    await flush();
    await controller.startAudio();
    await flush();
    await controller.stopAudio();
    expect(controller.getSnapshot().clock).toBe('system');
    expect(scheduler.isActive()).toBe(false);
  });

  it('reports image load errors instead of sonifying', async () => {
    const { controller } = setup(async () => {
      throw new Error('missing file');
    });
    controller.setCollection(collection);
    await flush();
    expect(controller.getSnapshot().analysisError).toContain('missing file');
    expect(controller.getSnapshot().params).toBeNull();
  });

  it('explorer probe sounds the selected cell only while audio runs', async () => {
    const { controller, engine } = setup();
    controller.setCollection(collection);
    await flush();
    controller.setProbe({ col: 2, row: 1 });
    expect(engine.probes).toHaveLength(0); // audio off → text only
    expect(controller.getSnapshot().probe).toEqual({ col: 2, row: 1 });
    await controller.startAudio();
    controller.setProbe({ col: 3, row: 1 });
    expect(engine.probes).toHaveLength(1);
    expect(engine.probes[0]).toBeGreaterThan(50);
  });

  it('records the soundscape into a downloadable file', async () => {
    const { controller } = setup();
    controller.setCollection(collection);
    await flush();
    await controller.startAudio();
    controller.startRecording();
    expect(controller.getSnapshot().recording.active).toBe(true);
    await controller.stopRecording();
    const rec = controller.getSnapshot().recording;
    expect(rec.active).toBe(false);
    expect(rec.last?.name).toMatch(/^telluvox-test\.webm$/);
  });
});
