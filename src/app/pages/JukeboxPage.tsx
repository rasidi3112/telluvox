import { useEffect } from 'react';
import { getRuntime } from '../runtime';
import { usePipeline } from '../../hooks/usePipeline';
import { speak, useAccessibilityFeedback } from '../../hooks/useAccessibilityFeedback';
import { TransportDock } from '../../components/Controls/TransportDock';
import { GlobePanel } from '../../components/Panels/GlobePanel';
import { Inspector } from '../../components/Panels/Inspector';
import { LibraryPanel } from '../../components/Panels/LibraryPanel';
import { SoundMonitor } from '../../components/Panels/SoundMonitor';
import { SourcePanel } from '../../components/Panels/SourcePanel';
import { VisualizationPanel } from '../../components/Panels/VisualizationPanel';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.closest('[data-own-keys]')) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || t.isContentEditable;
}

export default function JukeboxPage() {
  const snap = usePipeline();
  const rt = getRuntime();
  useAccessibilityFeedback(snap);

  useEffect(() => {
    rt.controller.startLoop();
    if (rt.controller.getSnapshot().loadState === 'idle') void rt.loadDemo();
    return () => {
      rt.controller.stopLoop();
      rt.player.pause();
      // Leaving the jukebox silences the engine; sound never plays in the background.
      if (rt.controller.getSnapshot().audioWanted) void rt.controller.stopAudio();
    };
  }, [rt]);

  // Keyboard shortcuts: Space play/pause · ←/→ frames · M mute · S sound · D describe
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      const c = rt.controller;
      if (e.key === ' ') {
        e.preventDefault();
        rt.player.toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        rt.player.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        rt.player.prev();
      } else if (e.key === 'm' || e.key === 'M') {
        c.setMuted(!c.getSnapshot().muted);
      } else if (e.key === 's' || e.key === 'S') {
        const s = c.getSnapshot();
        if (s.audioWanted && s.engineState === 'running') void c.stopAudio();
        else void c.startAudio();
      } else if (e.key === 'd' || e.key === 'D') {
        speak(c.getSnapshot().description);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rt]);

  const c = snap.collection;
  const live = snap.player.isPlaying ? 'off' : 'polite';

  return (
    <div className="jb">
      <aside className="jb-library">
        <LibraryPanel snap={snap} />
      </aside>

      <section className="jb-stage" aria-labelledby="stage-title">
        <header className="stage-head">
          <div>
            <p className="eyebrow">Now playing</p>
            <h1 id="stage-title">{c?.title ?? 'Earth Jukebox'}</h1>
            {c && <p className="stage-desc">{c.description}</p>}
          </div>
          <div className="stage-badges">
            {c?.isDemonstration && (
              <span className="badge badge-demo">
                <span className="badge-dot" aria-hidden="true" /> Synthetic demonstration data · not NASA data
              </span>
            )}
            {c?.kind === 'official' && c.svs && (
              <a className="badge badge-nasa" href={c.svs.pageUrl} target="_blank" rel="noreferrer">
                Official challenge resource · NASA SVS {c.svs.id} ↗
              </a>
            )}
            {c?.kind === 'user-supplied' && <span className="badge">Your file · content unknown to TELLUVOX</span>}
            {c?.georeferenced && <span className="badge">Global map · equirectangular</span>}
          </div>
        </header>

        {snap.loadState === 'error' && (
          <div className="notice notice-error" role="alert">
            Could not load visualization: {snap.loadError}{' '}
            <button type="button" className="btn btn-sm" onClick={() => void rt.loadDemo()}>
              Retry
            </button>
          </div>
        )}

        <VisualizationPanel snap={snap} />

        <div className="narrative">
          <p className="eyebrow">What you are hearing</p>
          <p className="narrative-text" aria-live={live}>
            {snap.description || 'Select a visualization, press Start sound, then Play.'}
          </p>
          {c?.highlights && c.highlights.length > 0 && (
            <ul className="highlights">
              {c.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="stage-grid">
          <GlobePanel snap={snap} />
          <SoundMonitor snap={snap} />
        </div>

        <SourcePanel snap={snap} />
      </section>

      <aside className="jb-inspector" aria-label="Analysis inspector">
        <Inspector snap={snap} />
      </aside>

      <TransportDock snap={snap} />
    </div>
  );
}
