import { describe, expect, it } from 'vitest';
import { computeFrameDifference, extractFeatures } from '../src/analyzer/featureExtractor';
import {
  buildChord,
  DEFAULT_CONFIG,
  euclidean,
  hueBinToMidi,
  mapFeaturesToSound,
  weightedSequence,
  type SonificationConfig,
} from '../src/audio/sonificationMapper';
import { diffOf, noisy, rects, solid } from './helpers';

const noDiff = diffOf();
const melody = (p: ReturnType<typeof mapFeaturesToSound>) => p.notes.filter((n) => n.voice === 0);

describe('mapFeaturesToSound: core mappings', () => {
  it('maps brightness to intensity monotonically within gain limits', () => {
    const dark = mapFeaturesToSound(extractFeatures(solid(16, 8, [30, 30, 90, 255])), noDiff);
    const mid = mapFeaturesToSound(extractFeatures(solid(16, 8, [90, 90, 200, 255])), noDiff);
    const bright = mapFeaturesToSound(extractFeatures(solid(16, 8, [200, 200, 255, 255])), noDiff);
    expect(dark.gain).toBeLessThan(mid.gain);
    expect(mid.gain).toBeLessThan(bright.gain);
    expect(bright.gain).toBeLessThanOrEqual(DEFAULT_CONFIG.maxGain);
    expect(dark.gain).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minGain);
  });

  it('maps hue distribution to different melody pitches', () => {
    const red = mapFeaturesToSound(extractFeatures(solid(16, 8, [220, 30, 30, 255])), noDiff);
    const blue = mapFeaturesToSound(extractFeatures(solid(16, 8, [30, 30, 220, 255])), noDiff);
    expect(red.notePool[0]?.hueBin).toBe(0);
    expect(blue.notePool[0]?.hueBin).toBe(8);
    expect(blue.notePool[0]!.midi).toBeGreaterThan(red.notePool[0]!.midi);
  });

  it('maps pixel variation to note density', () => {
    const cfg: SonificationConfig = { ...DEFAULT_CONFIG, enabled: { ...DEFAULT_CONFIG.enabled, tempo: false, polyphony: false } };
    const smooth = mapFeaturesToSound(extractFeatures(solid(64, 32, [100, 120, 200, 255])), noDiff, cfg);
    const busy = mapFeaturesToSound(extractFeatures(noisy(64, 32, 7)), noDiff, cfg);
    expect(melody(busy).length).toBeGreaterThan(melody(smooth).length);
    expect(melody(smooth).length).toBe(Math.round(DEFAULT_CONFIG.minNoteShare * 16));
  });

  it('maps frame difference to rhythmic ticks', () => {
    const a = extractFeatures(solid(64, 32, [20, 20, 60, 255]));
    const b = extractFeatures(solid(64, 32, [200, 200, 255, 255]));
    const calm = mapFeaturesToSound(b, computeFrameDifference(b.signature, b.signature, 0));
    const change = mapFeaturesToSound(b, computeFrameDifference(a.signature, b.signature, 0));
    expect(calm.ticks).toHaveLength(0);
    expect(change.rhythmicActivity).toBe(1);
    expect(change.ticks.length).toBe(Math.round(DEFAULT_CONFIG.maxTickShare * change.stepsPerFrame));
  });

  it('maps horizontal distribution to stereo panning', () => {
    const left = mapFeaturesToSound(extractFeatures(rects(100, 20, [[0, 0, 20, 20]])), noDiff);
    const right = mapFeaturesToSound(extractFeatures(rects(100, 20, [[80, 0, 100, 20]])), noDiff);
    expect(left.pan).toBeLessThan(-0.5);
    expect(right.pan).toBeGreaterThan(0.5);
    expect(Math.abs(right.pan)).toBeLessThanOrEqual(DEFAULT_CONFIG.panWidth);
  });

  it('is deterministic', () => {
    const f = extractFeatures(noisy(48, 24, 3));
    expect(mapFeaturesToSound(f, noDiff)).toEqual(mapFeaturesToSound(f, noDiff));
  });

  it('respects disabled mappings', () => {
    const cfg: SonificationConfig = { ...DEFAULT_CONFIG, enabled: { ...DEFAULT_CONFIG.enabled, panning: false, intensity: false } };
    const p = mapFeaturesToSound(extractFeatures(rects(100, 20, [[80, 0, 100, 20]])), noDiff, cfg);
    expect(p.pan).toBe(0);
    expect(p.intensity).toBe(0.5);
  });

  it('silences empty frames', () => {
    const p = mapFeaturesToSound(extractFeatures(solid(8, 8, [0, 0, 0, 0])), noDiff);
    expect(p.silent).toBe(true);
    expect(p.notes).toHaveLength(0);
    expect(p.drone.gain).toBe(0);
    expect(p.pad.gain).toBe(0);
  });

  it('keeps all events inside the phrase and pans in range', () => {
    const p = mapFeaturesToSound(extractFeatures(noisy(64, 32, 9)), diffOf({ meanAbsDiff: 0.5, changedFraction: 1, comparedTo: 0 }));
    for (const n of [...p.notes, ...p.ticks]) {
      expect(n.step).toBeGreaterThanOrEqual(0);
      expect(n.step).toBeLessThan(p.stepsPerFrame);
      expect(Math.abs(n.pan)).toBeLessThanOrEqual(1);
    }
    for (const n of p.notes) expect(n.midi).toBeLessThanOrEqual(88);
  });
});

