# TELLUVOX

**Hear What Earth Reveals.**

TELLUVOX is an Earth Jukebox: a web application that analyzes Earth visualization frames and turns what they show into synchronized, real-time music. It measures colour, light, shapes, density and change in each frame, and a musical ruleset turns those measurements into chord, melody, rhythm and space, synthesized with the Web Audio API. When the picture changes, the sound changes with it.

> **Independent project.** TELLUVOX was created for the **NASA Space Apps Challenge 2026: The Earth Information Jukebox** ([challenge page](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/)). It is **not an official NASA product and is not endorsed by NASA.**
>
> **Data.** The jukebox contains **nine official challenge resources** from NASA's Scientific Visualization Studio (SVS), each credited, plus **four synthetic test sequences** that are clearly labeled as such. You can also load any EIC video or image sequence yourself; it is processed locally in the browser.

---

## How the challenge brief is answered

| Challenge brief | TELLUVOX feature |
| --- | --- |
| Select or experience a specific EIC visualization alongside its soundscape | **Jukebox library.** Pick a sequence and its frames play with a live, synchronized soundscape. |
| Pair EIC visual frames with dynamic sonifications generated in real time | Each displayed frame is analyzed and synthesized on the same audio clock. |
| Extract individual frames from animated sequences | **Video import.** Evenly spaced frames are extracted in the browser and keep their real timestamps. |
| Map colour spectrums to musical chords | Palette (k-means) → chord. Warm/cool balance → major/minor. Entropy → 7ths and 9ths. |
| Translate pixel density into rhythm | Bright coverage → tempo. Texture → note density. Change → rhythmic ticks. |
| Rulesets driving synthesizer parameters from visual shapes | Shape segmentation. Number of shapes → polyphony. Elongation → articulation. Motion → melodic contour. |
| Balance strict translation with musicality | One key, consonant diatonic chords, a pentatonic melody, reverb and a limiter. |
| Accessibility: screen readers, tactile feedback, rich descriptive text | A plain-language description of every frame (read aloud on request), vibration on change, explore-by-touch or keyboard tones, ARIA-labelled controls and keyboard shortcuts. |
| Curated collection of generated audio files | **Record** any soundscape and save it as an audio file. |
| Document the process and algorithms | The *Understanding the Sound* page, plus CSV/JSON export of the full per-frame analysis. |

## Official challenge resources

These are the resources listed on the challenge's Resources tab, extracted with `npm run fetch:eic`:

