#!/usr/bin/env node
/**
 * TELLUVOX: synthetic demonstration sequence generator.
 *
 * Writes several PNG frame sequences plus manifests to public/assets/demo/.
 *
 * IMPORTANT: every sequence here is an abstract, procedurally generated test
 * pattern. None is derived from NASA data, satellite observations, or any
 * physical measurement, and colours do not encode temperature or any other
 * quantity. They exist only so the visual-to-audio pipeline can be developed
 * and demonstrated before official NASA Earth Information Center resources are
 * integrated.
 *
 * One sequence ("global-test-field") is *defined on a latitude–longitude grid*
 * in equirectangular layout (lon −180…180 left→right, lat 90…−90 top→bottom),
 * so the globe projection path can be demonstrated. It is still synthetic.
 *
 * Fully deterministic (no Math.random). No dependencies: PNG encoding uses zlib.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'assets', 'demo');

// ---------- minimal PNG encoder (RGB, 8-bit) ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- helpers ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}
function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), fx), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), fx), fy);
}
function fbm(x, y) {
  return 0.6 * valueNoise(x, y) + 0.3 * valueNoise(x * 2.1 + 17, y * 2.1 + 9) + 0.1 * valueNoise(x * 4.3 + 3, y * 4.3 + 41);
}
const gauss = (dx, dy, s) => Math.exp(-(dx * dx + dy * dy) / s);
function put(rgb, o, [r, g, b]) {
  rgb[o] = Math.round(clamp01(r) * 255);
  rgb[o + 1] = Math.round(clamp01(g) * 255);
  rgb[o + 2] = Math.round(clamp01(b) * 255);
}

// ---------- sequences ----------
const SEQUENCES = [
  {
    id: 'drifting-fields',
    title: 'Drifting Fields',
    description:
      'A bright field drifts from left to right while the palette shifts from violet-blue to green-amber, fine texture grows, and an abrupt event appears at frame 17.',
    highlights: ['Stereo panning follows the drift', 'Palette shift changes harmony and mode', 'Abrupt change → rhythmic burst'],
    width: 512,
    height: 256,
    frames: 24,
    georeferenced: false,
    render(i, n, x, y, W, H) {
      const t = i / (n - 1);
      const aspect = W / H;
      const brightnessEnv = 0.45 + 0.55 * Math.exp(-((t - 0.33) ** 2) / 0.045);
      const mainX = lerp(0.12, 0.88, smooth(t));
      const mainY = 0.5 + 0.18 * Math.sin(t * Math.PI * 2);
      const texture = 0.04 + 0.42 * smooth(clamp01((t - 0.35) / 0.45));
      const hueShift = lerp(0, -150, smooth(t));
      const burst = i >= 16 && i <= 18 ? [1, 0.6, 0.3][i - 16] : 0;
      let v = 0.85 * gauss((x - mainX) * aspect, y - mainY, 0.06);
      v += 0.35 * gauss((x - (0.75 - 0.4 * t)) * aspect, y - (0.3 + 0.2 * t), 0.03);
      v += 0.25 * gauss((x - (0.3 + 0.25 * Math.sin(t * 5))) * aspect, y - 0.75, 0.02);
      v += 0.12 * (0.5 + 0.5 * Math.sin(x * 9 + y * 4 + t * 6));
      v += texture * (fbm(x * 24 + t * 3, y * 12) - 0.5) * 1.4;
      if (burst > 0) v += burst * 0.9 * gauss((x - 0.22) * aspect, y - 0.62, 0.015);
      v = clamp01(v);
      return hslToRgb(255 - v * 85 + hueShift, 0.55 + 0.35 * v, clamp01(0.05 + 0.72 * v * brightnessEnv + 0.25 * burst * v));
    },
  },
  {
    id: 'banded-flow',
    title: 'Banded Flow',
    description:
      'Long meandering bands rise slowly through the frame. Their elongated shapes give legato phrases; turbulence grows and the palette warms from teal to coral.',
    highlights: ['Elongated shapes → legato', 'Upward motion → rising melody', 'Cool → warm: minor → major'],
    width: 512,
    height: 256,
    frames: 24,
    georeferenced: false,
    render(i, n, x, y) {
      const t = i / (n - 1);
      const rise = t * 0.35; // bands drift upward
      const turb = 0.02 + 0.09 * smooth(t);
      const yy = y + rise + turb * Math.sin(x * 14 + t * 9) + 0.05 * Math.sin(x * 4 - t * 3);
      const band = Math.pow(0.5 + 0.5 * Math.sin(yy * 22), 6);
      const flow = fbm(x * 8 - t * 4, yy * 30);
      let v = clamp01(band * (0.65 + 0.5 * flow) + 0.08 * flow);
      const hue = lerp(178, 8, smooth(t)) + v * 25; // teal → coral
      return hslToRgb(hue, 0.5 + 0.35 * v, clamp01(0.06 + 0.62 * v));
    },
  },
  {
    id: 'bloom',
    title: 'Bloom',
    description:
      'Separate luminous cells appear one by one, grow, and finally merge. The number of distinct shapes drives polyphony and bright coverage drives tempo.',
    highlights: ['More shapes → more voices', 'Coverage → faster tempo', 'Merging → shapes collapse to one'],
    width: 512,
    height: 256,
    frames: 20,
    georeferenced: false,
    render(i, n, x, y, W, H) {
      const t = i / (n - 1);
      const aspect = W / H;
      const centres = [
        [0.5, 0.5], [0.2, 0.3], [0.8, 0.32], [0.3, 0.75], [0.72, 0.72], [0.5, 0.18],
      ];
      const appear = (k) => clamp01(t * 7 - k * 0.9);
      const merge = smooth(clamp01((t - 0.72) / 0.28));
      let v = 0;
      centres.forEach(([cx, cy], k) => {
        const a = appear(k);
        if (a <= 0) return;
        const mx = lerp(cx, 0.5, merge), my = lerp(cy, 0.5, merge);
        const size = 0.004 + 0.01 * a + 0.03 * merge;
        v += a * gauss((x - mx) * aspect, y - my, size);
      });
      v = clamp01(v * 1.1 + 0.03 * fbm(x * 10, y * 5));
      const hue = 285 - v * 120 + 40 * t; // magenta-violet → aqua
      return hslToRgb(hue, 0.65, clamp01(0.04 + 0.7 * v));
    },
  },
  {
    id: 'global-test-field',
    title: 'Global Test Field',
    description:
      'An abstract field defined on a latitude–longitude grid (equirectangular). Two spots travel eastward around the planet and a polar cap pulses; purely synthetic, to demonstrate draping a global map onto the globe.',
    highlights: ['Georeferenced: drapes onto the globe', 'Explorer reports latitude / longitude', 'Eastward travel → panning sweeps'],
    width: 720,
    height: 360,
    frames: 24,
    georeferenced: true,
    render(i, n, x, y) {
      const t = i / n; // loops seamlessly
      const lon = x * 360 - 180;
      const lat = 90 - y * 180;
      const dlon = (a, b) => {
        let d = a - b;
        d = ((((d + 180) % 360) + 360) % 360) - 180;
        return d;
      };
      const rad = Math.PI / 180;
      // angular distance approx on the sphere for the spots
      const spot = (lat0, lon0, s) => {
        const dl = dlon(lon, lon0) * Math.cos(lat * rad);
        return Math.exp(-((dl * dl + (lat - lat0) ** 2) / s));
      };
      let v = 0.18 + 0.12 * Math.cos(lat * 3 * rad) * Math.cos(lat * rad); // zonal pattern
      v += 0.75 * spot(30, -180 + t * 360, 220);
      v += 0.6 * spot(-20, 0 + t * 360, 160);
      const cap = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      v += 0.55 * cap * clamp01((lat - 62) / 20);
      v += 0.06 * Math.sin(lon * 6 * rad + t * 12) * Math.cos(lat * rad);
      v = clamp01(v);
      // violet → cyan → ice: deliberately not a temperature colour scale
      const hue = lerp(268, 186, v);
      return hslToRgb(hue, 0.55 + 0.25 * v, clamp01(0.07 + 0.78 * v * v + 0.06 * v));
    },
  },
];

// ---------- write ----------
// Remove legacy single-sequence output from earlier versions.
if (existsSync(OUT_DIR)) {
  for (const f of readdirSync(OUT_DIR)) {
    const p = join(OUT_DIR, f);
    if (/^frame-\d+\.png$/.test(f) || f === 'manifest.json') rmSync(p);
    else if (statSync(p).isDirectory() && !SEQUENCES.some((s) => s.id === f)) rmSync(p, { recursive: true });
  }
}
mkdirSync(OUT_DIR, { recursive: true });

const PROVENANCE =
  'Procedurally generated by scripts/generate-demo-frames.mjs. Not derived from NASA data, satellite observations, or any physical measurement. Colours do not encode temperature or any physical quantity.';

const index = [];
for (const seq of SEQUENCES) {
  const dir = join(OUT_DIR, seq.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { width: W, height: H } = seq;
  const frames = [];
  for (let i = 0; i < seq.frames; i++) {
    const rgb = Buffer.alloc(W * H * 3);
    for (let py = 0; py < H; py++) {
      const y = (py + 0.5) / H;
      for (let px = 0; px < W; px++) put(rgb, (py * W + px) * 3, seq.render(i, seq.frames, (px + 0.5) / W, y, W, H));
    }
    const name = `frame-${String(i + 1).padStart(2, '0')}.png`;
    writeFileSync(join(dir, name), encodePng(W, H, rgb));
    frames.push({ file: name, label: `Synthetic frame ${String(i + 1).padStart(2, '0')}` });
    process.stdout.write(`\r${seq.id}: ${i + 1}/${seq.frames}   `);
  }
  const manifest = {
    id: `telluvox-synthetic-${seq.id}`,
    title: seq.title,
    description: seq.description,
    highlights: seq.highlights,
    isDemonstration: true,
    provenance: seq.georeferenced
      ? `${PROVENANCE} Defined on a latitude–longitude grid (equirectangular, lon −180…180°, lat 90…−90°) only to demonstrate globe projection; it does not describe Earth.`
      : `${PROVENANCE} Not georeferenced; no map projection.`,
    attribution: 'TELLUVOX project (synthetic test pattern).',
    legend: null,
    georeferenced: seq.georeferenced,
    projection: seq.georeferenced ? { type: 'equirectangular', lonMin: -180, lonMax: 180, latMax: 90, latMin: -90 } : null,
    width: W,
    height: H,
    frames,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  index.push({ id: manifest.id, dir: seq.id, title: seq.title, frames: seq.frames, georeferenced: seq.georeferenced });
  process.stdout.write('\n');
}
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({ sequences: index }, null, 2) + '\n');
process.stdout.write(`Wrote ${index.length} synthetic sequences to ${OUT_DIR}\n`);
