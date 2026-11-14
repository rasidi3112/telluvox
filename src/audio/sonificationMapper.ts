/**
 * Sonification mapper: VisualFeatures → SonificationParams.
 *
 * A musical ruleset that keeps the output pleasant (one key, consonant chords,
 * pentatonic melody) while every audible choice is driven by a measured
 * visual feature. Pure and deterministic: no Math.random(); the same frame
 * always produces the same phrase. These are EXPERIMENTAL, aesthetic mappings
 * of image characteristics, not scientific measurements.
 *
 *   Visual feature                         → Audio parameter
 *   ---------------------------------------------------------------------
 *   Average brightness                     → Intensity (gain)
 *   Dominant palette colour                → Harmony (chord degree in the key)
 *   Warm / cool colour balance             → Mode (major / minor)
 *   Visual complexity (entropy)            → Chord size (triad / 7th / 9th)
 *   Hue distribution                       → Melody pitches (pentatonic ladder)
 *   Pixel intensity distribution           → Register (octave)
 *   Pixel variation (contrast + edges)     → Note density
 *   Spatial pixel density (coverage)       → Tempo (steps per frame)
 *   Frame-to-frame difference              → Rhythmic activity (ticks)
 *   Shape elongation                       → Articulation (staccato … legato)
 *   Number of distinct shapes              → Polyphony (1–3 voices)
 *   Motion of the bright centre            → Melodic contour (rising / falling)
 *   Horizontal visual distribution         → Stereo panning
 *   Mean saturation                        → Timbre (filter brightness)
 */
import { HUE_BINS, hueBinName, hueName, type FrameDifference, type VisualFeatures } from '../analyzer/featureExtractor';
import type { LegendReading } from '../analyzer/legendReader';

/** Values estimated from a published colour bar (official resources with a numeric legend). */
export interface LegendContext {
  reading: LegendReading;
  quantity: string;
  units: string | null;
}

/** Below this share of matching pixels a legend reading is not used. */
export const MIN_LEGEND_SHARE = 0.02;

export type MappingKey =
  | 'intensity'
  | 'harmony'
  | 'mode'
  | 'chordSize'
  | 'pitch'
  | 'legend'
  | 'register'
  | 'density'
  | 'tempo'
  | 'rhythm'
  | 'articulation'
  | 'polyphony'
  | 'contour'
  | 'panning'
  | 'timbre';

export const MAPPING_KEYS: MappingKey[] = [
  'intensity',
  'harmony',
  'mode',
  'chordSize',
  'pitch',
  'legend',
  'register',
  'density',
  'tempo',
  'rhythm',
  'articulation',
  'polyphony',
  'contour',
  'panning',
  'timbre',
];

export type Mode = 'major' | 'minor';
export type Instrument = 'glass' | 'soft' | 'pluck';

export const SCALE7: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
export const PENTATONIC: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
};
/** Colour-wheel sector (60° each, centred on red) → scale degree. Adjacent sectors are fifth-related. */
const DEGREE_BY_SECTOR: Record<Mode, readonly number[]> = {
  major: [0, 4, 1, 5, 2, 3], // red I, yellow V, green ii, cyan vi, blue iii, magenta IV
  minor: [0, 4, 6, 2, 5, 3], // red i, yellow v, green VII, cyan III, blue VI, magenta iv
};

export const KEYS = [
  { name: 'C', midi: 48 },
  { name: 'D', midi: 50 },
  { name: 'E', midi: 52 },
  { name: 'F', midi: 53 },
  { name: 'G', midi: 55 },
  { name: 'A', midi: 57 },
] as const;

export interface SonificationConfig {
  enabled: Record<MappingKey, boolean>;
  /** MIDI note of the key's tonic (pad register). */
  rootMidi: number;
  instrument: Instrument;
  /** Voice gain range (linear, before master volume). Kept low to avoid harshness. */
  minGain: number;
  maxGain: number;
  /** Note density range as a share of the phrase's steps. */
  minNoteShare: number;
  maxNoteShare: number;
  maxTickShare: number;
  /** Maximum stereo deflection, 0..1. */
  panWidth: number;
  /** Frame difference (mean |ΔL|) that produces full rhythmic activity. */
  diffFullScale: number;
  /** Hue bins below this share are ignored when building the melody pool. */
  minHueShare: number;
  maxPoolSize: number;
  /** Steps per frame used when the tempo mapping is off. */
  defaultSteps: number;
}

