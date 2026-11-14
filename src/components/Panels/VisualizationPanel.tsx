import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { getRuntime } from '../../app/runtime';
import { hueName, SIGNATURE_COLS, SIGNATURE_ROWS } from '../../analyzer/featureExtractor';
import { rgbToHsv } from '../../analyzer/palette';
import { equirectUvToLatLon, formatLatLon } from '../../scene/geo/coords';
import type { PipelineSnapshot, ProbeCell } from '../../sync/pipelineController';
import { pct } from '../format';

export type OverlayMode = 'image' | 'measure' | 'shapes' | 'change' | 'explore';
const MODES: { id: OverlayMode; label: string; hint: string }[] = [
  { id: 'image', label: 'Image', hint: 'The frame exactly as analyzed' },
  { id: 'measure', label: 'Measure', hint: 'Centroid and brightness bands' },
  { id: 'shapes', label: 'Shapes', hint: 'Detected regions and their orientation' },
  { id: 'change', label: 'Change', hint: 'Where the frame changed since the previous one' },
  { id: 'explore', label: 'Explore', hint: 'Touch, hover or use arrow keys to hear each area' },
];

function imageSize(img: CanvasImageSource | null): { w: number; h: number } | null {
  if (!img) return null;
  if (img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  const s = img as { width?: unknown; height?: unknown };
  return typeof s.width === 'number' && typeof s.height === 'number' ? { w: s.width, h: s.height } : null;
}

export function describeCell(snap: PipelineSnapshot, cell: ProbeCell): string {
  const a = snap.analysis;
  if (!a) return '';
  const g = a.features.grid;
  const i = cell.row * g.cols + cell.col;
  const r = g.rgb[i * 3] ?? 0, gg = g.rgb[i * 3 + 1] ?? 0, b = g.rgb[i * 3 + 2] ?? 0;
  const hsv = rgbToHsv(r, gg, b);
  const colour = hsv.s < 0.08 || hsv.h === null ? 'grey' : hueName(hsv.h);
  let where = `Column ${cell.col + 1} of ${g.cols}, row ${cell.row + 1} of ${g.rows}`;
  if (snap.collection?.georeferenced) {
    const ll = equirectUvToLatLon((cell.col + 0.5) / g.cols, (cell.row + 0.5) / g.rows);
    where += ` (${formatLatLon(ll.lat, ll.lon)})`;
  }
  return `${where}: brightness ${pct(g.luma[i] ?? 0)}, ${colour}.`;
}

export function VisualizationPanel({ snap }: { snap: PipelineSnapshot }) {
  const { controller } = getRuntime();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<OverlayMode>('measure');
  const { collection, image, analysis, frame, probe } = snap;
  const size = imageSize(image);
  const w = size?.w ?? 0, h = size?.h ?? 0;

  // Draw exactly the image object that was analyzed.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !image || !w) return;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0);
  }, [image, w, h]);

  // Overlays visualise what the analyzer measured (shape- and label-coded, not colour-only).
  useEffect(() => {
    const c = overlayRef.current;
    if (!c || !w) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!analysis || analysis.frameUrl !== frame?.url || mode === 'image') return;
    const f = analysis.features;
    const s = Math.max(1, w / 640);
    const ink = 'rgba(244,250,255,0.92)';
    ctx.font = `${11 * s}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.lineWidth = 1.25 * s;

    const label = (text: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
      ctx.textAlign = align;
      const m = ctx.measureText(text);
      const bx = align === 'right' ? x - m.width - 6 * s : align === 'center' ? x - m.width / 2 - 3 * s : x - 3 * s;
      ctx.fillStyle = 'rgba(4,11,22,0.78)';
      ctx.fillRect(bx, y - 11 * s, m.width + 6 * s, 15 * s);
      ctx.fillStyle = ink;
      ctx.fillText(text, x, y);
    };

    if (mode === 'measure') {
      const bands = f.columnEnergy.length;
      for (let i = 0; i < bands; i++) {
        const e = f.columnEnergy[i] ?? 0;
        const bw = w / bands, bh = Math.max(2, e * h * 0.32);
        ctx.fillStyle = 'rgba(244,250,255,0.10)';
        ctx.fillRect(i * bw + 2 * s, h - bh, bw - 4 * s, bh);
        ctx.fillStyle = ink;
        ctx.fillRect(i * bw + 2 * s, h - bh, bw - 4 * s, 1.5 * s);
      }
      const rows = f.rowEnergy.length;
      for (let i = 0; i < rows; i++) {
        const e = f.rowEnergy[i] ?? 0;
        const rh = h / rows, rw = Math.max(2, e * w * 0.16);
        ctx.fillStyle = 'rgba(244,250,255,0.10)';
        ctx.fillRect(0, i * rh + 2 * s, rw, rh - 4 * s);
        ctx.fillStyle = ink;
        ctx.fillRect(rw - 1.5 * s, i * rh + 2 * s, 1.5 * s, rh - 4 * s);
      }
      const x = f.horizontalCentroid * w, y = f.verticalCentroid * h;
      ctx.strokeStyle = ink;
      ctx.setLineDash([5 * s, 5 * s]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 10 * s, 0, Math.PI * 2);
      ctx.stroke();
      label(`centroid ${pct(f.horizontalCentroid)} · ${pct(f.verticalCentroid)}`, x + (x > w * 0.7 ? -14 : 14) * s, 18 * s, x > w * 0.7 ? 'right' : 'left');
    }

    if (mode === 'shapes') {
      f.shapes.regions.forEach((r, i) => {
        const x0 = r.bbox.x0 * w, y0 = r.bbox.y0 * h, x1 = r.bbox.x1 * w, y1 = r.bbox.y1 * h;
        ctx.strokeStyle = i === 0 ? 'rgba(255,209,102,0.95)' : ink;
        ctx.setLineDash(i === 0 ? [] : [4 * s, 3 * s]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
        // major axis
        const cx = r.cx * w, cy = r.cy * h;
        const len = Math.min(x1 - x0, y1 - y0) * 0.5 * Math.min(3, Math.sqrt(r.elongation)) + 6 * s;
        const a = (-r.orientation * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * len, cy - Math.sin(a) * len);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
        if (i < 6) label(`#${i + 1} ${pct(r.area, 1)} · ${r.elongation.toFixed(1)}∶1`, x0, Math.max(14 * s, y0 - 4 * s));
      });
      label(`${f.shapes.count} shape${f.shapes.count === 1 ? '' : 's'} · coverage ${pct(f.shapes.coverage)}`, w - 8 * s, h - 8 * s, 'right');
    }

    if (mode === 'change') {
      const cm = analysis.diff.changeMap;
      if (cm) {
        const cw = w / SIGNATURE_COLS, ch = h / SIGNATURE_ROWS;
        for (let i = 0; i < cm.length; i++) {
          const v = Math.min(1, (cm[i] ?? 0) * 5);
          if (v < 0.04) continue;
          ctx.fillStyle = `rgba(255,209,102,${0.12 + v * 0.6})`;
          ctx.fillRect((i % SIGNATURE_COLS) * cw, Math.floor(i / SIGNATURE_COLS) * ch, cw, ch);
        }
        const cx = f.signature.cx * w, cy = f.signature.cy * h;
        const px = cx - analysis.diff.motion.dx * w, py = cy - analysis.diff.motion.dy * h;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        const ang = Math.atan2(cy - py, cx - px);
        if (Math.hypot(cx - px, cy - py) > 3 * s) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx - Math.cos(ang - 0.5) * 9 * s, cy - Math.sin(ang - 0.5) * 9 * s);
          ctx.lineTo(cx - Math.cos(ang + 0.5) * 9 * s, cy - Math.sin(ang + 0.5) * 9 * s);
          ctx.closePath();
          ctx.fillStyle = ink;
          ctx.fill();
        }
        label(`${(analysis.diff.meanAbsDiff * 100).toFixed(1)}% change vs frame ${(analysis.diff.comparedTo ?? 0) + 1}`, 8 * s, 18 * s);
      } else {
        label('First frame: nothing to compare yet', 8 * s, 18 * s);
      }
    }

    if (mode === 'explore') {
      const g = f.grid;
      ctx.strokeStyle = 'rgba(244,250,255,0.16)';
      ctx.lineWidth = 1;
      for (let i = 1; i < g.cols; i++) {
        ctx.beginPath();
        ctx.moveTo((i / g.cols) * w, 0);
        ctx.lineTo((i / g.cols) * w, h);
        ctx.stroke();
      }
      for (let j = 1; j < g.rows; j++) {
        ctx.beginPath();
        ctx.moveTo(0, (j / g.rows) * h);
        ctx.lineTo(w, (j / g.rows) * h);
        ctx.stroke();
      }
      if (probe) {
        ctx.strokeStyle = 'rgba(255,209,102,1)';
        ctx.lineWidth = 2.5 * s;
        ctx.strokeRect((probe.col / g.cols) * w + 1, (probe.row / g.rows) * h + 1, w / g.cols - 2, h / g.rows - 2);
      }
    }
  }, [mode, analysis, frame?.url, w, h, probe]);

  const cellFromEvent = (e: PointerEvent<HTMLDivElement>): ProbeCell | null => {
    const g = analysis?.features.grid;
    if (!g) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    return { col: Math.floor(u * g.cols), row: Math.floor(v * g.rows) };
  };
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (mode !== 'explore') return;
    const c = cellFromEvent(e);
    if (c && (c.col !== probe?.col || c.row !== probe?.row)) controller.setProbe(c);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'explore' || !analysis) return;
    const g = analysis.features.grid;
    const cur = probe ?? { col: Math.floor(g.cols / 2), row: Math.floor(g.rows / 2) };
    let next: ProbeCell | null = cur;
    if (e.key === 'ArrowLeft') next = { ...cur, col: Math.max(0, cur.col - 1) };
    else if (e.key === 'ArrowRight') next = { ...cur, col: Math.min(g.cols - 1, cur.col + 1) };
    else if (e.key === 'ArrowUp') next = { ...cur, row: Math.max(0, cur.row - 1) };
    else if (e.key === 'ArrowDown') next = { ...cur, row: Math.min(g.rows - 1, cur.row + 1) };
    else if (e.key === 'Home') next = { ...cur, col: 0 };
    else if (e.key === 'End') next = { ...cur, col: g.cols - 1 };
    else if (e.key === 'Enter' || e.key === ' ') next = cur;
    else if (e.key === 'Escape') next = null;
    else return;
    e.preventDefault();
    e.stopPropagation();
    controller.setProbe(next);
  };

  const altText =
    frame && analysis
      ? `${frame.label}. ${collection?.isDemonstration ? 'Synthetic test pattern. ' : ''}Brightness ${pct(analysis.features.brightness)}; mostly ${hueName(
          analysis.features.palette[0]?.hue ?? analysis.features.dominantHue,
        )}; ${analysis.features.shapes.count} distinct shapes; visual weight ${pct(analysis.features.horizontalCentroid)} from the left.`
      : 'No frame loaded.';
  const exploring = mode === 'explore';
  const modeHint = MODES.find((m) => m.id === mode)?.hint ?? '';

  return (
    <section className="stage-frame" aria-label="Visualization frame">
      <div className="stage-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Frame overlay">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)} title={m.hint}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="stage-hint">{modeHint}</span>
      </div>

      <div
        className={`viz-stage${exploring ? ' is-exploring' : ''}`}
        style={size ? { aspectRatio: `${w} / ${h}` } : undefined}
        tabIndex={exploring ? 0 : -1}
        role={exploring ? 'application' : undefined}
        aria-label={exploring ? 'Image explorer. Use arrow keys to move between areas; each area is described and played as a tone. Escape to stop.' : undefined}
        aria-describedby={exploring ? 'explorer-readout' : undefined}
        data-own-keys={exploring ? 'true' : undefined}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onKeyDown={onKey}
      >
        <canvas ref={canvasRef} role="img" aria-label={altText} />
        <canvas ref={overlayRef} aria-hidden="true" className="viz-overlay" />
        {!image && (
          <div className="viz-placeholder" role="status">
            {snap.loadState === 'loading' ? 'Loading frames…' : snap.loadState === 'error' ? `Could not load frames: ${snap.loadError}` : snap.analysisError ?? 'Preparing first frame…'}
          </div>
        )}
      </div>

      {exploring && (
        <p id="explorer-readout" className="explorer-readout" aria-live="polite">
          {probe ? describeCell(snap, probe) : 'Move across the image (or focus it and use the arrow keys) to hear and read each area.'}
          {probe && !(snap.audioWanted && snap.engineState === 'running') ? ' Start sound to hear it.' : ''}
        </p>
      )}
      {snap.analysisError && image && (
        <div className="notice notice-error" role="alert">
          {snap.analysisError}
        </div>
      )}
    </section>
  );
}
