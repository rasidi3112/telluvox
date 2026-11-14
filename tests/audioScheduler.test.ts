import { describe, expect, it } from 'vitest';
import { extractFeatures } from '../src/analyzer/featureExtractor';
import { AudioScheduler } from '../src/audio/audioScheduler';
import { mapFeaturesToSound } from '../src/audio/sonificationMapper';
import { diffOf, FakeOutput, manualTimer, noisy, solid } from './helpers';

const busyParams = () =>
  mapFeaturesToSound(extractFeatures(noisy(64, 32, 5)), diffOf({ meanAbsDiff: 0.2, changedFraction: 1, comparedTo: 0 }));
const calmParams = () => mapFeaturesToSound(extractFeatures(solid(64, 32, [40, 60, 200, 255])), diffOf({ comparedTo: 0 }));

function run(out: FakeOutput, sched: AudioScheduler, until: number, dt = 0.025) {
  while (out.time < until) {
    out.time += dt;
    sched.pump();
  }
}

describe('AudioScheduler', () => {
  it('schedules every note of a phrase on the frame grid', () => {
    const out = new FakeOutput();
    const s = new AudioScheduler(out, { timer: manualTimer });
    const p = busyParams();
    s.setPhrase(p, { startTime: 10, stepDuration: 0.125, loop: false });
    out.time = 9.95;
    run(out, s, 12.5);
    expect(out.notes).toHaveLength(p.notes.length);
    expect(out.ticks).toHaveLength(p.ticks.length);
    for (const [i, n] of out.notes.entries()) expect(n.time).toBeCloseTo(10 + (p.notes[i]!.step) * 0.125, 6);
  });

  it('does not schedule beyond the look-ahead window', () => {
    const out = new FakeOutput();
    const s = new AudioScheduler(out, { timer: manualTimer, lookahead: 0.1 });
    out.time = 0;
    s.setPhrase(busyParams(), { startTime: 0, stepDuration: 0.125, loop: false });
    expect(out.notes.every((n) => n.time < 0.1)).toBe(true);
  });

  it('cancels unstarted voices of the previous phrase when a new frame arrives (no overlap)', () => {
    const out = new FakeOutput();
    const s = new AudioScheduler(out, { timer: manualTimer, lookahead: 0.5 });
    out.time = 0;
    s.setPhrase(busyParams(), { startTime: 0, stepDuration: 0.125, loop: false });
    run(out, s, 0.3);
    const g1 = s.getGeneration();
    // A new frame arrives at t = 0.3, while notes up to t = 0.8 are already queued.
    const p2 = calmParams();
    const g2 = s.setPhrase(p2, { startTime: 0.3, stepDuration: 0.125, loop: false });
    expect(g2).toBe(g1 + 1);
    run(out, s, 3);
    const after = out.notes.filter((n) => n.time >= 0.3);
    expect(after).toHaveLength(p2.notes.length);
    expect(out.cancels.at(-1)).toBeCloseTo(0.3);
  });

  it('skips steps that are already in the past instead of shifting the rhythm late', () => {
    const out = new FakeOutput();
    const s = new AudioScheduler(out, { timer: manualTimer });
    const p = busyParams();
    out.time = 10.5; // analysis finished 0.5 s after the frame started at 10
    s.setPhrase(p, { startTime: 10, stepDuration: 0.125, loop: false });
    run(out, s, 13);
    const expected = p.notes.filter((n) => 10 + n.step * 0.125 >= 10.5 - 0.03);
    expect(out.notes).toHaveLength(expected.length);
    for (const n of out.notes) expect(((n.time - 10) / 0.125) % 1).toBeCloseTo(0, 6);
  });

  it('loops the phrase when looping (pause "hold" mode)', () => {
    const out = new FakeOutput();
    const s = new AudioScheduler(out, { timer: manualTimer });
    const p = busyParams();
    s.setPhrase(p, { startTime: 0, stepDuration: 0.125, loop: true });
    run(out, s, 2 * 3 + 0.01); // three phrases of 2 s
    expect(out.notes.length).toBeGreaterThanOrEqual(p.notes.length * 3);
  });

  it('stops after one phrase when not looping', () => {
    const out = new FakeOutput();
    const s = new AudioScheduler(out, { timer: manualTimer });
    const p = busyParams();
    s.setPhrase(p, { startTime: 0, stepDuration: 0.125, loop: false });
    run(out, s, 8);
    expect(out.notes).toHaveLength(p.notes.length);
  });

  it('clear() cancels everything and stops scheduling', () => {
    const out = new FakeOutput();
    const s = new AudioScheduler(out, { timer: manualTimer, lookahead: 1 });
    s.setPhrase(busyParams(), { startTime: 0, stepDuration: 0.125, loop: true });
    s.clear();
    expect(out.notes).toHaveLength(out.notes.filter((n) => n.time < 0).length);
    run(out, s, 3);
    expect(out.notes).toHaveLength(0);
    expect(s.isActive()).toBe(false);
  });

  it('schedules nothing while the output is not running', () => {
    const out = new FakeOutput();
    out.running = false;
    const s = new AudioScheduler(out, { timer: manualTimer });
    s.setPhrase(busyParams(), { startTime: 0, stepDuration: 0.125, loop: false });
    run(out, s, 3);
    expect(out.notes).toHaveLength(0);
  });

  it('reports a playhead step', () => {
    const out = new FakeOutput();
    const s = new AudioScheduler(out, { timer: manualTimer });
    s.setPhrase(busyParams(), { startTime: 0, stepDuration: 0.125, loop: false });
    out.time = 0.4;
    expect(s.getPlayhead()?.step).toBe(3);
  });
});
