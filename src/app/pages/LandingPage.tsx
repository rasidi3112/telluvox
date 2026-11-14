import { lazy, Suspense } from 'react';
import { formatLatLon } from '../../scene/geo/coords';
import { subsolarPoint } from '../../scene/geo/solar';

const EarthScene = lazy(() => import('../../scene/EarthScene'));

/** Each row quotes the intent of the challenge brief and names the feature that answers it. */
const BRIEF: { brief: string; answer: string; where: string }[] = [
  {
    brief: 'Select or experience a specific EIC visualization alongside its corresponding soundscape.',
    answer: 'A jukebox library of visualizations. Pick one and its frames play with a live, synchronized soundscape.',
    where: 'Earth Jukebox · library',
  },
  {
    brief: 'Pair EIC visual frames with dynamic sonifications generated in real time.',
    answer: 'Every displayed frame is analyzed on the spot and synthesized with the Web Audio API on the same clock as the image.',
    where: 'Frame view · Sound',
  },
  {
    brief: 'Many EIC visualizations are animated sequences: extract individual frames.',
    answer: 'Drop a video and TELLUVOX samples evenly spaced frames in the browser, keeping their real timestamps.',
    where: 'Library · Add a visualization',
  },
  {
    brief: 'Use computer vision to map colour spectrums to musical chords.',
    answer: 'A deterministic k-means palette picks the chord; the warm–cool balance picks major or minor; complexity adds 7ths and 9ths.',
    where: 'Inspector · Color',
  },
  {
    brief: 'Translate pixel density into rhythm.',
    answer: 'Bright-area coverage sets the tempo, texture sets note density, and frame-to-frame change adds rhythmic ticks.',
    where: 'Inspector · Measure',
  },
  {
    brief: 'Artistic rulesets that drive synthesizer parameters based on visual shapes.',
    answer: 'Shapes are segmented and measured: their number sets polyphony, their elongation sets staccato or legato, and their motion bends the melody.',
    where: 'Inspector · Shape & motion',
  },
  {
    brief: 'Balance strict data translation with musicality, scales and harmonies.',
    answer: 'One key, consonant diatonic chords, a pentatonic melody, gentle reverb and a limiter: never chaotic noise, still fully data-driven.',
    where: 'Inspector · Mapping',
  },
  {
    brief: 'Accessibility: screen readers, tactile feedback, rich descriptive text.',
    answer: 'A plain-language description of every frame (read aloud on request), vibration on change, and explore-by-touch tones for any area of the image.',
    where: 'Inspector · Access · Explore',
  },
  {
    brief: 'A curated collection of generated audio files that tell the story of the data.',
    answer: 'Record any soundscape and save it as an audio file, ready for a playlist.',
    where: 'Dock · Record',
  },
  {
    brief: 'Official resources: EIC visuals from the Scientific Visualization Studio, used as data for audio.',
    answer: 'Nine of the listed visualizations are built into the jukebox with their SVS credits. Where SVS publishes a numeric colour bar, the colours are read back into estimated values (°C, metres) that drive the melody.',
    where: 'Library · Source & credits',
  },
  {
    brief: 'Document your process and explain the algorithms.',
    answer: 'Every mapping is documented, and the full per-frame analysis can be exported as CSV or JSON.',
    where: 'Understanding the Sound · Export',
  },
];

const STEPS = [
  ['Frame', 'An Earth visualization frame is displayed.'],
  ['Capture', 'The exact displayed image is drawn to an offscreen canvas.'],
  ['Analyze', 'Brightness, palette, shapes, density, texture and change are measured.'],
  ['Map', 'A musical ruleset turns each measurement into one musical decision.'],
  ['Synthesize', 'The Web Audio API plays chord, melody and rhythm, locked to the frame.'],
  ['Describe', 'The same measurements are written out as text, so nothing depends on sight or sound alone.'],
] as const;

export function LandingPage() {
  const sun = subsolarPoint(new Date());
  return (
    <>
      <section className="container hero" aria-labelledby="hero-title">
        <div>
          <p className="hero-eyebrow">NASA Space Apps Challenge 2026 · The Earth Information Jukebox</p>
          <h1 id="hero-title">TELLUVOX</h1>
          <p className="tagline">Hear What Earth Reveals.</p>
          <p className="lead">
            An Earth Jukebox that listens to visualizations of our planet. Each frame is measured (its colours, light, shapes,
            density and change) and turned into music in real time, so Earth science can be heard as well as seen.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#/jukebox">
              Explore Earth
            </a>
            <a className="btn btn-lg" href="#/understanding">
              How the sound works
            </a>
          </div>
          <p className="disclaimer">
            Independent project; not an official NASA product and not endorsed by NASA. The jukebox plays the challenge’s official
            resources from NASA’s Scientific Visualization Studio (credited on every page), clearly labeled synthetic demos, and any
            EIC video or frames you load yourself.
          </p>
        </div>
        <figure className="hero-globe">
          <Suspense fallback={<div className="scene-fallback">Loading globe…</div>}>
            <EarthScene padding={1.08} label="Rotating globe showing Natural Earth coastlines and the current day and night" />
          </Suspense>
          <figcaption>
            Earth right now: sunlight computed for {new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, Sun overhead at{' '}
            {formatLatLon(sun.lat, sun.lon)}. Coastlines: Natural Earth.
          </figcaption>
        </figure>
      </section>

      <section className="section" aria-labelledby="brief-title">
        <div className="container section-grid">
          <header>
            <p className="eyebrow">The brief, answered</p>
            <h2 id="brief-title">Built for the Earth Information Jukebox</h2>
            <p>
              The challenge asks for an interface that pairs EIC visual frames with dynamic sonifications generated in real time, with
              accessibility at its core. Here is how each part of the brief is met.
            </p>
            <a className="btn" href="https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/" target="_blank" rel="noreferrer">
              Read the challenge ↗
            </a>
          </header>
          <ol className="brief-list">
            {BRIEF.map((b) => (
              <li key={b.brief}>
                <p className="brief-quote">{b.brief}</p>
                <p className="brief-answer">{b.answer}</p>
                <p className="brief-where">{b.where}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="sonif-title">
        <div className="container section-grid">
          <header>
            <p className="eyebrow">Pipeline</p>
            <h2 id="sonif-title">From pixels to sound</h2>
            <p>Nothing is pre-recorded and nothing is random: the same frame always produces the same phrase.</p>
          </header>
          <ol className="pipeline">
            {STEPS.map(([t, d]) => (
              <li key={t}>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
