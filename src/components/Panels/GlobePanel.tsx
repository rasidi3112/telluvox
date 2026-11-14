import { lazy, Suspense, useMemo, useState } from 'react';
import { equirectUvToLatLon, formatLatLon } from '../../scene/geo/coords';
import { subsolarPoint } from '../../scene/geo/solar';
import type { PipelineSnapshot } from '../../sync/pipelineController';

const EarthScene = lazy(() => import('../../scene/EarthScene'));

export function GlobePanel({ snap }: { snap: PipelineSnapshot }) {
  const [dayNight, setDayNight] = useState(true);
  const [drape, setDrape] = useState(true);
  const [opacity, setOpacity] = useState(0.85);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const geo = snap.collection?.georeferenced === true;
  const grid = snap.analysis?.features.grid;

  const marker = useMemo(() => {
    if (!geo || !snap.probe || !grid) return null;
    return equirectUvToLatLon((snap.probe.col + 0.5) / grid.cols, (snap.probe.row + 0.5) / grid.rows);
  }, [geo, snap.probe, grid]);

  const sun = subsolarPoint(new Date());
  const utc = new Date().toISOString().slice(0, 16).replace('T', ' ');

  return (
    <section className="panel globe-panel" aria-labelledby="globe-title">
      <header className="panel-header">
        <h2 className="panel-title" id="globe-title">
          Earth
        </h2>
        <span className="panel-meta">drag to rotate</span>
      </header>
      <div className="globe-view">
        <Suspense fallback={<div className="scene-fallback">Loading globe…</div>}>
          <EarthScene
            overlay={geo && drape ? snap.image : null}
            overlayOpacity={opacity}
            dayNight={dayNight}
            marker={marker}
            focusLon={marker ? marker.lon : null}
            zoom={zoom}
            resetKey={resetKey}
            label={
              geo && drape
                ? `Globe with Natural Earth coastlines and the current frame draped as a global map${marker ? `; marker at ${formatLatLon(marker.lat, marker.lon)}` : ''}.`
                : 'Globe with Natural Earth coastlines and the current day and night.'
            }
          />
        </Suspense>
        {marker && <span className="globe-chip">{formatLatLon(marker.lat, marker.lon)}</span>}
        <div className="globe-zoom" role="group" aria-label="Globe zoom">
          <button type="button" className="btn btn-icon btn-sm" onClick={() => setZoom((z) => Math.min(3, z * 1.25))} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="btn btn-icon btn-sm" onClick={() => setZoom((z) => Math.max(0.8, z / 1.25))} aria-label="Zoom out">
            −
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setZoom(1);
              setResetKey((k) => k + 1);
            }}
            aria-label="Reset globe view"
          >
            Reset
          </button>
        </div>
      </div>
      <div className="globe-controls">
        <label className="check">
          <input type="checkbox" checked={dayNight} onChange={(e) => setDayNight(e.target.checked)} />
          <span>Day &amp; night now</span>
        </label>
        <label className={`check${geo ? '' : ' is-disabled'}`}>
          <input type="checkbox" checked={geo && drape} disabled={!geo} onChange={(e) => setDrape(e.target.checked)} />
          <span>Drape frame</span>
        </label>
        {geo && drape && (
          <label className="field-inline">
            Opacity
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              style={{ ['--fill' as string]: `${((opacity - 0.2) / 0.8) * 100}%`, width: 90 }}
              aria-valuetext={`${Math.round(opacity * 100)} percent`}
            />
          </label>
        )}
      </div>
      <p className="fineprint">
        Coastlines: Natural Earth 1:50m (public domain). {dayNight ? `Sunlight computed for ${utc} UTC (Sun overhead at ${formatLatLon(sun.lat, sun.lon)}). ` : ''}
        {geo
          ? snap.collection?.isDemonstration
            ? 'The draped frame is a synthetic test field on a latitude–longitude grid; it does not describe Earth.'
            : snap.collection?.kind === 'official'
              ? `The draped frame is the official SVS ${snap.collection.svs?.id ?? ''} flat global map; its alignment with the coastlines was verified before draping.`
              : 'The draped frame was declared by you as a global equirectangular map.'
          : 'This sequence has no map projection, so it is not draped on the globe.'}
      </p>
    </section>
  );
}