export const DEFAULT_CONFIG: SonificationConfig = {
  enabled: {
    intensity: true,
    harmony: true,
    mode: true,
    chordSize: true,
    pitch: true,
    legend: true,
    register: true,
    density: true,
    tempo: true,
    rhythm: true,
    articulation: true,
    polyphony: true,
    contour: true,
    panning: true,
    timbre: true,
  },
  rootMidi: 50, // D3
  instrument: 'glass',
  minGain: 0.035,
  maxGain: 0.2,
  minNoteShare: 2 / 16,
  maxNoteShare: 12 / 16,
  maxTickShare: 8 / 16,
  panWidth: 0.85,
  diffFullScale: 0.12,
  minHueShare: 0.04,
  maxPoolSize: 5,
  defaultSteps: 16,
};

export interface PoolNote {
  midi: number;
  freq: number;
  weight: number;
  hueBin: number | null;
}

export interface NoteEvent {
  step: number;
  midi: number;
  freq: number;
  velocity: number;
  pan: number;
  durationSteps: number;
  hueBin: number | null;
  /** 0 = melody, 1–2 = added polyphonic voices. */
  voice: number;
}

export interface TickEvent {
  step: number;
  velocity: number;
  pan: number;
}

export interface Chord {
  degree: number;
  roman: string;
  name: string;
  midis: number[];
  freqs: number[];
}

export interface MappingExplanation {
  key: MappingKey;
  feature: string;
  featureValue: string;
  parameter: string;
  parameterValue: string;
  enabled: boolean;
}

export interface SonificationParams {
  stepsPerFrame: number;
  intensity: number;
  gain: number;
  pan: number;
  filterHz: number;
  instrument: Instrument;
  mode: Mode;
  /** Key name, e.g. "D minor". */
  key: string;
  chord: Chord;
  pad: { freqs: number[]; gain: number };
  drone: { freqs: [number, number]; gain: number; pan: number };
  notePool: PoolNote[];
  notes: NoteEvent[];
  ticks: TickEvent[];
  registerShift: number;
  rhythmicActivity: number;
  /** Note-length factor 0.35 (staccato) … 1 (legato). */
  articulation: number;
  voices: number;
  contour: 'rising' | 'falling' | 'steady';
  /** Median data value read from the colour bar, when used. */
  legendValue: number | null;
  explanations: MappingExplanation[];
  silent: boolean;
}

/** Highest melody note (E6). */
const MAX_MIDI = 88;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function midiName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
export function pitchClassName(midi: number): string {
  return NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12] as string;
}

/** Evenly distribute `pulses` onsets over `steps` (Euclidean / Bresenham rhythm). */
export function euclidean(pulses: number, steps: number, rotation = 0): boolean[] {
  const k = clamp(Math.round(pulses), 0, steps);
  const out = new Array<boolean>(steps).fill(false);
  if (k === 0) return out;
  for (let i = 0; i < steps; i++) out[(i + rotation) % steps] = (i * k) % steps < k;
  return out;
}

/** Map a hue bin (0 = red … 11 = rose) onto the mode's pentatonic ladder above the root. */
export function hueBinToMidi(bin: number, rootMidi: number, mode: Mode = 'major'): number {
  const degrees = PENTATONIC[mode];
  const octave = Math.floor(bin / degrees.length);
  return rootMidi + 12 * octave + (degrees[bin % degrees.length] as number);
}

/** Deterministic smooth weighted round-robin. */
export function weightedSequence(weights: number[], length: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || total <= 0) return [];
  const current = new Array<number>(weights.length).fill(0);
  const seq: number[] = [];
  for (let n = 0; n < length; n++) {
    let best = 0;
    for (let i = 0; i < weights.length; i++) {
      current[i]! += weights[i] as number;
      if ((current[i] as number) > (current[best] as number)) best = i;
    }
    current[best]! -= total;
    seq.push(best);
  }
  return seq;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Diatonic chord of `size` stacked thirds on `degree` of the mode, rooted near `rootMidi`. */
