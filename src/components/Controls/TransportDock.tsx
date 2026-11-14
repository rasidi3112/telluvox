import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getRuntime } from '../../app/runtime';
import { AudioEngine } from '../../audio/audioEngine';
import { SPEED_OPTIONS } from '../../eic/visualizationPlayer';
import { useAnimationFrame } from '../../hooks/usePipeline';
import type { PipelineSnapshot } from '../../sync/pipelineController';
import { pad2 } from '../format';
import { LoopIcon, MuteIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, SpeakerIcon, StopIcon, WaveIcon } from '../icons';

function FrameProgress({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { player } = getRuntime();
  const cb = useCallback(() => {
    if (ref.current) ref.current.style.width = `${player.getFrameProgress() * 100}%`;
  }, [player]);
  useAnimationFrame(cb, active);
  return (
    <div className="frame-progress" aria-hidden="true">
      <div ref={ref} style={active ? undefined : { width: 0 }} />
    </div>
  );
}

function RecordTimer({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return <span className="mono">{`${Math.floor(s / 60)}:${pad2(s % 60)}`}</span>;
}

export function TransportDock({ snap }: { snap: PipelineSnapshot }) {
  const { player, controller } = getRuntime();
  const { frameIndex, frameCount, isPlaying, speed, loop, frameDuration } = snap.player;
  const disabled = frameCount === 0;
  const fill = frameCount > 1 ? (frameIndex / (frameCount - 1)) * 100 : 0;
  const running = snap.audioWanted && snap.engineState === 'running';
  const supported = AudioEngine.isSupported();
  const rec = snap.recording;
  const dockRef = useRef<HTMLDivElement>(null);

  // Publish the dock height so the page reserves exactly that much space.
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--dock-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="dock" role="region" aria-label="Playback and sound" ref={dockRef}>
      <div className="dock-inner">
        <div className="dock-transport" role="group" aria-label="Frame playback">
          <button type="button" className="btn btn-icon" onClick={() => player.prev()} disabled={disabled} aria-label="Previous frame" title="Previous frame (←)">
            <PrevIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-play"
            onClick={() => player.toggle()}
            disabled={disabled}
            aria-label={isPlaying ? 'Pause visualization' : 'Play visualization'}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="btn btn-icon" onClick={() => player.next()} disabled={disabled} aria-label="Next frame" title="Next frame (→)">
            <NextIcon />
          </button>
        </div>

        <div className="dock-timeline">
          <div className="timeline-labels">
            <span>
              <b>{frameCount ? pad2(frameIndex + 1) : '--'}</b> / {frameCount ? pad2(frameCount) : '--'}
            </span>
            <span className="timeline-title">{snap.frame?.timeLabel ?? snap.frame?.label ?? ''}</span>
            <span>
              {frameDuration.toFixed(2)} s/frame
            </span>
          </div>
          <label htmlFor="timeline-range" className="sr-only">
            Timeline position
          </label>
          <input
            id="timeline-range"
            type="range"
            min={0}
            max={Math.max(0, frameCount - 1)}
            step={1}
            value={frameIndex}
            disabled={disabled}
            onChange={(e) => player.seek(Number(e.target.value))}
            aria-valuetext={`Frame ${frameIndex + 1} of ${frameCount}${snap.frame ? `, ${snap.frame.label}` : ''}`}
            style={{ ['--fill' as string]: `${fill}%` }}
          />
          <div className="timeline-ticks" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${Math.max(1, frameCount)}, 1fr)` }}>
            {Array.from({ length: frameCount }, (_, i) => (
              <span key={i} className={i === frameIndex ? 'current' : i < frameIndex ? 'done' : ''} />
            ))}
          </div>
          <FrameProgress active={isPlaying} />
        </div>

        <div className="dock-settings">
          <label className="field-inline">
            <span className="sr-only">Playback speed</span>
            <select value={speed} onChange={(e) => player.setSpeed(Number(e.target.value))} aria-label="Playback speed">
              {SPEED_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-icon" aria-pressed={loop} onClick={() => player.setLoop(!loop)} aria-label="Loop sequence" title="Loop sequence">
            <LoopIcon />
          </button>
          <label className="field-inline">
            <span className="sr-only">When paused</span>
            <select value={snap.pauseMode} onChange={(e) => controller.setPauseMode(e.target.value as 'hold' | 'silence')} aria-label="When paused" title="What happens to the sound when paused">
              <option value="hold">Pause: loop frame</option>
              <option value="silence">Pause: silence</option>
            </select>
          </label>
        </div>

        <div className="dock-sound" role="group" aria-label="Sound">
          {!supported ? (
            <span className="error-text">Web Audio unavailable</span>
          ) : running ? (
            <button type="button" className="btn" onClick={() => void controller.stopAudio()} title="Stop sound (S)">
              <StopIcon /> Stop sound
            </button>
          ) : (
            <button type="button" className="btn btn-sound" onClick={() => void controller.startAudio()} disabled={!snap.collection} title="Start sound (S)">
              <WaveIcon /> Start sound
            </button>
          )}
          <button
            type="button"
            className="btn btn-icon"
            aria-pressed={snap.muted}
            onClick={() => controller.setMuted(!snap.muted)}
            aria-label={snap.muted ? 'Unmute' : 'Mute'}
            title={snap.muted ? 'Unmute (M)' : 'Mute (M)'}
          >
            {snap.muted ? <MuteIcon /> : <SpeakerIcon />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={snap.volume}
            onChange={(e) => controller.setVolume(Number(e.target.value))}
            aria-label="Volume"
            aria-valuetext={`${Math.round(snap.volume * 100)} percent`}
            style={{ ['--fill' as string]: `${snap.volume * 100}%` }}
            className="volume"
          />
          {AudioEngine.isRecordingSupported() && (
            <button
              type="button"
              className={`btn btn-rec${rec.active ? ' is-recording' : ''}`}
              onClick={() => (rec.active ? void controller.stopRecording() : controller.startRecording())}
              disabled={!running && !rec.active}
              aria-pressed={rec.active}
              title="Record the soundscape to an audio file"
            >
              <span className="rec-dot" aria-hidden="true" />
              {rec.active && rec.startedAt ? <RecordTimer startedAt={rec.startedAt} /> : 'Record'}
            </button>
          )}
          {rec.last && !rec.active && (
            <a className="btn btn-sm" href={rec.last.url} download={rec.last.name} title={`${(rec.last.bytes / 1024).toFixed(0)} kB · ${rec.last.seconds.toFixed(0)} s`}>
              Save audio
            </a>
          )}
        </div>
      </div>
      <div className="dock-status" role="status" aria-live="off">
        <span>
          {snap.player.isPlaying ? 'Playing' : 'Paused'}
          {running && !snap.player.isPlaying ? (snap.pauseMode === 'hold' ? ' · looping this frame' : ' · silent') : ''}
        </span>
        <span>Audio {running ? (snap.muted ? 'muted' : 'live') : snap.engineState === 'unsupported' ? 'unsupported' : 'off'}</span>
        <span>Clock {snap.clock === 'audio' ? 'AudioContext' : 'system'}</span>
        <span>Phrase #{snap.generation}</span>
        <span>{snap.framesAnalyzed} frames analyzed</span>
        {rec.error && <span className="error-text">{rec.error}</span>}
        {!running && supported && <span className="dock-hint">Press “Start sound”: browsers only play audio after you interact.</span>}
      </div>
    </div>
  );
}
