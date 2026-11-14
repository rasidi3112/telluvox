import type { PipelineSnapshot } from '../../sync/pipelineController';
import { LegendReadout } from './LegendReadout';

/** Provenance, credits and colour legend of the current collection. */
export function SourcePanel({ snap }: { snap: PipelineSnapshot }) {
  const c = snap.collection;
  if (!c) return null;
  const svs = c.svs;
  const legend = c.legend;
  return (
    <section className="panel source-panel" aria-labelledby="source-title">
      <header className="panel-header">
        <h2 className="panel-title" id="source-title">
          Source &amp; credits
        </h2>
        {svs && (
          <a className="panel-meta" href={svs.pageUrl} target="_blank" rel="noreferrer">
            svs.gsfc.nasa.gov/{svs.id} ↗
          </a>
        )}
      </header>
      <div className="source-grid">
        <div>
          {svs ? (
            <dl className="source-facts">
              <div>
                <dt>Visualization</dt>
                <dd>
                  <a href={svs.pageUrl} target="_blank" rel="noreferrer">
                    {svs.pageTitle}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>NASA Scientific Visualization Studio{svs.releaseDate ? `, ${svs.releaseDate}` : ''}</dd>
              </div>
              <div>
                <dt>Source file</dt>
                <dd className="mono">
                  {svs.sourceFile}
                  {svs.sourceWidth ? ` · ${svs.sourceWidth}×${svs.sourceHeight}` : ''}
                  {svs.sourceDuration ? ` · ${svs.sourceDuration.toFixed(1)} s` : ''}
                </dd>
              </div>
              <div>
                <dt>In TELLUVOX</dt>
                <dd>
                  {c.frames.length === 1 ? 'The still image' : `${c.frames.length} evenly spaced frames`}, downscaled; each frame keeps its video time.
                </dd>
              </div>
              {svs.datasets.length > 0 && (
                <div>
                  <dt>Data</dt>
                  <dd>{svs.datasets.join(' · ')}</dd>
                </div>
              )}
              {svs.credits.length > 0 && (
                <div>
                  <dt>Credits</dt>
                  <dd>
                    <ul className="credit-list">
                      {svs.credits.map((cr) => (
                        <li key={cr}>{cr}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="muted">{c.provenance}</p>
          )}
        </div>
        <div>
          <h3 className="eyebrow">Colour legend</h3>
          {legend ? (
            <>
              {legend.image && <img className="legend-image" src={legend.image} alt={`Published colour bar: ${legend.quantity}${legend.units ? ` (${legend.units})` : ''}`} />}
              <p className="muted">
                <b>{legend.quantity}</b>
                {legend.min !== undefined && legend.max !== undefined ? ` · ${legend.min}–${legend.max} ${legend.units ?? ''}` : ''}
                {legend.categorical ? ' · categories' : ''}
              </p>
              {legend.note && <p className="fineprint">SVS: “{legend.note}”</p>}
              <LegendReadout snap={snap} />
            </>
          ) : (
            <p className="muted">
              No colour legend is published with this visualization, so TELLUVOX sonifies only what the image looks like and makes no claim
              about physical values.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