describe('mapFeaturesToSound: harmony and musical rules', () => {
  it('warm colours → major mode, cool colours → minor mode', () => {
    expect(mapFeaturesToSound(extractFeatures(solid(16, 8, [230, 60, 30, 255])), noDiff).mode).toBe('major');
    expect(mapFeaturesToSound(extractFeatures(solid(16, 8, [30, 90, 230, 255])), noDiff).mode).toBe('minor');
  });

  it('dominant palette colour chooses the chord degree', () => {
    const red = mapFeaturesToSound(extractFeatures(solid(16, 8, [230, 40, 40, 255])), noDiff);
    expect(red.chord.degree).toBe(0); // red → I
    expect(red.chord.name).toBe('D');
    const cyan = mapFeaturesToSound(extractFeatures(solid(16, 8, [30, 200, 220, 255])), noDiff);
    expect(cyan.mode).toBe('minor');
    expect(cyan.chord.roman).toBe('III'); // cyan → III in D minor (F major)
    expect(cyan.chord.name).toBe('F');
  });

  it('visual complexity (entropy) sets chord size', () => {
    const flat = mapFeaturesToSound(extractFeatures(solid(32, 16, [200, 60, 40, 255])), noDiff);
    const complex = mapFeaturesToSound(extractFeatures(noisy(64, 32, 4)), noDiff);
    expect(flat.chord.midis).toHaveLength(3);
    expect(complex.chord.midis.length).toBeGreaterThan(3);
    expect(complex.pad.freqs).toHaveLength(complex.chord.midis.length);
  });

  it('spatial pixel density (coverage) sets tempo', () => {
    const sparse = mapFeaturesToSound(extractFeatures(rects(100, 50, [[45, 20, 50, 25]])), noDiff);
    const dense = mapFeaturesToSound(extractFeatures(rects(100, 50, [[0, 0, 60, 50]])), noDiff);
    expect(sparse.stepsPerFrame).toBe(8);
    expect(dense.stepsPerFrame).toBe(16);
  });

  it('number of distinct shapes sets polyphony', () => {
    const one = mapFeaturesToSound(extractFeatures(rects(120, 60, [[10, 10, 30, 30]])), noDiff);
    const four = mapFeaturesToSound(
      extractFeatures(rects(120, 60, [[5, 5, 20, 20], [40, 5, 55, 20], [80, 5, 95, 20], [40, 35, 55, 50]])),
      noDiff,
    );
    expect(one.voices).toBe(1);
    expect(four.voices).toBe(3);
    expect(four.notes.length).toBe(melody(four).length * 3);
  });

  it('elongated shapes play legato, compact shapes staccato', () => {
    const blob = mapFeaturesToSound(extractFeatures(rects(120, 60, [[50, 20, 70, 40]])), noDiff);
    const bar = mapFeaturesToSound(extractFeatures(rects(120, 60, [[10, 28, 110, 32]])), noDiff);
    expect(blob.articulation).toBeLessThan(0.5);
    expect(bar.articulation).toBeGreaterThan(0.9);
  });

  it('upward motion of the bright centre gives a rising melody', () => {
    const f = extractFeatures(noisy(64, 32, 12));
    const up = mapFeaturesToSound(f, diffOf({ comparedTo: 0, motion: { dx: 0, dy: -0.1 } }));
    const down = mapFeaturesToSound(f, diffOf({ comparedTo: 0, motion: { dx: 0, dy: 0.1 } }));
    const m1 = melody(up).map((n) => n.midi);
    const m2 = melody(down).map((n) => n.midi);
    expect(up.contour).toBe('rising');
    expect(m1).toEqual([...m1].sort((a, b) => a - b));
    expect(m2).toEqual([...m2].sort((a, b) => b - a));
  });
});

