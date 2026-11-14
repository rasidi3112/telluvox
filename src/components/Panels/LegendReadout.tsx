import { MIN_LEGEND_SHARE } from '../../audio/sonificationMapper';
import type { PipelineSnapshot } from '../../sync/pipelineController';
import { pct } from '../format';

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

/** Values estimated from the published colour bar for the current frame. */
export function LegendReadout({ snap }: { snap: PipelineSnapshot }) {
  const lg = snap.collection?.legend;
  const r = snap.analysis?.legend;
  if (!lg || lg.categorical) {
    return lg?.categorical ? (
      <p className="fineprint">This legend names categories rather than a numeric scale, so TELLUVOX does not convert its colours into values.</p>
    ) : null;
  }
  if (!lg.strip)
    return <p className="fineprint">{lg.notReadReason ?? 'The colour bar is shown for reference; it is not read automatically.'}</p>;
  if (!r) return <p className="fineprint">Reading the colour bar…</p>;
  const u = lg.units ? ` ${lg.units}` : '';
  const usable = r.matchedShare >= MIN_LEGEND_SHARE && Number.isFinite(r.p50);
  return (
    <div className="legend-readout">
      <p className="eyebrow">Estimated from the colour bar · this frame</p>
      {usable ? (
        <>
          <p className="legend-value">
            ≈ {fmt(r.p50)}
            {u} <small>median</small>
          </p>
          <p className="mono legend-range">
            p10 {fmt(r.p10)}
            {u} · p90 {fmt(r.p90)}
            {u} · {pct(r.matchedShare)} of pixels matched
          </p>
          <div className="hist" role="img" aria-label={`Distribution of estimated ${lg.quantity.toLowerCase()} from ${lg.min} to ${lg.max}${u}`}>
            {r.histogram.map((h, i) => (
              <i key={i} style={{ height: `${Math.max(2, h * 100)}%`, background: 'var(--text-muted)' }} />
            ))}
          </div>
          <div className="hist-labels" aria-hidden="true">
            <span>
              {lg.min}
              {u}
            </span>
            <span>
              {lg.max}
              {u}
            </span>
          </div>
        </>
      ) : (
        <p className="muted">Too few pixels in this frame match the colour bar ({pct(r.matchedShare, 1)}), so no value is estimated.</p>
      )}
      <p className="fineprint">
        Approximate: each pixel is matched to the nearest colour on the published bar. Shading, blending and compression shift colours, and
        unmatched pixels (land, labels, background) are ignored. Use the original data for scientific values.
      </p>
    </div>
  );
}
