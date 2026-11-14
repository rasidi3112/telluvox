import { describe, expect, it } from 'vitest';
import { OfficialEicResourceAdapter } from '../src/eic/resourceAdapter';

const svs = {
  id: 3912,
  pageUrl: 'https://svs.gsfc.nasa.gov/3912/',
  pageTitle: 'Global Sea Surface Currents and Temperature',
  releaseDate: '2012-03-16',
  sourceFile: 'ecco2_sst_flow.mp4',
  sourceUrl: 'https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003912/ecco2_sst_flow.mp4',
  sourceWidth: 2048,
  sourceHeight: 1024,
  sourceDuration: 66.7,
  credits: ['Animator: Greg Shirah (NASA/GSFC)'],
  datasets: ['ECCO2 High Resolution Ocean and Sea Ice Model'],
};

function manifest(over: Record<string, unknown> = {}) {
  return {
    id: 'svs-3912-sea-surface-currents',
    title: 'Global Sea Surface Currents and Temperature',
    description: 'Currents coloured by temperature.',
    highlights: ['a'],
    svs,
    attribution: "NASA's Scientific Visualization Studio",
    projection: 'equirectangular',
    georeferenced: true,
    legend: { image: 'legend.png', quantity: 'Sea surface temperature', units: '°C', min: 0, max: 32, svsNote: 'Blue is 0 °C.', strip: { x0: 0, y0: 0, x1: 1, y1: 1 }, match: 'chroma' },
    width: 2048,
    height: 1024,
    frames: [
      { file: 'frame-01.jpg', label: 'f1', timeLabel: 'video 0:01.6' },
      { file: 'frame-02.jpg', label: 'f2', timeLabel: 'video 0:03.8' },
    ],
    ...over,
  };
}

function fakeFetch(files: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(files).find((k) => String(url).endsWith(k));
    if (!key) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(files[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

const index = { sequences: [{ id: 'svs-3912-sea-surface-currents', dir: 'sea-surface-currents', title: 'Global Sea Surface Currents and Temperature', frames: 2, georeferenced: true }] };

describe('OfficialEicResourceAdapter', () => {
  it('lists official resources with thumbnails', async () => {
    const a = new OfficialEicResourceAdapter('/eic/', fakeFetch({ 'index.json': index }));
    const list = await a.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'official', frameCount: 2, thumbnail: '/eic/sea-surface-currents/frame-01.jpg' });
  });

  it('returns an empty list (not an error) before resources are fetched', async () => {
    const a = new OfficialEicResourceAdapter('/eic/', fakeFetch({}));
    expect(await a.list()).toEqual([]);
  });

  it('loads provenance, credits, legend and verified projection', async () => {
    const a = new OfficialEicResourceAdapter('/eic/', fakeFetch({ 'index.json': index, 'sea-surface-currents/manifest.json': manifest() }));
    const c = await a.load('svs-3912-sea-surface-currents');
    expect(c.kind).toBe('official');
    expect(c.isDemonstration).toBe(false);
    expect(c.svs?.credits[0]).toContain('Greg Shirah');
    expect(c.georeferenced).toBe(true);
    expect(c.projection?.type).toBe('equirectangular');
    expect(c.legend).toMatchObject({ quantity: 'Sea surface temperature', min: 0, max: 32, image: '/eic/sea-surface-currents/legend.png', match: 'chroma' });
    expect(c.frames[1]).toMatchObject({ url: '/eic/sea-surface-currents/frame-02.jpg', timeLabel: 'video 0:03.8' });
  });

  it('never drapes a resource that is not 2:1, even if the manifest claims it', async () => {
    const m = manifest({ width: 1920, height: 1080 });
    const a = new OfficialEicResourceAdapter('/eic/', fakeFetch({ 'index.json': index, 'sea-surface-currents/manifest.json': m }));
    const c = await a.load('svs-3912-sea-surface-currents');
    expect(c.georeferenced).toBe(false);
    expect(c.projection).toBeNull();
  });
});
