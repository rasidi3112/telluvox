import { useRef, useState, type DragEvent } from 'react';
import { getRuntime } from '../../app/runtime';
import type { PipelineSnapshot } from '../../sync/pipelineController';

const VIDEO_FRAME_OPTIONS = [12, 24, 48, 96];

const GROUPS = [
  { kind: 'official', title: 'NASA challenge resources', tag: 'NASA SVS', tagClass: 'tag-nasa' },
  { kind: 'demonstration', title: 'Synthetic demos', tag: 'Synthetic', tagClass: 'tag-demo' },
  { kind: 'user-supplied', title: 'Your files', tag: 'Your file', tagClass: 'tag-user' },
] as const;

export function LibraryPanel({ snap }: { snap: PipelineSnapshot }) {
  const rt = getRuntime();
  const imgInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);
  const [georef, setGeoref] = useState(false);
  const [frameCount, setFrameCount] = useState(24);
  const [dragging, setDragging] = useState(false);
  const [wide] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 861px)').matches);
  const imp = snap.importState;

  const handleFiles = (files: File[]) => {
    const video = files.find((f) => f.type.startsWith('video/'));
    if (video) void rt.loadVideo(video, { count: frameCount, georeferenced: georef });
    else if (files.some((f) => f.type.startsWith('image/'))) void rt.loadLocalFiles(files, { georeferenced: georef });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <nav className="library" aria-label="Visualization library">
      <div className="library-head">
        <h2 className="eyebrow">Jukebox</h2>
        <p>Select a visualization to hear it.</p>
      </div>

      {GROUPS.map((g) => {
        const items = snap.library.filter((i) => i.kind === g.kind);
        if (items.length === 0) return null;
        return (
          <section key={g.kind} className="record-group" aria-label={g.title}>
            <h3 className="record-group-title">{g.title}</h3>
            <ul className="records" role="list">
              {items.map((item) => {
                const active = item.id === snap.selectedId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`record${active ? ' is-active' : ''}`}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => void rt.selectCollection(item.id)}
                    >
                      <span className="record-thumb" aria-hidden="true">
                        {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
                        {active && snap.player.isPlaying && <span className="record-playing" />}
                      </span>
                      <span className="record-body">
                        <span className="record-title">{item.title}</span>
                        <span className="record-meta">
                          {item.frameCount === 1 ? 'still image' : `${item.frameCount} frames`}
                          {item.georeferenced ? ' · global map' : ''}
                        </span>
                        <span className={`tag ${g.tagClass}`}>{g.tag}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {snap.library.length === 0 && <p className="records-empty">{snap.loadState === 'error' ? snap.loadError : 'Loading library…'}</p>}

      <details className="import" open={wide}>
        <summary className="eyebrow">Add a visualization</summary>
        <div
          className={`dropzone${dragging ? ' is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>Drop a video or image sequence here, or</p>
          <div className="import-buttons">
            <button type="button" className="btn" onClick={() => vidInput.current?.click()} disabled={imp.busy}>
              Video…
            </button>
            <button type="button" className="btn" onClick={() => imgInput.current?.click()} disabled={imp.busy}>
              Images…
            </button>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={georef} onChange={(e) => setGeoref(e.target.checked)} />
          <span>
            Frames are global maps <small>(equirectangular, 2:1, −180°…180°)</small>
          </span>
        </label>
        <label className="field-inline">
          Frames from video
          <select value={frameCount} onChange={(e) => setFrameCount(Number(e.target.value))}>
            {VIDEO_FRAME_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div role="status" aria-live="polite" className="import-status">
          {imp.busy && (
            <>
              <span>{imp.message}</span>
              {imp.progress !== null && (
                <span className="progress" aria-hidden="true">
                  <i style={{ width: `${imp.progress * 100}%` }} />
                </span>
              )}
            </>
          )}
          {!imp.busy && imp.message && <span>{imp.message}</span>}
          {imp.error && <span className="error-text">{imp.error}</span>}
        </div>
        <p className="fineprint">
          Files stay on your device. Any other visualization from the EIC content database (svs.gsfc.nasa.gov) can be downloaded and
          added here.
        </p>
        <input
          ref={imgInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            handleFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <input
          ref={vidInput}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            handleFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </details>
    </nav>
  );
}
