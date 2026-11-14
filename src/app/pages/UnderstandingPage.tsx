const ANALYSES: [string, string][] = [
  ['Brightness & average RGB', 'Mean relative luminance (Rec. 709) and mean red, green and blue.'],
  ['Colour palette', 'Five dominant colours by deterministic k-means in RGB (initial centres at luminance quantiles, so results never vary).'],
  ['Hue distribution', 'A 12-bin hue histogram weighted by saturation, plus mean saturation.'],
  ['Warm–cool balance', 'Share of warm hues (magenta → yellow) versus cool hues (green-cyan → violet). Colour-theory groups only, not temperature.'],
  ['Intensity distribution', '16-bin luminance histogram with 10th, 50th and 90th percentiles.'],
  ['Visual complexity', 'Shannon entropy of the luminance histogram (0 = one flat tone, 1 = every tone equally common).'],
  ['Variation', 'Luminance contrast (σ) and edge density (mean neighbour gradient).'],
  ['Spatial pixel density', 'Otsu’s threshold separates bright foreground from background; coverage is the foreground share.'],
  ['Shapes', 'Connected foreground regions (8-connectivity): count, area, centroid, elongation and orientation from second-order image moments.'],
  ['Spatial balance', 'Luminance-weighted centroid plus eight vertical and eight horizontal bands (latitude bands for global maps).'],
  ['Change & motion', 'A 32×16 luminance signature compared with the previously displayed frame: mean change, changed area, and shift of the bright centre.'],
];

const MAPPINGS: [string, string, string, string][] = [
  ['Harmony', 'Dominant palette colour', 'Chord', 'The colour wheel is divided into six sectors mapped to fifth-related chords in the key: red I, yellow V, green ii, cyan vi, blue iii, magenta IV (minor-mode equivalents in minor).'],
  ['Harmony', 'Warm–cool balance', 'Mode', 'More warm hues → major; more cool hues → minor.'],
  ['Harmony', 'Visual complexity', 'Chord size', 'Low entropy → triad, medium → seventh, high → ninth.'],
  ['Melody', 'Hue distribution', 'Pitches', 'Up to five hues above 4% share become notes on the mode’s pentatonic ladder (red lowest → rose highest). Larger colours play more often.'],
  ['Melody', 'Intensity distribution', 'Register', 'The median moves the melody an octave up or down; a wide tonal spread adds octave leaps.'],
  ['Melody', 'Pixel variation', 'Note density', 'Smooth frames play 2 of 16 steps; highly textured frames up to 12, spread evenly (Euclidean rhythm).'],
  ['Melody', 'Distinct shapes', 'Polyphony', 'One shape → one voice; two or three → a fifth above joins; four or more → an octave below too.'],
  ['Melody', 'Shape elongation', 'Articulation', 'Compact blobs → short staccato notes; long bands → sustained legato.'],
  ['Melody', 'Vertical motion', 'Contour', 'If the bright centre moved up, the phrase rises; if it moved down, it falls.'],
  ['Rhythm', 'Spatial pixel density', 'Tempo', 'Coverage under 12% → 8 steps per frame, under 30% → 12, otherwise 16.'],
  ['Rhythm', 'Frame difference', 'Ticks', 'Up to half the steps get a short filtered-noise tick; full activity at a 12% mean luminance change.'],
  ['Space', 'Average brightness', 'Intensity', 'Gain follows the square root of brightness, within safe limits.'],
  ['Space', 'Horizontal distribution', 'Panning', 'The luminance centroid places notes, drone and pad in the stereo field.'],
  ['Space', 'Mean saturation', 'Timbre', 'Vivid frames open the low-pass filters (brighter tone); muted frames sound softer.'],
];

