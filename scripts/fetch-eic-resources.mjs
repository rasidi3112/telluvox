#!/usr/bin/env node
/**
 * TELLUVOX: fetch the official challenge resources (NASA SVS / Earth Information Center).
 *
 * Why a script: svs.gsfc.nasa.gov does not send CORS headers for this app's
 * origin, so the browser cannot read the pixels of remotely hosted SVS media.
 * This script extracts a modest number of evenly spaced frames from each
 * listed visualization with ffmpeg (which reads only the needed byte ranges of
 * large videos), downsizes them, and writes them with a manifest to
 * public/assets/eic/. Credits and metadata come from the SVS API.
 *
 * Requires ffmpeg/ffprobe on PATH and network access.
 *   node scripts/fetch-eic-resources.mjs            # all entries
 *   node scripts/fetch-eic-resources.mjs night-lights-change gedi-forest-height
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets', 'eic');
const VIS = 'https://svs.gsfc.nasa.gov/vis/a000000/';
const API = 'https://svs.gsfc.nasa.gov/api/';
const UA = 'Mozilla/5.0 (TELLUVOX resource fetch)';
const catalog = JSON.parse(readFileSync(join(ROOT, 'scripts', 'eic-catalog.json'), 'utf8'));

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function ffmpeg(args, tries = 2) {
  for (let i = 0; ; i++) {
    try {
      return await run('ffmpeg', ['-v', 'error', '-y', '-user_agent', UA, ...args], { maxBuffer: 1 << 24 });
    } catch (e) {
      if (i + 1 >= tries) throw e;
    }
  }
}

async function probe(url) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-user_agent', UA, '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', url,
  ]);
  const j = JSON.parse(stdout);
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
}

function credits(api) {
  const out = [];
  for (const c of api.credits ?? []) {
    for (const p of c.people ?? []) out.push(`${c.role}: ${p.name}${p.employer ? ` (${p.employer})` : ''}`);
  }
  return out;
}

async function processEntry(e) {
  const dir = join(OUT, e.slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const api = await getJson(`${API}${e.svsId}`);
  const srcUrl = VIS + e.source.path;
  const frames = [];
  let srcInfo;

  if (e.source.type === 'video') {
    srcInfo = await probe(srcUrl);
    const end = Math.min(e.source.end, srcInfo.duration - 0.05);
    const span = end - e.source.start;
    for (let i = 0; i < e.source.count; i++) {
      const t = e.source.start + ((i + 0.5) / e.source.count) * span;
      const file = `frame-${String(i + 1).padStart(2, '0')}.jpg`;
      await ffmpeg(['-ss', t.toFixed(3), '-i', srcUrl, '-frames:v', '1', '-vf', `scale=${e.source.width}:-2:flags=lanczos`, '-q:v', '7', join(dir, file)]);
      frames.push({ file, label: `${e.title.split(':')[0]} · ${fmtTime(t)}`, timeLabel: `video ${fmtTime(t)}`, videoTime: Number(t.toFixed(3)) });
      process.stdout.write(`\r${e.slug}: ${i + 1}/${e.source.count}   `);
    }
  } else {
    const file = 'frame-01.jpg';
    await ffmpeg(['-i', srcUrl, '-vf', `scale=${e.source.width}:-2:flags=lanczos`, '-q:v', '2', join(dir, file)]);
    const p = await probe(srcUrl).catch(() => ({ width: null, height: null, duration: 0 }));
    srcInfo = p;
    frames.push({ file, label: e.title, timeLabel: 'still image', videoTime: null });
  }
  process.stdout.write('\n');

  let legend = null;
  if (e.legend) {
    legend = { ...e.legend };
    if (e.legend.image) {
      const file = `legend${extname(e.legend.image)}`;
      await download(VIS + e.legend.image, join(dir, file));
      legend.image = file;
      legend.sourceUrl = VIS + e.legend.image;
    }
  }

  // Output frame size (all frames share it)
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(dir, frames[0].file)]);
  const [fw, fh] = stdout.trim().split(',').map(Number);

  const manifest = {
    id: `svs-${e.svsId}-${e.slug}`,
    title: e.title,
    description: e.summary,
    highlights: e.listenFor,
    svs: {
      id: e.svsId,
      pageUrl: `https://svs.gsfc.nasa.gov/${e.svsId}/`,
      pageTitle: api.title,
      releaseDate: api.release_date?.slice(0, 10) ?? null,
      sourceFile: e.source.path.split('/').pop(),
      sourceUrl: srcUrl,
      sourceWidth: srcInfo.width,
      sourceHeight: srcInfo.height,
      sourceDuration: srcInfo.duration || null,
      credits: credits(api),
      datasets: (api.datasets ?? []).map((d) => d.name).filter(Boolean),
    },
    attribution: `NASA's Scientific Visualization Studio${api.credits?.length ? `: ${credits(api).slice(0, 3).map((c) => c.split(': ')[1]).join(', ')}` : ''}`,
    projection: e.projection,
    georeferenced: e.georeferenced,
    projectionCheck: e.projectionCheck ?? null,
    legend,
    width: fw,
    height: fh,
    frames,
    extracted: { at: new Date().toISOString(), count: frames.length, note: 'Evenly spaced frames, downscaled; JPEG.' },
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function main() {
  const only = process.argv.slice(2);
  const entries = catalog.entries.filter((e) => only.length === 0 || only.includes(e.slug));
  mkdirSync(OUT, { recursive: true });
  const results = [];
  for (let i = 0; i < entries.length; i += 3) {
    const batch = entries.slice(i, i + 3);
    const done = await Promise.allSettled(batch.map(processEntry));
    done.forEach((r, j) => {
      if (r.status === 'fulfilled') results.push(r.value);
      else console.error(`FAILED ${batch[j].slug}: ${r.reason?.message ?? r.reason}`);
    });
  }
  // Rebuild index from every manifest on disk (so partial runs keep earlier entries).
  const index = [];
  for (const e of catalog.entries) {
    const mp = join(OUT, e.slug, 'manifest.json');
    if (!existsSync(mp)) continue;
    const m = JSON.parse(readFileSync(mp, 'utf8'));
    const bytes = readdirSync(join(OUT, e.slug)).reduce((s, f) => s + statSync(join(OUT, e.slug, f)).size, 0);
    index.push({ id: m.id, dir: e.slug, title: m.title, frames: m.frames.length, georeferenced: m.georeferenced, svsId: e.svsId, bytes });
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ source: 'NASA Space Apps 2026: Earth Information Jukebox resources', sequences: index }, null, 2) + '\n');
  const total = index.reduce((s, x) => s + x.bytes, 0);
  console.log(`Wrote ${index.length} official sequences (${(total / 1048576).toFixed(1)} MB) to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
