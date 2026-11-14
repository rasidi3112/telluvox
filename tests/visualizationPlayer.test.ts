import { describe, expect, it } from 'vitest';
import { VisualizationPlayer, type FrameEvent, type PlayerEvent } from '../src/eic/visualizationPlayer';

function setup(frames = 5, opts: { loop?: boolean } = {}) {
  let t = 100;
  const player = new VisualizationPlayer({ clock: () => t, baseFrameDuration: 2, loop: opts.loop ?? true });
  const events: PlayerEvent[] = [];
  player.subscribe((_, e) => events.push(e));
  player.load(frames);
  const frameEvents = () => events.filter((e): e is FrameEvent => e.type === 'frame');
  return { player, events, frameEvents, advance: (dt: number) => (t += dt), now: () => t };
}

describe('VisualizationPlayer', () => {
  it('emits a load event for frame 0', () => {
    const { frameEvents } = setup();
    expect(frameEvents()[0]).toMatchObject({ reason: 'load', frameIndex: 0 });
  });

  it('advances exactly at frame boundaries on a fixed grid', () => {
    const { player, frameEvents, advance } = setup();
    player.play();
    const start = player.getState().frameStartTime;
    advance(1.99);
    player.tick();
    expect(player.getState().frameIndex).toBe(0);
    advance(0.02);
    player.tick();
    expect(player.getState().frameIndex).toBe(1);
    // Next frame starts exactly one duration later, not at "now" (no drift).
    expect(player.getState().frameStartTime).toBeCloseTo(start + 2, 10);
    expect(frameEvents().at(-1)).toMatchObject({ reason: 'advance', frameIndex: 1, previousIndex: 0 });
  });

  it('does not advance while paused', () => {
    const { player, advance } = setup();
    player.play();
    player.pause();
    advance(10);
    player.tick();
    expect(player.getState().frameIndex).toBe(0);
  });

  it('steps forward/back with wrap-around when looping', () => {
    const { player } = setup(3);
    player.prev();
    expect(player.getState().frameIndex).toBe(2);
    player.next();
    expect(player.getState().frameIndex).toBe(0);
  });

  it('clamps steps when not looping and stops at the end', () => {
    const { player, advance } = setup(3, { loop: false });
    player.prev();
    expect(player.getState().frameIndex).toBe(0);
    player.play();
    advance(2.01);
    player.tick();
    advance(2.01);
    player.tick();
    advance(2.01);
    player.tick();
    expect(player.getState().frameIndex).toBe(2);
    expect(player.getState().isPlaying).toBe(false);
  });

  it('wraps around at the end when looping', () => {
    const { player, advance } = setup(2);
    player.play();
    advance(2.01);
    player.tick();
    advance(2.0);
    player.tick();
    expect(player.getState().frameIndex).toBe(0);
  });

  it('seeks and clamps', () => {
    const { player, frameEvents } = setup(5);
    player.seek(3);
    expect(frameEvents().at(-1)).toMatchObject({ reason: 'seek', frameIndex: 3, previousIndex: 0 });
    player.seek(99);
    expect(player.getState().frameIndex).toBe(4);
  });

  it('changes frame duration with speed and re-anchors the frame', () => {
    const { player, now, frameEvents } = setup();
    player.setSpeed(2);
    expect(player.getState().frameDuration).toBe(1);
    expect(player.getState().frameStartTime).toBe(now());
    expect(frameEvents().at(-1)?.reason).toBe('resync');
    expect(() => player.setSpeed(0)).toThrow();
  });

  it('keeps frame progress when switching clocks', () => {
    const { player, advance } = setup();
    player.play();
    advance(0.5);
    let audioT = 7;
    player.setClock(() => audioT);
    expect(player.getState().frameStartTime).toBeCloseTo(6.5);
    audioT = 8.6;
    player.tick();
    expect(player.getState().frameIndex).toBe(1);
  });

  it('does not fast-forward through many frames after a stall', () => {
    const { player, advance } = setup(10);
    player.play();
    advance(30);
    player.tick();
    expect(player.getState().frameIndex).toBe(1);
  });

  it('reports sequence progress', () => {
    const { player } = setup(5);
    player.seek(2);
    expect(player.getProgress()).toBe(0.5);
  });
});