describe('helpers', () => {
  it('euclidean distributes pulses evenly', () => {
    expect(euclidean(4, 16).flatMap((b, i) => (b ? [i] : []))).toEqual([0, 4, 8, 12]);
    expect(euclidean(0, 8).some(Boolean)).toBe(false);
    expect(euclidean(99, 8).every(Boolean)).toBe(true);
  });

  it('weightedSequence follows weights', () => {
    const seq = weightedSequence([3, 1], 8);
    expect(seq.filter((i) => i === 0)).toHaveLength(6);
    expect(seq.filter((i) => i === 1)).toHaveLength(2);
  });

  it('hueBinToMidi ascends with hue bin', () => {
    const notes = Array.from({ length: 12 }, (_, i) => hueBinToMidi(i, 50, 'major'));
    for (let i = 1; i < notes.length; i++) expect(notes[i]!).toBeGreaterThan(notes[i - 1]!);
  });

  it('buildChord builds correct diatonic chords', () => {
    expect(buildChord(0, 3, 'major', 50).midis).toEqual([50, 54, 57]); // D F♯ A
    expect(buildChord(1, 3, 'major', 50).name).toBe('Em');
    expect(buildChord(0, 4, 'major', 50).name).toBe('Dmaj7');
    expect(buildChord(0, 3, 'minor', 50).name).toBe('Dm');
    expect(buildChord(4, 4, 'minor', 50).name).toBe('Am7');
  });
});

describe('mapFeaturesToSound: legend values', () => {
  const reading = (p50: number, share = 0.4) => ({ matchedShare: share, matchedPixels: 100, mean: p50, p10: p50, p50, p90: p50, histogram: [], min: 0, max: 32 });
  const f = extractFeatures(solid(32, 16, [30, 120, 220, 255]));

  it('higher legend values raise the melody', () => {
    const cold = mapFeaturesToSound(f, noDiff, DEFAULT_CONFIG, { reading: reading(2), quantity: 'Sea surface temperature', units: '°C' });
    const warm = mapFeaturesToSound(f, noDiff, DEFAULT_CONFIG, { reading: reading(30), quantity: 'Sea surface temperature', units: '°C' });
    expect(warm.notePool[0]!.midi).toBeGreaterThan(cold.notePool[0]!.midi);
    expect(warm.legendValue).toBe(30);
    expect(warm.explanations.find((e) => e.key === 'legend')?.featureValue).toContain('30.0 °C');
  });

  it('ignores legend readings with too few matching pixels', () => {
    const p = mapFeaturesToSound(f, noDiff, DEFAULT_CONFIG, { reading: reading(30, 0.001), quantity: 'X', units: null });
    expect(p.legendValue).toBeNull();
    expect(p.explanations.find((e) => e.key === 'legend')?.featureValue).toContain('too few');
  });

  it('has no legend row when the resource has no legend', () => {
    expect(mapFeaturesToSound(f, noDiff).explanations.some((e) => e.key === 'legend')).toBe(false);
  });
});