| SVS | Visualization | In TELLUVOX | Globe | Colour bar read |
| --- | --- | --- | --- | --- |
| [3912](https://svs.gsfc.nasa.gov/3912/) | Global Sea Surface Currents and Temperature | 30 frames, 2048×1024 | ✓ verified (IoU 0.94 at 0°) | ✓ 0–32 °C (hue matching) |
| [5313](https://svs.gsfc.nasa.gov/5313/) | Change in Night Lights 2012–2023 (EIC) | 24 frames, yearly series + change map | no (32:9 panorama) | none |
| [5669](https://svs.gsfc.nasa.gov/5669/) | GEOS Aerosols (2025) | still image | no | shown (categories) |
| [5533](https://svs.gsfc.nasa.gov/5533/) | Air Quality Model Runs (EIC hyperwall) | 30 frames | no | none |
| [5425](https://svs.gsfc.nasa.gov/5425/) | Perpetual Ocean 2 (temperature) | 36 frames | no (moving camera) | shown, **not read** (cold end = ocean background colour) |
| [5196](https://svs.gsfc.nasa.gov/5196/) | DYAMOND Global CO₂ | 30 frames | no (orbiting globe) | shown, not read (bar also encodes opacity) |
| [5011](https://svs.gsfc.nasa.gov/5011/) | Lightning detected from the ISS 2017–2023 | 36 frames, 2048×1024 | ✓ verified (best at 0°, IoU 0.51–0.57 vs ≤0.37 elsewhere) | none |
| [4960](https://svs.gsfc.nasa.gov/4960/) | A 3D View of an Atmospheric River | 36 frames | no | shown (layers) |
| [4950](https://svs.gsfc.nasa.gov/4950/) | GEDI Forest Height | 30 frames | no (rotating globe) | ✓ 0–50 m (RGB matching; globe shading biases low) |

[Caldwell 73](https://svs.gsfc.nasa.gov/13786/) (SVS 13786) is a deep-space data sonification. It is listed as a conceptual reference and inspired the brightness → loudness and position → pitch ideas; it is not in the Earth jukebox.

**Why frames are bundled.** `svs.gsfc.nasa.gov` sends no CORS permission for this app's origin, so a browser cannot read the pixels of SVS-hosted media. `scripts/fetch-eic-resources.mjs` therefore uses ffmpeg to pull evenly spaced frames from each listed video. For large files it reads only the byte ranges it needs. The frames are downscaled and written with a manifest of SVS metadata and credits to `public/assets/eic/`. The choice of source file, time range and frame count for each resource is in `scripts/eic-catalog.json`.

**Globe draping.** A resource is draped only after its alignment with Natural Earth coastlines has been checked: land detected in the frame is compared with the coastline mask at every longitude offset, and the best match must be at 0°.

**Reading colour bars.** For resources whose SVS colour bar is numeric, TELLUVOX samples the published bar and estimates a value for each matching pixel; the median raises or lowers the melody. This is always labeled as an estimate, with the share of matching pixels. Each reading was checked for plausibility before being enabled:

- **Sea surface temperature, frame 15:** equatorial band ≈ 27.8 °C, Southern Ocean 45–63°S ≈ 4.3 °C, global median ≈ 19–21 °C. Plain RGB matching only matched 0.1% of pixels, so hue matching is used.
- **GEDI:** the median is about 7–17 m.
- **Perpetual Ocean:** the reading came out at an implausible 1–3 °C, because the bar's cold end matches the ocean imagery behind the flow lines. Its bar is therefore shown but deliberately not read.

## Technology stack

| Concern | Technology |
| --- | --- |
| UI | React 19, TypeScript (strict), CSS, IBM Plex fonts (bundled locally) |
| Build | Vite 8 |
| 3D globe | Three.js via React Three Fiber 9 and Drei 10, with custom GLSL shaders |
| Geography | Natural Earth 1:50m land (public domain, via `world-atlas`), `topojson-client`, `d3-geo` |
| Analysis | Canvas 2D API (`OffscreenCanvas` when available) and pure TypeScript feature extraction |
| Audio | Web Audio API, used directly (no audio libraries); `MediaRecorder` for recording |
| Accessibility extras | Web Speech API (narration), Vibration API (haptics) |
| Tests | Vitest |

There is no backend and no API key. All processing happens in the browser.

## Installation and running locally

Requires Node.js 20 or newer (developed with Node 24).

```bash
cd telluvox
npm install
npm run dev            # http://localhost:5173
```

Other scripts:

```bash
npm test               # unit tests (Vitest)
npm run typecheck      # TypeScript project check
npm run build          # typecheck + production build → dist/
npm run preview        # serve the production build
npm run generate:demo  # regenerate the synthetic demonstration sequences
npm run fetch:eic      # re-extract the official SVS resources (needs ffmpeg + network)
```

To use it: open **Earth Jukebox**, choose a sequence in the library, then press **Start sound** and **Play**. Browsers only allow audio after a user gesture.

Keyboard shortcuts:

- `Space`: play / pause
- `←` / `→`: previous / next frame
- `M`: mute
- `S`: start / stop sound
- `D`: read the frame description aloud

## Adding more EIC visualizations

1. Download any visualization from the [EIC content database](https://svs.gsfc.nasa.gov/gallery/earth-information-center/), either a video or its individual frames. Or add it to `scripts/eic-catalog.json` and run `npm run fetch:eic`.
2. In the jukebox library, open **Add a visualization** and drop the file, or choose **Video…** or **Images…**. For a video, choose how many frames to extract.
3. If, and only if, the frames are **global equirectangular maps** (2:1, longitude −180°…180°), tick *Frames are global maps*. The frame is then draped onto the globe, and the explorer reports latitude and longitude. Images that are not 2:1 are refused for this option, so geography is never misplaced.
4. Credit the original source when you share recordings or exports.

## Project architecture

```
telluvox/
├── public/assets/demo/            4 synthetic sequences (PNG) + manifests + index.json   [generated]
├── scripts/generate-demo-frames.mjs   dependency-free PNG generator for the test patterns
├── src/
│   ├── app/                       App shell, hash routes, runtime wiring, pages (Landing, Jukebox, Understanding)
│   ├── components/
│   │   ├── Header/                header, footer
│   │   ├── Controls/TransportDock     playback, timeline, speed, sound, volume, record
│   │   └── Panels/                LibraryPanel, VisualizationPanel (overlays + explorer), GlobePanel,
│   │                              SoundMonitor, Inspector (Measure · Color · Shape & motion · Mapping · Access)
│   ├── eic/                       resourceAdapter (demo / local / official stub), visualizationPlayer, videoFrameExtractor
│   ├── analyzer/                  frameAnalyzer (canvas), featureExtractor, palette (k-means), regions (Otsu + shapes)
│   ├── audio/                     sonificationMapper (musical ruleset), audioEngine (Web Audio), audioScheduler
│   ├── sync/pipelineController.ts orchestration: player → analyzer → mapper → scheduler → UI
│   ├── scene/                     EarthScene, EarthGlobe (shaders), geo/coords, geo/solar, geo/earthTexture
│   ├── export/analysisExport.ts   CSV / JSON export of the whole sequence
│   ├── hooks/                     usePipeline, useHashRoute, useAccessibilityFeedback
│   └── styles/global.css
└── tests/                         Vitest unit tests (7 files)
```

## Visual analysis (what is measured)

Each displayed frame is drawn once onto an offscreen canvas, downscaled so its longest side is at most 160 px, then measured. Results are cached per source frame.

| Analysis | Method |
| --- | --- |
| Brightness, average RGB | Rec. 709 relative luminance; channel means |
| Colour palette | 5 dominant colours by **deterministic k-means** in RGB (initial centres at luminance quantiles) |
| Hue distribution | 12-bin saturation-weighted hue histogram, plus mean saturation |
| Warm–cool balance | Warm hue share minus cool hue share, from −1 to +1. These are colour-theory hue groups, **not temperature**. |
| Intensity distribution | 16-bin histogram; p10 / p50 / p90 |
| Visual complexity | Shannon entropy of the luminance histogram |
| Variation | Luminance σ and edge density |
| Spatial pixel density | **Otsu threshold** → share of the frame that is bright foreground |
| Shapes | Connected regions (8-connectivity): count, area, centroid, **elongation and orientation** from image moments |
| Spatial balance | Luminance centroid, 8 vertical and 8 horizontal bands (latitude bands for global maps) |
| Change and motion | A 32×16 luminance signature compared with the previous frame: mean change, changed area, per-cell change map, and the shift of the bright centre |
| Explorer grid | 16×8 cells with mean colour and brightness, for touch or keyboard exploration |

The frame view has overlay modes that draw these measurements onto the image:

- **Measure:** the centroid and the brightness bands
- **Shapes:** each detected region's box and main axis
- **Change:** a heatmap of where the frame changed, plus a motion arrow
- **Explore:** the explorer grid

## Sonification ruleset

These mappings are **experimental design choices, not scientific measurements**. Each can be toggled in *Inspector → Mapping*. The key, the instrument (glass / soft / pluck) and the reverb amount ("space") are user settings. Everything is deterministic: there is no randomness in the sound.

| Layer | Visual feature | Sound |
| --- | --- | --- |
| Harmony | Dominant palette colour | Chord degree in the key. The colour wheel's six sectors map to fifth-related chords: red I, yellow V, green ii, cyan vi, blue iii, magenta IV (minor equivalents in minor). |
| Harmony | Warm–cool balance | Major or minor mode |
| Harmony | Entropy | Triad, seventh or ninth chord |
| Melody | Hue distribution | Pentatonic pitches (red lowest … rose highest). Colours covering more of the frame play more often. |
| Melody | Intensity distribution | Octave register; octave leaps when the tonal spread is wide |
| Melody | Pixel variation | Notes per phrase (2–12 of 16 steps, Euclidean spacing) |
| Melody | Number of shapes | Polyphony: 1 voice, +fifth, +octave below |
| Melody | Shape elongation | Staccato → legato |
| Melody | Vertical motion | Rising or falling melodic contour |
| Rhythm | Spatial pixel density | Tempo: 8 / 12 / 16 steps per frame |
| Rhythm | Frame difference | Percussive ticks |
| Space | Brightness | Gain (square-root curve, bounded) |
| Space | Horizontal distribution | Stereo panning |
| Space | Saturation | Filter brightness (timbre) |

Sound layers: a bass drone, a 5-voice chord pad, the melody instrument and noise ticks. They feed a deterministic convolution reverb and a limiter.

### Synchronization

- While audio runs, the player uses `AudioContext.currentTime` as its clock. Each frame's phrase starts exactly at that frame's start time and spans its display duration.
- Every frame event gets a request id, so analysis results for an older frame are discarded.
- A new phrase cancels any notes that have not started yet, so phrases never overlap.
- Steps that are already late are skipped rather than shifted.
- Pause behaviour is selectable: *loop frame* (default) or *silence*. Stepping to another frame while paused always plays the new frame.

## The globe

- **Geography:** Natural Earth 1:50m land polygons, drawn with d3-geo's equirectangular projection into a 4096 × 2048 texture (2048 on small screens) plus a separate coastline/graticule channel.
- **Verified mapping:** `tests/geo.test.ts` checks that the latitude/longitude ↔ 3D conversion matches every vertex of `THREE.SphereGeometry`. This means no mirroring, the north pole is on top, east is to the right, and the map is not shifted.
- **Day and night:** the real sub-solar point for the current UTC time (NOAA solar position equations). It is tested against the 2024 equinox and solstices and the equation of time. Lighting is in Earth-fixed coordinates, so the terminator stays on the correct geography while the globe rotates.
- **Overlay:** a frame is draped only for collections declared as global equirectangular maps. The explorer's cell is shown as a marker at its true latitude and longitude, and the globe turns to face it.
- **Nothing invented:** no imagery, clouds, elevation or city lights are drawn.

## Accessibility

- **Text for every sound:** every value is shown as text. Every frame has a plain-language description, announced to screen readers while paused or stepping and readable aloud with the Web Speech API.
- **Sound for every area of the image:** with *Explore*, each area of the image plays a tone (pitch = colour, loudness = brightness, left/right = position) and is described in text. It works with touch, pointer or arrow keys.
- **Haptics:** optional vibration on each frame, scaled by how much the frame changed (on devices with the Vibration API).
- **Keyboard and controls:** all controls are keyboard operable with visible focus. Shortcuts are listed above.
- **Sound only on request:** sound starts only after you press *Start sound*, and mute and volume are always available.
- **Motion and fallbacks:** reduced motion is respected. The app keeps working without WebGL.

## Verified in this build

- `npm test`: **86 tests in 7 files** passed. They cover:
  - feature extraction, the palette, Otsu thresholding, shape moments (elongation and orientation), entropy, warm/cool balance and motion
  - the musical ruleset: chords, mode, tempo, polyphony, articulation and contour
  - player transitions, and scheduler timing and cancellation
  - pipeline synchronization: stale results, cache, pause modes, probe and recording
  - globe coordinates against SphereGeometry, and solar positions
- `npm run typecheck` and `npm run build` succeed.
- Manual checks in the browser:
  - the four sequences play with live audio on the AudioContext clock
  - chord, tempo and voices change with the frames
  - the globe shows correct coastlines and day/night for the current time
  - the Global Test Field drapes correctly, and an explorer marker at 33.8°N, 78.8°E lands in Ladakh
  - video import extracts frames with timestamps, and a 16:9 video is refused as a "global map"
  - CSV export works, and recording produces a decodable WebM/Opus file with audio
  - the production build shows no console errors
  - there is no horizontal overflow at 375 px

## Current limitations

- **Official frames are sampled.** Each resource uses 24–36 evenly spaced frames, not the full 30–60 fps video.
- **Legend values are estimates.** They come from colour matching against the published bars and are affected by shading and compression. Categorical legends are not converted to values.
- **Other mappings are aesthetic.** They describe image appearance, not physical quantities.
- **Recording format is browser-dependent.** WebM/Opus in Chromium and Firefox, MP4 in Safari. There is no WAV export.
- **Vibration is unavailable on iOS** and most desktops. Speech voices depend on the operating system.
- **Video decoding depends on the browser's codecs.** Very long videos are sampled to at most 240 frames.
- **Background tabs pause frame advancement** (it is driven by `requestAnimationFrame`).
- **The globe chunk is large.** About 260 kB gzipped plus 180 kB of coastline data, both lazy-loaded.
- **No automated end-to-end browser tests.** Browser behaviour was verified manually.

## Possible next steps

1. Per-frame dates for resources that publish them (for example `flat_ecco2_dates.txt` for SVS 3912).
2. Categorical legends (aerosol types) as separate instrument tracks.
3. A small proxy so any SVS page can be loaded by its ID at runtime.

## Use of AI (Super Intelligence)

As required by the NASA Space Apps Challenge rules, here is how AI tools were used in this project:

- **Code:** the application code in this repository was developed with the help of an AI coding assistant (Claude). The concept, the specification of features and sonification mappings, design decisions, data selection, testing and review were done by the TELLUVOX team.
- **Demo video voice-over:** generated with ElevenLabs from a script written for the project. The video shows a visible label, and the video file metadata and YouTube description state it.
- **Music:** not AI-generated. All sound is synthesized in real time by TELLUVOX's own algorithm from the visuals being played.
- **Data and visuals:** NASA visuals are used as published by NASA's Scientific Visualization Studio, only downscaled and sampled into frames. The synthetic demo sequences are generated by a deterministic script in this repository, not by AI.
- No AI-generated content uses NASA logos or branding.

## Attribution

- Visualizations: **NASA's Scientific Visualization Studio**: SVS 3912, 5313, 5669, 5533, 5425, 5196, 5011, 4960, 4950. Individual credits and datasets for each are stored in `public/assets/eic/<name>/manifest.json` and shown in the app.
- Coastlines: [Natural Earth](https://www.naturalearthdata.com/), public domain, via `world-atlas`.
- Solar position: NOAA general solar position equations.
- Synthetic demonstration sequences: generated by this project.
- Libraries: React, Three.js, React Three Fiber and Drei (pmndrs), d3-geo, topojson-client, Vite and IBM Plex (SIL OFL). See `package.json`.
