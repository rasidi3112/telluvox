import { useCallback, useRef } from 'react';
import { getRuntime } from '../../app/runtime';
import { midiName } from '../../audio/sonificationMapper';
import { useAnimationFrame } from '../../hooks/usePipeline';
import type { PipelineSnapshot } from '../../sync/pipelineController';

/**
 * Shows the engine's real output (an oscilloscope and spectrum read from the
 * AnalyserNode at the end of the signal chain) plus the chord and the step
 * pattern of the phrase currently scheduled. Nothing animates unless audio is
 * actually produced.
 */
export function SoundMonitor({ snap }: { snap: PipelineSnapshot }) {
  const { engine, controller } = getRuntime();
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef<HTMLSpanElement>(null);
  const bufRef = useRef<{ time: Float32Array<ArrayBuffer>; freq: Uint8Array<ArrayBuffer> } | null>(null);
  const running = snap.audioWanted && snap.engineState === 'running';
  const params = snap.params;

  const draw = useCallback(() => {
    const analyser = engine.getAnalyser();
    const scope = scopeRef.current, spec = specRef.current;
    if (!analyser || !scope || !spec) return;
    if (!bufRef.current || bufRef.current.time.length !== analyser.fftSize) {
      bufRef.current = { time: new Float32Array(analyser.fftSize), freq: new Uint8Array(analyser.frequencyBinCount) };
    }
    const { time, freq } = bufRef.current;
    analyser.getFloatTimeDomainData(time);
    analyser.getByteFrequencyData(freq);
    const dpr = window.devicePixelRatio || 1;
    for (const c of [scope, spec]) {
      const cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
    }
    let ctx = scope.getContext('2d');
    if (ctx) {
      const W = scope.width, H = scope.height;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(154,171,191,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      ctx.strokeStyle = '#39DDF5';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) {
        const v = time[i] ?? 0;
        sumSq += v * v;
        const x = (i / (time.length - 1)) * W, y = H / 2 - v * (H / 2) * 2.5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const rms = Math.sqrt(sumSq / time.length);
      if (levelRef.current) levelRef.current.textContent = `${rms > 0 ? (20 * Math.log10(rms)).toFixed(1) : '−∞'} dBFS`;
    }
    ctx = spec.getContext('2d');
    if (ctx) {
      const W = spec.width, H = spec.height;
      ctx.clearRect(0, 0, W, H);
      const nyq = (engine.getSampleRate() ?? 48000) / 2;
      const bars = 72, fMin = 40, fMax = 8000;
      for (let b = 0; b < bars; b++) {
        const f0 = fMin * Math.pow(fMax / fMin, b / bars), f1 = fMin * Math.pow(fMax / fMin, (b + 1) / bars);
        const i0 = Math.floor((f0 / nyq) * freq.length), i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * freq.length));
        let m = 0;
        for (let i = i0; i < i1 && i < freq.length; i++) m = Math.max(m, freq[i] ?? 0);
        const bh = (m / 255) * H;
        ctx.fillStyle = `rgba(130,123,255,${0.3 + (m / 255) * 0.7})`;
        ctx.fillRect((b / bars) * W + 1, H - bh, W / bars - 2, bh);
      }
    }
    const ph = controller.getPlayhead();
    const grid = stepsRef.current;
    if (grid) {
      const cur = ph?.step ?? -1;
      for (let i = 0; i < grid.children.length; i++) grid.children[i]?.classList.toggle('is-current', i === cur);
    }
  }, [engine, controller]);
  useAnimationFrame(draw, running);

  const steps = params?.stepsPerFrame ?? 16;
  const melody = params?.notes.filter((n) => n.voice === 0) ?? [];
  const noteByStep = new Map(melody.map((n) => [n.step, n]));
  const tickSteps = new Set(params?.ticks.map((t) => t.step) ?? []);
  const midis = melody.map((n) => n.midi);
  const lo = Math.min(...midis, 60), hi = Math.max(...midis, 61);

  return (
    <section className="panel sound-panel" aria-labelledby="sound-title">
      <header className="panel-header">
        <h2 className="panel-title" id="sound-title">
          Sound
        </h2>
        <span className={`badge ${running ? 'badge-live' : ''}`}>
          <span className="badge-dot" aria-hidden="true" /> {running ? (snap.muted ? 'Live · muted' : 'Live') : 'Engine off'}
        </span>
      </header>

      <div className="chord-readout" aria-live="off">
        <div>
          <span className="chord-name">{params?.chord.name ?? '-'}</span>
          <span className="chord-roman">{params ? `${params.chord.roman} in ${params.key}` : ''}</span>
        </div>
        <dl className="chord-facts">
          <div>
            <dt>Tempo</dt>
            <dd>{params ? `${steps} steps` : '-'}</dd>
          </div>
          <div>
            <dt>Voices</dt>
            <dd>{params?.voices ?? '-'}</dd>
          </div>
          <div>
            <dt>Contour</dt>
            <dd>{params?.contour ?? '-'}</dd>
          </div>
        </dl>
      </div>

      <div className="scope-label">
        <span>Output waveform</span>
        <span ref={levelRef}>{running ? '' : 'idle'}</span>
      </div>
      <canvas ref={scopeRef} className="scope" aria-label="Live oscilloscope of the generated audio" role="img" />
      <div className="scope-label">
        <span>Spectrum 40 Hz – 8 kHz</span>
      </div>
      <canvas ref={specRef} className="scope scope-sm" aria-label="Live spectrum of the generated audio" role="img" />

      <div className="scope-label">
        <span>Phrase · {steps} steps</span>
        <span>
          {params ? `${melody.length} notes · ${params.ticks.length} ticks` : ''}
        </span>
      </div>
      <div
        ref={stepsRef}
        className="step-grid"
        style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}
        role="img"
        aria-label={
          params
            ? `Phrase pattern over ${steps} steps: melody on steps ${melody.map((n) => n.step + 1).join(', ') || 'none'}; ticks on steps ${params.ticks.map((t) => t.step + 1).join(', ') || 'none'}.`
            : 'No phrase scheduled.'
        }
      >
        {Array.from({ length: steps }, (_, i) => {
          const n = noteByStep.get(i);
          const hgt = n ? 6 + ((n.midi - lo) / Math.max(1, hi - lo)) * 16 : 0;
          return (
            <div
              key={i}
              className={`step${n ? ' has-note' : ''}${tickSteps.has(i) ? ' has-tick' : ''}`}
              style={n ? { ['--h' as string]: `${hgt}px` } : undefined}
              title={n ? `Step ${i + 1}: ${midiName(n.midi)}` : `Step ${i + 1}`}
            >
              {n ? midiName(n.midi).replace(/-?\d+$/, '') : ''}
            </div>
          );
        })}
      </div>
      <div className="legend-row" aria-hidden="true">
        <span className="legend-note">melody note (height = pitch)</span>
        <span className="legend-tick">rhythmic tick</span>
      </div>
    </section>
  );
}
