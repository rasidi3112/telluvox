import { useRef, useState, type KeyboardEvent } from 'react';
import { getRuntime } from '../../app/runtime';
import { HUE_BINS, hueBinName, hueName } from '../../analyzer/featureExtractor';
import { paletteToCss } from '../../analyzer/palette';
import { KEYS, type Instrument } from '../../audio/sonificationMapper';
import { analyzeSequence, downloadText, toCSV, toJSON } from '../../export/analysisExport';
import { hapticsSupported, speak, speechSupported, stopSpeaking } from '../../hooks/useAccessibilityFeedback';
import type { PipelineSnapshot } from '../../sync/pipelineController';
import { hex, pct } from '../format';

type TabId = 'measure' | 'color' | 'shape' | 'mapping' | 'access';
const TABS: { id: TabId; label: string }[] = [
  { id: 'measure', label: 'Measure' },
  { id: 'color', label: 'Color' },
  { id: 'shape', label: 'Shape & motion' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'access', label: 'Access' },
];

function Metric({ label, value, fraction, note }: { label: string; value: string; fraction?: number; note?: string }) {
  return (
    <div className="metric">
      <dt>
        {label}
        {note && <small>{note}</small>}
      </dt>
      <dd>{value}</dd>
      {fraction !== undefined && (
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }} />
        </div>
      )}
    </div>
  );
}

export function Inspector({ snap }: { snap: PipelineSnapshot }) {
  const [tab, setTab] = useState<TabId>('measure');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[n]!.id);
    tabRefs.current[n]?.focus();
  };

  return (
    <div className="inspector">
      <div className="tabs" role="tablist" aria-label="Analysis inspector" data-own-keys="true">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {tab === 'measure' && <MeasureTab snap={snap} />}
        {tab === 'color' && <ColorTab snap={snap} />}
        {tab === 'shape' && <ShapeTab snap={snap} />}
        {tab === 'mapping' && <MappingTab snap={snap} />}
        {tab === 'access' && <AccessTab snap={snap} />}
      </div>
    </div>
  );
}

function Waiting({ snap }: { snap: PipelineSnapshot }) {
  return <p className="muted">{snap.analysisError ?? 'Waiting for a frame…'}</p>;
}

function MeasureTab({ snap }: { snap: PipelineSnapshot }) {
  const rt = getRuntime();
  const [busy, setBusy] = useState<string | null>(null);
  const a = snap.analysis;
  if (!a) return <Waiting snap={snap} />;
  const f = a.features;
  const exportAs = async (kind: 'csv' | 'json') => {
    const c = snap.collection;
    if (!c) return;
    setBusy('Analyzing all frames…');
    try {
      const rows = await analyzeSequence(c, rt.images, rt.analyzer, snap.config, (d, t) => setBusy(`Analyzing frame ${d} of ${t}…`));
      const slug = c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (kind === 'csv') downloadText(toCSV(rows, c), `telluvox-${slug}-analysis.csv`, 'text/csv');
      else downloadText(toJSON(rows, c, snap.config), `telluvox-${slug}-analysis.json`, 'application/json');
      setBusy(null);
    } catch (e) {
      setBusy(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <>
      <p className="tab-meta">
        {a.sampleWidth}×{a.sampleHeight} px analysis grid · {a.fromCache ? 'cached' : `${a.durationMs.toFixed(1)} ms`}
      </p>
      {f.isEmpty && <div className="notice">This frame is empty or flat. Its phrase is silent.</div>}
      <dl className="metric-list">
        <Metric label="Average brightness" value={pct(f.brightness, 1)} fraction={f.brightness} />
        <div className="metric">
          <dt>Average RGB</dt>
          <dd>
            <span className="swatch" aria-hidden="true" style={{ background: `rgb(${f.meanRGB.r * 255}, ${f.meanRGB.g * 255}, ${f.meanRGB.b * 255})` }} />
            {Math.round(f.meanRGB.r * 255)}, {Math.round(f.meanRGB.g * 255)}, {Math.round(f.meanRGB.b * 255)}
          </dd>
        </div>
        <Metric label="Mean saturation" value={pct(f.meanSaturation, 1)} fraction={f.meanSaturation} />
        <Metric label="Variation" note="contrast + edges" value={pct(f.variation, 1)} fraction={f.variation} />
        <Metric label="Complexity" note="luminance entropy" value={pct(f.entropy, 1)} fraction={f.entropy} />
        <Metric label="Bright coverage" note="spatial pixel density" value={pct(f.shapes.coverage, 1)} fraction={f.shapes.coverage} />
        <Metric
          label={a.diff.comparedTo === null ? 'Frame difference' : `Difference vs frame ${a.diff.comparedTo + 1}`}
          value={a.diff.comparedTo === null ? 'n/a' : `${pct(a.diff.meanAbsDiff, 1)} · ${pct(a.diff.changedFraction)} cells`}
          fraction={a.diff.comparedTo === null ? 0 : Math.min(1, a.diff.meanAbsDiff / 0.12)}
        />
        <Metric label="Horizontal centroid" note="0 = left" value={pct(f.horizontalCentroid, 1)} fraction={f.horizontalCentroid} />
        <Metric label="Contrast (σ)" value={f.contrast.toFixed(3)} />
        <Metric label="Edge density" value={f.edgeDensity.toFixed(3)} />
      </dl>
      <div className="subhead">
        <span id="int-hist-label">Intensity distribution</span>
        <span className="mono">
          p10 {pct(f.intensityPercentiles.p10)} · p50 {pct(f.intensityPercentiles.p50)} · p90 {pct(f.intensityPercentiles.p90)}
        </span>
      </div>
      <div className="hist" role="img" aria-labelledby="int-hist-label">
        {(() => {
          const max = Math.max(...f.intensityHistogram, 1e-6);
          return f.intensityHistogram.map((v, i) => <i key={i} style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: `rgba(244,250,255,${0.25 + (i / 16) * 0.7})` }} />);
        })()}
      </div>
      <div className="hist-labels" aria-hidden="true">
        <span>dark</span>
        <span>bright</span>
      </div>
      <div className="export-row">
        <span className="eyebrow">Export whole sequence</span>
        <div>
          <button type="button" className="btn btn-sm" onClick={() => void exportAs('csv')} disabled={!!busy && busy.startsWith('Analyzing')}>
            CSV
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void exportAs('json')} disabled={!!busy && busy.startsWith('Analyzing')}>
            JSON
          </button>
        </div>
        {busy && (
          <span className="fineprint" role="status">
            {busy}
          </span>
        )}
      </div>
    </>
  );
}

