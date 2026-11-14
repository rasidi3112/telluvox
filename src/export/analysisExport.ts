/**
 * Export the full analysis + sonification of a sequence as CSV or JSON, so the
 * creative process can be documented and audited ("telling the story").
 * Every value comes from the same analyzer and mapper used for playback.
 */
import { computeFrameDifference, hueName, type FrameSignature } from '../analyzer/featureExtractor';
import type { FrameAnalyzer } from '../analyzer/frameAnalyzer';
import { mapFeaturesToSound, midiName, type SonificationConfig } from '../audio/sonificationMapper';
import type { FrameImageStore, VisualizationCollection } from '../eic/resourceAdapter';

export interface ExportRow {
  frame: number;
  label: string;
  timeLabel: string;
  brightness: number;
  meanR: number;
  meanG: number;
  meanB: number;
  dominantHue: string;
  saturation: number;
  warmth: number;
  entropy: number;
  variation: number;
  edgeDensity: number;
  coverage: number;
  shapes: number;
  meanElongation: number;
  centroidX: number;
  centroidY: number;
  frameDifference: number | null;
  motionDy: number | null;
  mode: string;
  chord: string;
  stepsPerFrame: number;
  melodyNotes: number;
  voices: number;
  ticks: number;
  pan: number;
  gainDb: number;
  pitches: string;
}

export async function analyzeSequence(
  collection: VisualizationCollection,
  images: FrameImageStore,
  analyzer: FrameAnalyzer,
  config: SonificationConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  let prev: FrameSignature | null = null;
  for (const f of collection.frames) {
    const img = await images.get(f);
    const out = analyzer.analyze(img);
    if (!out.ok) throw new Error(`Frame ${f.index + 1}: ${out.message}`);
    const feat = out.features;
    const diff = computeFrameDifference(prev, feat.signature, prev ? f.index - 1 : null);
    const p = mapFeaturesToSound(feat, diff, config);
    rows.push({
      frame: f.index + 1,
      label: f.label,
      timeLabel: f.timeLabel ?? '',
      brightness: feat.brightness,
      meanR: feat.meanRGB.r,
      meanG: feat.meanRGB.g,
      meanB: feat.meanRGB.b,
      dominantHue: hueName(feat.palette[0]?.hue ?? feat.dominantHue),
      saturation: feat.meanSaturation,
      warmth: feat.warmth,
      entropy: feat.entropy,
      variation: feat.variation,
      edgeDensity: feat.edgeDensity,
      coverage: feat.shapes.coverage,
      shapes: feat.shapes.count,
      meanElongation: feat.shapes.meanElongation,
      centroidX: feat.horizontalCentroid,
      centroidY: feat.verticalCentroid,
      frameDifference: diff.comparedTo === null ? null : diff.meanAbsDiff,
      motionDy: diff.comparedTo === null ? null : diff.motion.dy,
      mode: p.mode,
      chord: `${p.chord.name} (${p.chord.roman})`,
      stepsPerFrame: p.stepsPerFrame,
      melodyNotes: p.notes.filter((n) => n.voice === 0).length,
      voices: p.voices,
      ticks: p.ticks.length,
      pan: p.pan,
      gainDb: 20 * Math.log10(p.gain),
      pitches: p.notePool.map((n) => midiName(n.midi)).join(' '),
    });
    prev = feat.signature;
    onProgress?.(f.index + 1, collection.frames.length);
  }
  return rows;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(5)) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: ExportRow[], collection: VisualizationCollection): string {
  const header = Object.keys(rows[0] ?? {}) as (keyof ExportRow)[];
  const meta = [
    `# TELLUVOX analysis export: ${collection.title}`,
    `# ${collection.isDemonstration ? 'SYNTHETIC DEMONSTRATION DATA, not NASA data.' : 'User-supplied frames.'} ${collection.provenance}`,
    '# Values describe image characteristics (0..1 unless noted); they are not physical measurements.',
  ];
  return [...meta, header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
}

export function toJSON(rows: ExportRow[], collection: VisualizationCollection, config: SonificationConfig): string {
  return JSON.stringify(
    {
      generator: 'TELLUVOX',
      exportedAt: new Date().toISOString(),
      collection: {
        title: collection.title,
        kind: collection.kind,
        isDemonstration: collection.isDemonstration,
        provenance: collection.provenance,
        attribution: collection.attribution,
        georeferenced: collection.georeferenced,
      },
      note: 'Values describe image characteristics; they are not physical measurements. Mappings are experimental.',
      sonificationConfig: config,
      frames: rows,
    },
    null,
    2,
  );
}

export function downloadText(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