export default function UnderstandingPage() {
  return (
    <div className="container">
      <article className="doc section" style={{ borderTop: 0 }}>
        <p className="eyebrow">Process</p>
        <h1 style={{ fontSize: 36 }}>Understanding the Sound</h1>
        <p className="intro">
          TELLUVOX generates every sound from measurements of the frame that is on screen. Nothing is pre-recorded and nothing in the
          sound is random: the same frame always produces the same phrase.
        </p>

        <h2>1. How frames are analyzed</h2>
        <p>
          The exact image being displayed is drawn to an offscreen canvas at no more than 160 pixels on its longest side. The browser
          averages neighbouring pixels while scaling, which keeps the analysis to a few milliseconds without losing the overall
          structure. Each source frame is analyzed once and cached. Transparent pixels are ignored. Frames that cannot be read
          (missing files, invalid dimensions or cross-origin images) are reported instead of being sonified.
        </p>
        <p>
          Videos are handled the same way: TELLUVOX seeks to evenly spaced timestamps, captures each frame losslessly, and keeps the
          video’s own time for every frame.
        </p>

        <h2>2. What is measured</h2>
        <table className="map-table">
          <thead>
            <tr>
              <th scope="col">Analysis</th>
              <th scope="col">Method</th>
            </tr>
          </thead>
          <tbody>
            {ANALYSES.map(([a, m]) => (
              <tr key={a}>
                <td style={{ width: '30%' }}>{a}</td>
                <td style={{ color: 'var(--text-muted)' }}>{m}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>3. How measurements become music</h2>
        <p>
          A direct pixel-to-sound translation quickly becomes noise, so TELLUVOX applies a musical ruleset: one key, consonant
          diatonic chords and a pentatonic melody. Each of the fourteen musical decisions below is driven by one measurement, and
          each can be switched off in the jukebox to hear what it contributes.
        </p>
        <table className="map-table">
          <thead>
            <tr>
              <th scope="col">Layer</th>
              <th scope="col">Visual feature</th>
              <th scope="col">Sound</th>
              <th scope="col">Rule</th>
            </tr>
          </thead>
          <tbody>
            {MAPPINGS.map(([layer, f, a, d]) => (
              <tr key={`${f}-${a}`}>
                <td className="mono" style={{ color: 'var(--cyan)' }}>
                  {layer}
                </td>
                <td>{f}</td>
                <td>{a}</td>
                <td style={{ color: 'var(--text-muted)' }}>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 16 }}>
          The sound has four synthesized layers: a soft bass drone on the chord root, a five-voice chord pad, a melody played on a
          choice of instruments (glass, soft or pluck), and short noise ticks for change. They share a deterministic reverb and a
          limiter that prevents harsh or loud output.
        </p>

        <h2>4. Why the audio changes with the image</h2>
        <p>
          Each frame owns exactly one phrase. It is scheduled on the audio clock to start when the frame appears and to last exactly
          as long as the frame is shown. When the next frame appears, notes from the previous phrase that have not started yet are
          cancelled, and the new chord, melody and rhythm begin. A brightening scene grows louder, a drifting feature moves across
          the stereo field, new shapes add voices, and a sudden change is heard as a burst of rhythm.
        </p>

        <h2>5. Reading the official colour bars</h2>
        <p>
          Several official visualizations come with a published colour bar: sea surface temperature from 0 to 32 °C, ocean temperature
          from 0 to 25 °C, and forest canopy height from 0 to 50 m. TELLUVOX samples the colour gradient in that bar and pairs each
          colour with its value. For every analyzed pixel it finds the nearest colour on the bar. Pixels that match nothing on the bar
          (land, labels, background) are ignored. The median of the matched values then raises or lowers the melody: warmer water or
          taller forests sound higher.
        </p>
        <p>
          These values are <b>estimates</b>. Shading, blending of flow lines, video compression and resizing all shift colours, so
          TELLUVOX always shows how many pixels matched and never presents the numbers as measurements. For flow-line visualizations it
          compares hue rather than brightness, so dimmed lines still match. Colour bars that name categories (aerosol types, layered
          surface tables) are shown for reference only and are not converted into numbers.
        </p>

        <h2>6. The globe</h2>
        <p>
          The globe is drawn from Natural Earth 1:50m coastlines (public domain), projected so the map lines up exactly with the
          sphere. This is verified by automated tests against the 3D engine’s own geometry. Day and night use the real position of
          the Sun for the current time (NOAA solar position approximation). A frame is draped on the globe only when it is a global
          equirectangular map (2:1, longitude −180°…180°). Any other image stays in the flat frame view, so no geography is ever
          invented.
        </p>

        <h2>7. Accessibility</h2>
        <ul>
          <li>Nothing depends on sound alone: every value is shown as text, and every frame has a plain-language description.</li>
          <li>Nothing depends on sight alone: the description can be read aloud, and every area of an image can be explored by touch or keyboard, each area playing its own tone.</li>
          <li>Tactile feedback: on supported devices, a vibration on each frame grows with the amount of change.</li>
          <li>Keyboard: Space, ←/→, M, S and D shortcuts. Tabs and controls follow standard patterns with visible focus.</li>
          <li>Sound only starts when you ask. Mute and volume are always available, and motion is reduced when your system requests it.</li>
        </ul>

        <h2>8. What this is, and is not</h2>
        <p>
          These mappings are experimental design choices for exploring imagery through sound, not scientific measurements. The
          demonstration sequences are synthetic test patterns. Pixel colour is interpreted as a physical quantity only for official
          resources whose colour bar SVS publishes, and then only as a clearly labeled estimate.
        </p>

        <h2>9. Credits</h2>
        <ul>
          <li>Coastlines: Natural Earth (public domain), via the world-atlas package.</li>
          <li>Solar position: NOAA general solar position equations.</li>
          <li>Built with React, Three.js, React Three Fiber, Drei, d3-geo and the Web Audio API.</li>
          <li>
            Visualizations: NASA’s Scientific Visualization Studio (SVS 3912, 5313, 5669, 5533, 5425, 5196, 5011, 4960, 4950). Each item’s
            individual credits are listed with it in the jukebox.
          </li>
          <li>The Caldwell 73 data sonification (SVS 13786), listed among the challenge resources, inspired the brightness-to-loudness and position-to-pitch ideas.</li>
        </ul>
        <p>
          <a className="btn btn-primary" href="#/jukebox">
            Open the Earth Jukebox
          </a>
        </p>
      </article>
    </div>
  );
}
