/**
 * Builds the globe's textures from Natural Earth 1:50m land polygons
 * (public domain, via the world-atlas package), projected with d3-geo's
 * equirectangular projection so they line up with SphereGeometry UVs.
 *
 *  - base:  RGB canvas, ocean + land fill
 *  - lines: 2-channel data (R = coastline + graticule ink, G = land mask)
 *
 * No imagery, elevation, clouds or city lights are drawn: only real
 * coastline geometry and a 15° latitude/longitude graticule.
 */
import { geoEquirectangular, geoGraticule, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

export interface EarthTextureData {
  base: HTMLCanvasElement;
  lines: Uint8Array;
  width: number;
  height: number;
}

export const OCEAN_COLOR = '#0a2540';
export const LAND_COLOR = '#41544a';

let cache: Promise<EarthTextureData> | null = null;
let cacheWidth = 0;

export function buildEarthTextures(width: number): Promise<EarthTextureData> {
  if (cache && cacheWidth === width) return cache;
  cacheWidth = width;
  cache = build(width);
  cache.catch(() => {
    cache = null;
  });
  return cache;
}

async function build(width: number): Promise<EarthTextureData> {
  const mod = await import('world-atlas/land-50m.json');
  const topo = (mod as { default: unknown }).default as Topology<{ land: GeometryCollection }>;
  const land = feature(topo, topo.objects.land);
  const coast = mesh(topo, topo.objects.land);

  const height = width / 2;
  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
    .precision(0.1);

  // Base colour layer
  const base = document.createElement('canvas');
  base.width = width;
  base.height = height;
  const bctx = base.getContext('2d');
  if (!bctx) throw new Error('2D canvas unavailable');
  // Ocean: slightly lighter towards the equator for depth, purely cosmetic.
  const grad = bctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#081d33');
  grad.addColorStop(0.5, OCEAN_COLOR);
  grad.addColorStop(1, '#081d33');
  bctx.fillStyle = grad;
  bctx.fillRect(0, 0, width, height);
  const bpath = geoPath(projection, bctx);
  bctx.beginPath();
  bpath(land);
  bctx.fillStyle = LAND_COLOR;
  bctx.fill();

  // Land mask (for ocean specular highlight)
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const mctx = mask.getContext('2d', { willReadFrequently: true });
  if (!mctx) throw new Error('2D canvas unavailable');
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, width, height);
  const mpath = geoPath(projection, mctx);
  mctx.beginPath();
  mpath(land);
  mctx.fillStyle = '#fff';
  mctx.fill();
  const maskData = mctx.getImageData(0, 0, width, height).data;

  // Line ink: coastlines + graticule
  const ink = document.createElement('canvas');
  ink.width = width;
  ink.height = height;
  const ictx = ink.getContext('2d', { willReadFrequently: true });
  if (!ictx) throw new Error('2D canvas unavailable');
  ictx.fillStyle = '#000';
  ictx.fillRect(0, 0, width, height);
  const ipath = geoPath(projection, ictx);
  const px = width / 4096;
  ictx.strokeStyle = 'rgb(70,70,70)';
  ictx.lineWidth = Math.max(0.6, 1.1 * px);
  ictx.beginPath();
  ipath(geoGraticule().step([15, 15])());
  ictx.stroke();
  // Equator a little stronger
  ictx.strokeStyle = 'rgb(110,110,110)';
  ictx.beginPath();
  ipath({ type: 'LineString', coordinates: [[-180, 0], [-90, 0], [0, 0], [90, 0], [180, 0]] });
  ictx.stroke();
  ictx.strokeStyle = 'rgb(235,235,235)';
  ictx.lineWidth = Math.max(0.8, 1.6 * px);
  ictx.lineJoin = 'round';
  ictx.beginPath();
  ipath(coast);
  ictx.stroke();
  const inkData = ictx.getImageData(0, 0, width, height).data;

  // Rows are written bottom-up: a DataTexture is uploaded without flipping, so
  // memory row 0 must be the southernmost row (uv.y = 0 is the south pole).
  const lines = new Uint8Array(width * height * 2);
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = (height - 1 - y) * width * 2;
    for (let x = 0; x < width; x++) {
      lines[dst + x * 2] = inkData[src + x * 4] as number;
      lines[dst + x * 2 + 1] = maskData[src + x * 4] as number;
    }
  }
  mask.width = mask.height = 0;
  ink.width = ink.height = 0;
  return { base, lines, width, height };
}