function ColorTab({ snap }: { snap: PipelineSnapshot }) {
  const f = snap.analysis?.features;
  if (!f) return <Waiting snap={snap} />;
  const warmPos = (f.warmth + 1) / 2;
  return (
    <>
      <h3 className="eyebrow">Dominant palette</h3>
      <ul className="palette" role="list">
        {f.palette.map((p, i) => (
          <li key={i}>
            <span className="palette-chip" style={{ background: paletteToCss(p), flexGrow: Math.max(0.15, p.weight) }} aria-hidden="true" />
            <span className="palette-text">
              <b>{pct(p.weight)}</b> {p.hue === null ? 'grey' : hueName(p.hue)}
              <span className="mono"> {hex(p.r, p.g, p.b)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="fineprint">Deterministic k-means (k = 5) over the analysis grid. The largest saturated colour chooses the chord.</p>

      <h3 className="eyebrow" style={{ marginTop: 20 }}>
        Warm / cool balance
      </h3>
      <div className="balance" role="img" aria-label={`Warm–cool balance ${f.warmth === 0 ? 'neutral' : `${pct(Math.abs(f.warmth))} ${f.warmth > 0 ? 'warm' : 'cool'}`}`}>
        <span className="balance-track">
          <i style={{ left: `${warmPos * 100}%` }} />
        </span>
        <span className="balance-labels">
          <span>cool → minor</span>
          <span>{f.warmth === 0 ? 'neutral' : `${pct(Math.abs(f.warmth))} ${f.warmth > 0 ? 'warm' : 'cool'}`}</span>
          <span>warm → major</span>
        </span>
      </div>
      <p className="fineprint">“Warm” and “cool” are colour-theory hue groups; they are not temperature.</p>

      <div className="subhead" style={{ marginTop: 20 }}>
        <span id="hue-hist-label">Hue distribution (saturation-weighted)</span>
      </div>
      <div className="hist" role="img" aria-labelledby="hue-hist-label" aria-describedby="hue-hist-desc">
        {f.hueHistogram.map((w, i) => (
          <i key={i} title={`${hueBinName(i)}: ${pct(w, 1)}`} style={{ height: `${Math.max(2, w * 100)}%`, background: `hsl(${i * (360 / HUE_BINS) + 15} 70% 58%)` }} />
        ))}
      </div>
      <div className="hist-labels" aria-hidden="true">
        <span>red</span>
        <span>green</span>
        <span>blue</span>
        <span>rose</span>
      </div>
      <p id="hue-hist-desc" className="sr-only">
        {f.hueHistogram
          .map((w, i) => ({ w, i }))
          .filter((h) => h.w > 0.02)
          .sort((x, y) => y.w - x.w)
          .map((h) => `${hueBinName(h.i)} ${pct(h.w)}`)
          .join(', ') || 'No saturated colours.'}
      </p>
    </>
  );
}

function ShapeTab({ snap }: { snap: PipelineSnapshot }) {
  const a = snap.analysis;
  if (!a) return <Waiting snap={snap} />;
  const s = a.features.shapes;
  const geo = snap.collection?.georeferenced;
  const m = a.diff.motion;
  const moved = a.diff.comparedTo !== null;
  return (
    <>
      <dl className="metric-list">
        <Metric label="Distinct shapes" value={String(s.count)} />
        <Metric label="Bright coverage" value={pct(s.coverage, 1)} fraction={s.coverage} />
        <Metric label="Threshold (Otsu)" value={s.threshold === null ? 'flat frame' : pct(s.threshold, 1)} />
        <Metric label="Largest shape" value={pct(s.largest, 1)} fraction={s.largest} />
        <Metric label="Mean elongation" value={`${s.meanElongation.toFixed(2)}∶1`} />
      </dl>
      {s.regions.length > 0 && (
        <table className="mini-table">
          <caption className="sr-only">Largest detected shapes</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Area</th>
              <th scope="col">Centre</th>
              <th scope="col">Elong.</th>
              <th scope="col">Angle</th>
            </tr>
          </thead>
          <tbody>
            {s.regions.slice(0, 6).map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{pct(r.area, 1)}</td>
                <td>
                  {pct(r.cx)}, {pct(r.cy)}
                </td>
                <td>{r.elongation.toFixed(1)}</td>
                <td>{Math.round(r.orientation)}°</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="eyebrow" style={{ marginTop: 20 }}>
        Motion of the bright centre
      </h3>
      <div className="motion">
        <svg viewBox="-50 -50 100 100" width="84" height="84" role="img" aria-label={moved ? `Moved ${pct(Math.abs(m.dx))} ${m.dx >= 0 ? 'right' : 'left'} and ${pct(Math.abs(m.dy))} ${m.dy <= 0 ? 'up' : 'down'}` : 'No previous frame'}>
          <circle r="44" fill="none" stroke="var(--rule-strong)" />
          <line x1="-44" x2="44" y1="0" y2="0" stroke="var(--rule)" />
          <line y1="-44" y2="44" x1="0" x2="0" stroke="var(--rule)" />
          {moved && (
            <line x1="0" y1="0" x2={Math.max(-44, Math.min(44, m.dx * 400))} y2={Math.max(-44, Math.min(44, m.dy * 400))} stroke="var(--ice)" strokeWidth="3" strokeLinecap="round" />
          )}
          <circle r="3" fill="var(--ice)" />
        </svg>
        <p className="muted">
          {moved
            ? `Since frame ${(a.diff.comparedTo ?? 0) + 1}: ${pct(Math.abs(m.dx), 1)} ${m.dx >= 0 ? 'right' : 'left'}, ${pct(Math.abs(m.dy), 1)} ${m.dy <= 0 ? 'up' : 'down'}. Upward motion makes the melody rise.`
            : 'No previous frame to compare yet.'}
        </p>
      </div>

      <div className="subhead" style={{ marginTop: 20 }}>
        <span id="rows-label">{geo ? 'Latitude bands (north → south)' : 'Horizontal bands (top → bottom)'}</span>
      </div>
      <ol className="bands" aria-labelledby="rows-label">
        {a.features.rowEnergy.map((e, i) => {
          const n = a.features.rowEnergy.length;
          const latTop = 90 - (i / n) * 180, latBot = 90 - ((i + 1) / n) * 180;
          return (
            <li key={i}>
              <span className="mono">{geo ? `${Math.round(latTop)}°…${Math.round(latBot)}°` : `band ${i + 1}`}</span>
              <span className="band-bar" aria-hidden="true">
                <i style={{ width: `${e * 100}%` }} />
              </span>
              <span className="mono">{pct(e)}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

const MUSIC_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Harmony', keys: ['harmony', 'mode', 'chordSize'] },
  { title: 'Melody', keys: ['pitch', 'legend', 'register', 'density', 'contour', 'polyphony', 'articulation'] },
  { title: 'Rhythm & space', keys: ['tempo', 'rhythm', 'intensity', 'panning', 'timbre'] },
];

function MappingTab({ snap }: { snap: PipelineSnapshot }) {
  const { controller } = getRuntime();
  const ex = snap.params?.explanations ?? [];
  return (
    <>
      <div className="music-settings">
        <label className="field-inline">
          Key
          <select value={snap.config.rootMidi} onChange={(e) => controller.setKey(Number(e.target.value))}>
            {KEYS.map((k) => (
              <option key={k.midi} value={k.midi}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          Instrument
          <select value={snap.config.instrument} onChange={(e) => controller.setInstrument(e.target.value as Instrument)}>
            <option value="glass">Glass</option>
            <option value="soft">Soft</option>
            <option value="pluck">Pluck</option>
          </select>
        </label>
        <label className="field-inline">
          Space
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={snap.reverb}
            onChange={(e) => controller.setReverb(Number(e.target.value))}
            style={{ ['--fill' as string]: `${snap.reverb * 100}%`, width: 80 }}
            aria-label="Reverb amount"
            aria-valuetext={`${Math.round(snap.reverb * 100)} percent`}
          />
        </label>
      </div>
      {MUSIC_GROUPS.map((g) => (
        <table className="map-table" key={g.title}>
          <caption>{g.title}</caption>
          <thead>
            <tr>
              <th scope="col">On</th>
              <th scope="col">Visual feature</th>
              <th scope="col">Sound</th>
            </tr>
          </thead>
          <tbody>
            {ex
              .filter((e) => g.keys.includes(e.key))
              .map((e) => (
                <tr key={e.key} className={e.enabled ? '' : 'disabled'}>
                  <td>
                    <input
                      type="checkbox"
                      checked={snap.config.enabled[e.key]}
                      onChange={(ev) => controller.setMappingEnabled(e.key, ev.target.checked)}
                      aria-label={`Enable mapping: ${e.feature} to ${e.parameter}`}
                    />
                  </td>
                  <td>
                    {e.feature}
                    <span className="val">{e.featureValue}</span>
                  </td>
                  <td>
                    {e.parameter}
                    <span className="val">{e.enabled ? e.parameterValue : 'off (neutral)'}</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ))}
      <p className="fineprint">
        Switch a mapping off to hear what it contributes. These are design choices for listening to imagery, not scientific measurements.
      </p>
    </>
  );
}

function AccessTab({ snap }: { snap: PipelineSnapshot }) {
  const { controller } = getRuntime();
  const canSpeak = speechSupported();
  const canVibrate = hapticsSupported();
  return (
    <>
      <h3 className="eyebrow">Hear the description</h3>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => speak(snap.description)} disabled={!canSpeak || !snap.description}>
          Read this frame aloud
        </button>
        <button type="button" className="btn" onClick={stopSpeaking} disabled={!canSpeak}>
          Stop
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={snap.prefs.narrate} disabled={!canSpeak} onChange={(e) => controller.setPrefs({ narrate: e.target.checked })} />
        <span>Narrate each frame when stepping while paused</span>
      </label>
      {!canSpeak && <p className="fineprint">Speech synthesis is not available in this browser.</p>}

      <h3 className="eyebrow" style={{ marginTop: 20 }}>
        Feel the rhythm
      </h3>
      <label className="check">
        <input type="checkbox" checked={snap.prefs.haptics} disabled={!canVibrate} onChange={(e) => controller.setPrefs({ haptics: e.target.checked })} />
        <span>Vibrate on each frame (longer when the frame changed more)</span>
      </label>
      {!canVibrate && <p className="fineprint">Vibration is not supported on this device (for example on iOS or most desktops).</p>}

      <h3 className="eyebrow" style={{ marginTop: 20 }}>
        Explore by touch or keyboard
      </h3>
      <p className="muted">
        Choose <b>Explore</b> above the frame. Move a finger or the pointer across the image (or focus it and use the arrow keys) to hear each area as a
        tone (pitch = colour, loudness = brightness, left/right = position) and read its description.
        {snap.collection?.georeferenced ? ' For global maps the position is given in latitude and longitude and marked on the globe.' : ''}
      </p>

      <h3 className="eyebrow" style={{ marginTop: 20 }}>
        Keyboard
      </h3>
      <dl className="kbd-list">
        <div>
          <dt>
            <kbd>Space</kbd>
          </dt>
          <dd>Play / pause</dd>
        </div>
        <div>
          <dt>
            <kbd>←</kbd> <kbd>→</kbd>
          </dt>
          <dd>Previous / next frame</dd>
        </div>
        <div>
          <dt>
            <kbd>M</kbd>
          </dt>
          <dd>Mute</dd>
        </div>
        <div>
          <dt>
            <kbd>S</kbd>
          </dt>
          <dd>Start / stop sound</dd>
        </div>
        <div>
          <dt>
            <kbd>D</kbd>
          </dt>
          <dd>Read the frame description aloud</dd>
        </div>
      </dl>
    </>
  );
}