export function buildChord(degree: number, size: number, mode: Mode, rootMidi: number): Chord {
  const scale = SCALE7[mode];
  const midis: number[] = [];
  for (let i = 0; i < size; i++) {
    const idx = degree + 2 * i;
    midis.push(rootMidi + 12 * Math.floor(idx / 7) + (scale[idx % 7] as number));
  }
  const third = (midis[1] as number) - (midis[0] as number);
  const isMajor = third === 4;
  const seventh = midis[3] !== undefined ? (midis[3] as number) - (midis[0] as number) : null;
  let suffix = isMajor ? '' : 'm';
  if (size === 4) suffix += seventh === 11 ? 'maj7' : '7';
  if (size >= 5) suffix += seventh === 11 ? 'maj9' : '9';
  const numeral = ROMAN[degree] as string;
  return {
    degree,
    roman: isMajor ? numeral : numeral.toLowerCase(),
    name: `${pitchClassName(midis[0] as number)}${suffix}`,
    midis,
    freqs: midis.map(midiToFreq),
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (g: number) => `${(20 * Math.log10(Math.max(g, 1e-6))).toFixed(1)} dB`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function mapFeaturesToSound(
  features: VisualFeatures,
  diff: FrameDifference,
  config: SonificationConfig = DEFAULT_CONFIG,
  legend?: LegendContext,
): SonificationParams {
  const on = config.enabled;
  const root = config.rootMidi;
  const silent = features.isEmpty;
  const shapes = features.shapes;

  // Intensity ← brightness (square-root curve: more contrast between dim frames)
  const intensity = on.intensity ? clamp(features.brightness, 0, 1) : 0.5;
  const gain = lerp(config.minGain, config.maxGain, Math.sqrt(intensity));

  // Mode ← warm/cool balance
  const mode: Mode = on.mode && features.warmth < 0 ? 'minor' : 'major';

  // Harmony ← dominant chromatic palette colour
  const dominant = features.palette.filter((p) => p.hue !== null && p.saturation >= 0.15).sort((a, b) => b.weight - a.weight)[0];
  let degree = 0;
  if (on.harmony && dominant && dominant.hue !== null) {
    const sector = Math.floor((((dominant.hue + 30) % 360) + 360) % 360 / 60);
    degree = DEGREE_BY_SECTOR[mode][sector] as number;
  }
  // Chord size ← entropy
  const chordSize = on.chordSize ? (features.entropy < 0.45 ? 3 : features.entropy < 0.7 ? 4 : 5) : 3;
  const chord = buildChord(degree, chordSize, mode, root);

  // Tempo ← spatial pixel density (coverage of the bright foreground)
  const coverage = shapes.coverage;
  const steps = on.tempo ? (coverage < 0.12 ? 8 : coverage < 0.3 ? 12 : 16) : config.defaultSteps;

  // Panning ← horizontal centroid
  const pan = on.panning ? clamp((features.horizontalCentroid - 0.5) * 2.5, -1, 1) * config.panWidth : 0;

  // Timbre ← mean saturation
  const filterHz = on.timbre ? 500 * Math.pow(10, clamp(features.meanSaturation, 0, 1)) : 1800;

  // Register ← intensity distribution
  const { p10, p50, p90 } = features.intensityPercentiles;
  let registerShift = on.register ? 12 * clamp(Math.round((p50 - 0.35) * 2.5), -1, 1) : 0;

  // Data value ← published colour bar (overrides the visual register when available)
  const lr = legend?.reading;
  const legendUsable = !!lr && on.legend && lr.matchedShare >= MIN_LEGEND_SHARE && Number.isFinite(lr.p50) && lr.max > lr.min;
  let legendSteps = 0;
  let legendValue: number | null = null;
  if (legendUsable && lr) {
    const v = clamp((lr.p50 - lr.min) / (lr.max - lr.min), 0, 1);
    legendValue = lr.p50;
    legendSteps = Math.round(v * 4);
    registerShift = 12 * clamp(Math.round((v - 0.5) * 2.4), -1, 1);
  }
  const leapEvery = on.register && p90 - p10 > 0.45 ? 3 : 0;
  const melodyRoot = root + 12 + registerShift;

  // Melody pitch pool ← hue histogram
  let notePool: PoolNote[] = [];
  if (on.pitch && features.hueHistogram.some((w) => w > 0)) {
    notePool = features.hueHistogram
      .map((weight, bin) => ({ weight, bin }))
      .filter((h) => h.weight >= config.minHueShare)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, config.maxPoolSize)
      .map(({ weight, bin }) => {
        const midi = hueBinToMidi(bin + legendSteps, melodyRoot, mode);
        return { midi, freq: midiToFreq(midi), weight, hueBin: bin };
      });
  }
  if (notePool.length === 0) {
    // Achromatic frame (or pitch mapping off): chord tones.
    notePool = chord.midis.slice(0, 3).map((m, i) => ({ midi: m + 12 + registerShift, freq: midiToFreq(m + 12 + registerShift), weight: [0.5, 0.3, 0.2][i] as number, hueBin: null }));
  }

  // Density ← variation
  const noteShare = on.density ? lerp(config.minNoteShare, config.maxNoteShare, features.variation) : (config.minNoteShare + config.maxNoteShare) / 2;
  const noteCount = Math.max(1, Math.round(noteShare * steps));

  // Rhythm ← frame difference
  const rhythmicActivity =
    on.rhythm && diff.comparedTo !== null ? clamp(Math.max(diff.meanAbsDiff / config.diffFullScale, diff.changedFraction * 0.8), 0, 1) : 0;
  const tickCount = Math.round(rhythmicActivity * config.maxTickShare * steps);

  // Articulation ← shape elongation
  const articulation =
    on.articulation && shapes.count > 0 ? 0.35 + 0.65 * clamp((shapes.meanElongation - 1) / 3, 0, 1) : 0.75;

  // Polyphony ← number of distinct shapes
  const voices = on.polyphony ? (shapes.count <= 1 ? 1 : shapes.count <= 3 ? 2 : 3) : 1;

  // Contour ← vertical motion of the bright centre (image y grows downward)
  const dy = diff.comparedTo === null ? 0 : diff.motion.dy;
  const contour: SonificationParams['contour'] = on.contour ? (dy < -0.01 ? 'rising' : dy > 0.01 ? 'falling' : 'steady') : 'steady';

  // ---- assemble the phrase ----
  const noteGrid = euclidean(silent ? 0 : noteCount, steps);
  const onsets = noteGrid.flatMap((hit, i) => (hit ? [i] : []));
  const order = weightedSequence(notePool.map((p) => p.weight), onsets.length);
  let melody = onsets.map((step, j) => {
    const p = notePool[order[j] as number] as PoolNote;
    const leap = leapEvery > 0 && j % leapEvery === leapEvery - 1 ? 12 : 0;
    let midi = p.midi + leap;
    while (midi > MAX_MIDI) midi -= 12; // keep the melody out of the shrill register
    return { step, midi, weight: p.weight, hueBin: p.hueBin };
  });
  if (contour !== 'steady') {
    const pitches = melody.map((m) => ({ midi: m.midi, weight: m.weight, hueBin: m.hueBin })).sort((a, b) => (contour === 'rising' ? a.midi - b.midi : b.midi - a.midi));
    melody = melody.map((m, j) => ({ ...m, ...(pitches[j] as { midi: number; weight: number; hueBin: number | null }) }));
  }
  const notes: NoteEvent[] = [];
  melody.forEach((m, j) => {
    const nextOnset = onsets[j + 1] ?? steps;
    const durationSteps = clamp(nextOnset - m.step, 1, 4);
    const velocity = 0.55 + 0.45 * clamp(m.weight * 2, 0, 1);
    const npan = clamp(pan + (j % 2 === 0 ? -0.08 : 0.08) * (on.panning ? 1 : 0), -1, 1);
    notes.push({ step: m.step, midi: m.midi, freq: midiToFreq(m.midi), velocity, pan: npan, durationSteps, hueBin: m.hueBin, voice: 0 });
    if (voices >= 2) {
      const mm = m.midi + 7;
      notes.push({ step: m.step, midi: mm, freq: midiToFreq(mm), velocity: velocity * 0.55, pan: clamp(npan + 0.25, -1, 1), durationSteps, hueBin: m.hueBin, voice: 1 });
    }
    if (voices >= 3) {
      const mm = m.midi - 12;
      notes.push({ step: m.step, midi: mm, freq: midiToFreq(mm), velocity: velocity * 0.45, pan: clamp(npan - 0.25, -1, 1), durationSteps, hueBin: m.hueBin, voice: 2 });
    }
  });

  const tickGrid = euclidean(silent ? 0 : tickCount, steps, Math.floor(steps / 8));
  const ticks: TickEvent[] = tickGrid.flatMap((hit, step) => (hit ? [{ step, velocity: 0.35 + 0.65 * rhythmicActivity, pan: -pan * 0.4 }] : []));

  const bass = (chord.midis[0] as number) - 12;
  const drone = {
    freqs: [midiToFreq(bass), midiToFreq(bass + 7)] as [number, number],
    gain: silent ? 0 : gain * 0.5,
    pan: pan * 0.5,
  };
  const pad = { freqs: chord.freqs, gain: silent ? 0 : gain * 0.42 };

  const topHues = notePool
    .filter((p) => p.hueBin !== null)
    .slice(0, 3)
    .map((p) => `${hueBinName(p.hueBin as number)} ${pct(p.weight)}`)
    .join(', ');

  const melodyCount = notes.filter((n) => n.voice === 0).length;
  const explanations: MappingExplanation[] = [
    { key: 'intensity', feature: 'Average brightness', featureValue: pct(features.brightness), parameter: 'Intensity', parameterValue: db(gain), enabled: on.intensity },
    {
      key: 'harmony',
      feature: 'Dominant palette colour',
      featureValue: dominant && dominant.hue !== null ? `${hueName(dominant.hue)} (${pct(dominant.weight)} of frame)` : 'no saturated colour',
      parameter: 'Harmony (chord)',
      parameterValue: `${chord.name} · ${chord.roman} in ${pitchClassName(root)} ${mode}`,
      enabled: on.harmony,
    },
    {
      key: 'mode',
      feature: 'Warm / cool balance',
      featureValue: features.warmth === 0 ? 'neutral' : `${features.warmth > 0 ? 'warm' : 'cool'} ${pct(Math.abs(features.warmth))}`,
      parameter: 'Mode',
      parameterValue: mode,
      enabled: on.mode,
    },
    {
      key: 'chordSize',
      feature: 'Visual complexity (entropy)',
      featureValue: pct(features.entropy),
      parameter: 'Chord size',
      parameterValue: chordSize === 3 ? 'triad' : chordSize === 4 ? 'seventh' : 'ninth',
      enabled: on.chordSize,
    },
    {
      key: 'pitch',
      feature: 'Hue distribution',
      featureValue: topHues || hueName(features.dominantHue),
      parameter: 'Melody pitches',
      parameterValue: notePool.map((p) => midiName(p.midi)).join(' · '),
      enabled: on.pitch,
    },
    ...(legend
      ? [
          {
            key: 'legend' as MappingKey,
            feature: `${legend.quantity} (from colour bar)`,
            featureValue:
              lr && lr.matchedShare >= MIN_LEGEND_SHARE && Number.isFinite(lr.p50)
                ? `≈ ${fmtVal(lr.p50)}${legend.units ? ` ${legend.units}` : ''} median · ${pct(lr.matchedShare)} of pixels matched`
                : 'too few pixels match the colour bar',
            parameter: 'Pitch height',
            parameterValue: legendUsable ? `+${legendSteps} scale steps${registerShift ? `, ${registerShift > 0 ? '+' : '−'}1 octave` : ''}` : 'not used',
            enabled: on.legend,
          },
        ]
      : []),
    {
      key: 'register',
      feature: 'Intensity distribution',
      featureValue: `median ${pct(p50)} · spread ${pct(p90 - p10)}`,
      parameter: 'Register',
      parameterValue: `${registerShift > 0 ? '+1 octave' : registerShift < 0 ? '−1 octave' : 'centre'}${leapEvery ? ', octave leaps' : ''}`,
      enabled: on.register,
    },
    { key: 'density', feature: 'Pixel variation', featureValue: pct(features.variation), parameter: 'Note density', parameterValue: `${melodyCount} of ${steps} steps`, enabled: on.density },
    {
      key: 'tempo',
      feature: 'Spatial pixel density',
      featureValue: `${pct(coverage)} bright coverage`,
      parameter: 'Tempo',
      parameterValue: `${steps} steps per frame`,
      enabled: on.tempo,
    },
    {
      key: 'rhythm',
      feature: 'Frame difference',
      featureValue: diff.comparedTo === null ? 'n/a (first frame)' : `${(diff.meanAbsDiff * 100).toFixed(1)}% mean change`,
      parameter: 'Rhythmic activity',
      parameterValue: plural(ticks.length, 'tick'),
      enabled: on.rhythm,
    },
    {
      key: 'articulation',
      feature: 'Shape elongation',
      featureValue: shapes.count > 0 ? `${shapes.meanElongation.toFixed(1)}∶1` : 'no shapes',
      parameter: 'Articulation',
      parameterValue: articulation < 0.5 ? 'staccato' : articulation < 0.8 ? 'detached' : 'legato',
      enabled: on.articulation,
    },
    { key: 'polyphony', feature: 'Distinct shapes', featureValue: plural(shapes.count, 'region'), parameter: 'Polyphony', parameterValue: plural(voices, 'voice'), enabled: on.polyphony },
    {
      key: 'contour',
      feature: 'Vertical motion',
      featureValue: diff.comparedTo === null ? 'n/a' : `${dy < 0 ? 'up' : dy > 0 ? 'down' : 'still'} ${pct(Math.abs(dy))}`,
      parameter: 'Melodic contour',
      parameterValue: contour,
      enabled: on.contour,
    },
    {
      key: 'panning',
      feature: 'Horizontal distribution',
      featureValue: `centroid ${pct(features.horizontalCentroid)} from left`,
      parameter: 'Stereo panning',
      parameterValue: Math.abs(pan) < 0.05 ? 'centre' : `${pct(Math.abs(pan))} ${pan < 0 ? 'left' : 'right'}`,
      enabled: on.panning,
    },
    { key: 'timbre', feature: 'Mean saturation', featureValue: pct(features.meanSaturation), parameter: 'Timbre', parameterValue: `${Math.round(filterHz)} Hz low-pass`, enabled: on.timbre },
  ];

  return {
    stepsPerFrame: steps,
    intensity,
    gain,
    pan,
    filterHz,
    instrument: config.instrument,
    mode,
    key: `${pitchClassName(root)} ${mode}`,
    chord,
    pad,
    drone,
    notePool,
    notes,
    ticks,
    registerShift,
    rhythmicActivity,
    articulation,
    voices,
    contour,
    legendValue,
    explanations,
    silent,
  };
}

function fmtVal(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

/** Plain-language description of what the listener hears, for screen readers, narration and the UI. */
export function describeSonification(features: VisualFeatures, diff: FrameDifference, params: SonificationParams, legend?: LegendContext): string {
  if (params.silent) return 'This frame is empty or a single flat value, so its phrase is silent.';
  const level = features.brightness < 0.2 ? 'dark' : features.brightness < 0.45 ? 'moderately bright' : 'bright';
  const side = Math.abs(params.pan) < 0.1 ? 'in the centre' : params.pan < 0 ? 'to the left' : 'to the right';
  const busy = params.notes.filter((n) => n.voice === 0).length;
  const shapes = features.shapes.count;
  const change =
    diff.comparedTo === null
      ? 'There is no previous frame to compare yet.'
      : params.ticks.length === 0
        ? `It is almost unchanged from frame ${diff.comparedTo + 1}.`
        : `It changed ${(diff.meanAbsDiff * 100).toFixed(1)}% since frame ${diff.comparedTo + 1}, heard as ${plural(params.ticks.length, 'rhythmic tick')}.`;
  const motion = params.contour === 'rising' ? ' The bright area moved up, so the melody rises.' : params.contour === 'falling' ? ' The bright area moved down, so the melody falls.' : '';
  return (
    `A ${level} frame (${pct(features.brightness)} brightness), mostly ${hueName(features.palette[0]?.hue ?? features.dominantHue)}. ` +
    `Its colours set the chord ${params.chord.name} (${params.chord.roman} in ${params.key}). ` +
    `${shapes === 0 ? 'No distinct shapes stand out' : `${plural(shapes, 'distinct shape')} ${shapes === 1 ? 'stands' : 'stand'} out`}, covering ${pct(features.shapes.coverage)} of the frame, ` +
    `so the melody plays ${busy} notes over ${params.stepsPerFrame} steps with ${plural(params.voices, 'voice')}. ` +
    `Its visual weight sits ${side}, and so does the sound. ${change}${motion}` +
    (params.legendValue !== null && legend
      ? ` Reading the published colour bar, the coloured areas suggest a median ${legend.quantity.toLowerCase()} of about ${fmtVal(params.legendValue)}${legend.units ? ` ${legend.units}` : ''} (an estimate from ${pct(legend.reading.matchedShare)} of the pixels); higher values raise the melody.`
      : '')
  );
}

export const HUE_BIN_COUNT = HUE_BINS;
