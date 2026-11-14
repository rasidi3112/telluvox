/**
 * Resource adapter layer.
 *
 * Everything downstream (player, analyzer, sonification, globe) consumes the
 * `VisualizationCollection` shape below and nothing else. To integrate official
 * NASA Earth Information Center resources, implement another `ResourceAdapter`
 * that produces the same shape; the analyzer and audio engine do not change.
 *
 * No assumptions are made about dataset, file format, physical quantity,
 * legend, or map projection. Those are optional metadata so the UI can display
 * them truthfully when (and only when) a resource provides them.
 */

export type ResourceKind = 'demonstration' | 'user-supplied' | 'official';

export interface FrameDescriptor {
  /** 0-based position in the sequence. */
  index: number;
  /** URL the browser can load as an image (same-origin, CORS-enabled, blob: or data:). */
  url: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Optional time label supplied by the resource (e.g. video timestamp). Never fabricated. */
  timeLabel?: string;
}

/** A legend that establishes what colours mean. `null` when no legend is known. */
export interface ColorLegend {
  quantity: string;
  units: string | null;
  /** Value range of a continuous colour bar. */
  min?: number;
  max?: number;
  /** True when colours denote categories (e.g. aerosol type), not a numeric scale. */
  categorical?: boolean;
  /** URL of the published colour-bar image. */
  image?: string;
  /** The publisher's own wording about the colours. */
  note?: string;
  /** Where the colour gradient sits inside the image (fractions), when it can be read automatically. */
  strip?: { x0: number; y0: number; x1: number; y1: number };
  /** How frame colours are compared with the bar ('chroma' tolerates dimmed/blended lines). */
  match?: 'rgb' | 'chroma';
  /** Why the bar is deliberately not read automatically (shown to the user). */
  notReadReason?: string;
}

/** Provenance of an official NASA Scientific Visualization Studio resource. */
export interface SvsSource {
  id: number;
  pageUrl: string;
  pageTitle: string;
  releaseDate: string | null;
  sourceFile: string;
  sourceUrl: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceDuration: number | null;
  credits: string[];
  datasets: string[];
}

/** Equirectangular (plate carrée) global map: x ∝ longitude, y ∝ latitude. */
export interface EquirectangularProjection {
  type: 'equirectangular';
  lonMin: -180;
  lonMax: 180;
  latMax: 90;
  latMin: -90;
}

export interface VisualizationCollection {
  id: string;
  title: string;
  description: string;
  /** Short bullet points about what to listen for (optional). */
  highlights?: string[];
  kind: ResourceKind;
  /** True for synthetic/test material. The UI must label it as demonstration data. */
  isDemonstration: boolean;
  provenance: string;
  attribution: string;
  legend: ColorLegend | null;
  /** True only if the resource states a projection that can be mapped onto a sphere. */
  georeferenced: boolean;
  projection: EquirectangularProjection | null;
  frames: FrameDescriptor[];
  /** Where the frames came from (for user-supplied material). */
  source?: 'images' | 'video' | 'manifest';
  /** Official SVS provenance (official resources only). */
  svs?: SvsSource;
}

export interface ResourceSummary {
  id: string;
  title: string;
  kind: ResourceKind;
  frameCount: number;
  georeferenced: boolean;
  thumbnail: string | null;
}

export interface ResourceAdapter {
  readonly id: string;
  list(): Promise<ResourceSummary[]>;
  load(id: string): Promise<VisualizationCollection>;
}

export class ResourceError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'ResourceError';
  }
}

export const EQUIRECTANGULAR: EquirectangularProjection = { type: 'equirectangular', lonMin: -180, lonMax: 180, latMax: 90, latMin: -90 };

/** Global equirectangular maps must be 2:1 (360° × 180°). Allow 1% tolerance for odd sizes. */
export function isEquirectangularAspect(width: number, height: number): boolean {
  return height > 0 && Math.abs(width / height - 2) <= 0.02;
}

// ---------------------------------------------------------------------------
// Demonstration adapter: synthetic sequences from scripts/generate-demo-frames.mjs
// ---------------------------------------------------------------------------

interface DemoIndex {
  sequences: { id: string; dir: string; title: string; frames: number; georeferenced: boolean }[];
}

interface DemoManifest {
  id: string;
  title: string;
  description: string;
  highlights?: string[];
  provenance: string;
  attribution: string;
  georeferenced: boolean;
  projection: { type: string } | null;
  width: number;
  height: number;
  frames: { file: string; label: string }[];
}

function isDemoIndex(v: unknown): v is DemoIndex {
  return typeof v === 'object' && v !== null && Array.isArray((v as DemoIndex).sequences);
}

function isDemoManifest(value: unknown): value is DemoManifest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    Array.isArray(v.frames) &&
    v.frames.every(
      (f) => typeof f === 'object' && f !== null && typeof (f as Record<string, unknown>).file === 'string' && typeof (f as Record<string, unknown>).label === 'string',
    )
  );
}

export class DemoResourceAdapter implements ResourceAdapter {
  readonly id = 'demo';
  private index: DemoIndex | null = null;

  constructor(
    private readonly baseUrl: string = `${import.meta.env.BASE_URL}assets/demo/`,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async getJson(url: string): Promise<unknown> {
    try {
      const res = await this.fetchImpl(url);
      if (!res.ok) throw new ResourceError(`Request failed (HTTP ${res.status}): ${url}`);
      return await res.json();
    } catch (err) {
      if (err instanceof ResourceError) throw err;
      throw new ResourceError('Could not load the demonstration sequences. Run `npm run generate:demo`.', err);
    }
  }

  private async getIndex(): Promise<DemoIndex> {
    if (this.index) return this.index;
    const json = await this.getJson(`${this.baseUrl}index.json`);
    if (!isDemoIndex(json)) throw new ResourceError('Demonstration index is malformed.');
    this.index = json;
    return json;
  }

  async list(): Promise<ResourceSummary[]> {
    const idx = await this.getIndex();
    return idx.sequences.map((s) => ({
      id: s.id,
      title: s.title,
      kind: 'demonstration',
      frameCount: s.frames,
      georeferenced: s.georeferenced,
      thumbnail: `${this.baseUrl}${s.dir}/frame-01.png`,
    }));
  }

  async load(id: string): Promise<VisualizationCollection> {
    const idx = await this.getIndex();
    const entry = idx.sequences.find((s) => s.id === id);
    if (!entry) throw new ResourceError(`Unknown demonstration sequence: ${id}`);
    const dirUrl = `${this.baseUrl}${entry.dir}/`;
    const json = await this.getJson(`${dirUrl}manifest.json`);
    if (!isDemoManifest(json)) throw new ResourceError('Demonstration manifest is malformed.');
    if (json.frames.length === 0) throw new ResourceError('Demonstration manifest contains no frames.');
    const geo = json.georeferenced === true && json.projection?.type === 'equirectangular' && isEquirectangularAspect(json.width, json.height);
    return {
      id: json.id,
      title: json.title,
      description: json.description,
      highlights: json.highlights,
      kind: 'demonstration',
      // Always treated as demonstration data regardless of manifest content.
      isDemonstration: true,
      provenance: json.provenance,
      attribution: json.attribution,
      legend: null,
      georeferenced: geo,
      projection: geo ? EQUIRECTANGULAR : null,
      frames: json.frames.map((f, index) => ({ index, url: `${dirUrl}${f.file}`, label: f.label })),
      source: 'manifest',
    };
  }
}

// ---------------------------------------------------------------------------
// Local adapter: images or video frames the user provides from their device.
// This is how official EIC media can be tried before an official adapter exists.
// ---------------------------------------------------------------------------

export interface LocalFrameInput {
  url: string;
  label: string;
  timeLabel?: string;
}

export class LocalFileResourceAdapter implements ResourceAdapter {
  readonly id = 'local';
  private collection: VisualizationCollection | null = null;
  private objectUrls: string[] = [];

  /** Build a collection from user-selected image files (natural filename order). */
  setFiles(files: File[], opts: { georeferenced: boolean }): VisualizationCollection {
    const images = files
      .filter((f) => f.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (images.length === 0) throw new ResourceError('No image files were selected.');
    const frames = images.map((f) => ({ url: URL.createObjectURL(f), label: f.name }));
    return this.setFrames(frames, {
      title: `Your images (${images.length})`,
      description: 'Images loaded from your device. TELLUVOX has no information about their content or origin.',
      georeferenced: opts.georeferenced,
      source: 'images',
    });
  }

  /** Build a collection from already-created object URLs (e.g. extracted video frames). Takes ownership of the URLs. */
  setFrames(
    frames: LocalFrameInput[],
    meta: { title: string; description: string; georeferenced: boolean; source: 'images' | 'video' },
  ): VisualizationCollection {
    this.dispose();
    if (frames.length === 0) throw new ResourceError('No frames to load.');
    this.objectUrls = frames.map((f) => f.url);
    this.collection = {
      id: `local-${Date.now()}`,
      title: meta.title,
      description: meta.description,
      kind: 'user-supplied',
      isDemonstration: false,
      provenance: meta.georeferenced
        ? 'User-supplied frames declared by the user as global equirectangular maps (lon −180…180°, lat 90…−90°). Origin, units and legend unknown to TELLUVOX.'
        : 'User-supplied frames. Origin, units, projection and legend unknown to TELLUVOX.',
      attribution: 'Provided by the user. Add the original source’s credit when sharing.',
      legend: null,
      georeferenced: meta.georeferenced,
      projection: meta.georeferenced ? EQUIRECTANGULAR : null,
      frames: frames.map((f, index) => ({ index, url: f.url, label: f.label, timeLabel: f.timeLabel })),
      source: meta.source,
    };
    return this.collection;
  }

  current(): VisualizationCollection | null {
    return this.collection;
  }

  async list(): Promise<ResourceSummary[]> {
    const c = this.collection;
    return c
      ? [{ id: c.id, title: c.title, kind: 'user-supplied', frameCount: c.frames.length, georeferenced: c.georeferenced, thumbnail: c.frames[0]?.url ?? null }]
      : [];
  }

  async load(id: string): Promise<VisualizationCollection> {
    if (!this.collection || this.collection.id !== id) throw new ResourceError('Local collection not found.');
    return this.collection;
  }

  dispose(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.collection = null;
  }
}

// ---------------------------------------------------------------------------
// Official challenge resources (NASA SVS / Earth Information Center).
// Frames are extracted by scripts/fetch-eic-resources.mjs into public/assets/eic/
// because svs.gsfc.nasa.gov does not allow cross-origin pixel access.
// ---------------------------------------------------------------------------

interface EicManifest {
  id: string;
  title: string;
  description: string;
  highlights?: string[];
  svs: SvsSource;
  attribution: string;
  projection: string | null;
  georeferenced: boolean;
  legend: (Omit<ColorLegend, 'note' | 'image'> & { image?: string; svsNote?: string }) | null;
  width: number;
  height: number;
  frames: { file: string; label: string; timeLabel?: string }[];
}

function isEicManifest(v: unknown): v is EicManifest {
  if (!isDemoManifest(v)) return false;
  const svs = (v as unknown as Record<string, unknown>).svs;
  return typeof svs === 'object' && svs !== null && typeof (svs as Record<string, unknown>).pageUrl === 'string';
}

export class OfficialEicResourceAdapter implements ResourceAdapter {
  readonly id = 'eic';
  private index: DemoIndex | null = null;

  constructor(
    private readonly baseUrl: string = `${import.meta.env.BASE_URL}assets/eic/`,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async getJson(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new ResourceError(`Request failed (HTTP ${res.status}): ${url}`);
    return res.json();
  }

  /** Empty list (not an error) when the resources have not been fetched yet. */
  async list(): Promise<ResourceSummary[]> {
    if (!this.index) {
      try {
        const json = await this.getJson(`${this.baseUrl}index.json`);
        this.index = isDemoIndex(json) ? json : { sequences: [] };
      } catch {
        this.index = { sequences: [] };
      }
    }
    return this.index.sequences.map((s) => ({
      id: s.id,
      title: s.title,
      kind: 'official',
      frameCount: s.frames,
      georeferenced: s.georeferenced,
      thumbnail: `${this.baseUrl}${s.dir}/frame-01.jpg`,
    }));
  }

  async load(id: string): Promise<VisualizationCollection> {
    await this.list();
    const entry = this.index?.sequences.find((s) => s.id === id);
    if (!entry) throw new ResourceError(`Unknown official resource: ${id}`);
    const dirUrl = `${this.baseUrl}${entry.dir}/`;
    const json = await this.getJson(`${dirUrl}manifest.json`);
    if (!isEicManifest(json)) throw new ResourceError('Official resource manifest is malformed.');
    const geo = json.georeferenced === true && json.projection === 'equirectangular' && isEquirectangularAspect(json.width, json.height);
    const legend: ColorLegend | null = json.legend
      ? {
          quantity: json.legend.quantity,
          units: json.legend.units ?? null,
          min: json.legend.min,
          max: json.legend.max,
          categorical: json.legend.categorical,
          image: json.legend.image ? `${dirUrl}${json.legend.image}` : undefined,
          note: json.legend.svsNote,
          strip: json.legend.strip,
          match: json.legend.match,
          notReadReason: json.legend.notReadReason,
        }
      : null;
    return {
      id: json.id,
      title: json.title,
      description: json.description,
      highlights: json.highlights,
      kind: 'official',
      isDemonstration: false,
      provenance: `Official challenge resource from NASA’s Scientific Visualization Studio (SVS ${json.svs.id}, ${json.svs.pageTitle}). ${json.frames.length} frames extracted from ${json.svs.sourceFile}${json.svs.sourceWidth ? ` (${json.svs.sourceWidth}×${json.svs.sourceHeight})` : ''} and downscaled for analysis.`,
      attribution: json.attribution,
      legend,
      georeferenced: geo,
      projection: geo ? EQUIRECTANGULAR : null,
      frames: json.frames.map((f, index) => ({ index, url: `${dirUrl}${f.file}`, label: f.label, timeLabel: f.timeLabel })),
      source: 'manifest',
      svs: json.svs,
    };
  }
}

// ---------------------------------------------------------------------------
// Image loading with explicit error handling.
// ---------------------------------------------------------------------------

export function loadImage(url: string, timeoutMs = 15000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => {
      img.src = '';
      reject(new ResourceError(`Timed out loading image: ${url}`));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new ResourceError(`Image has invalid dimensions: ${url}`));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new ResourceError(`Image failed to load (missing file or blocked by CORS): ${url}`));
    };
    img.src = url;
  });
}

/** Loads and caches decoded frame images so playback never waits on the network twice. */
export class FrameImageStore {
  private cache = new Map<string, Promise<HTMLImageElement>>();

  get(frame: FrameDescriptor): Promise<HTMLImageElement> {
    let p = this.cache.get(frame.url);
    if (!p) {
      p = loadImage(frame.url);
      p.catch(() => this.cache.delete(frame.url));
      this.cache.set(frame.url, p);
    }
    return p;
  }

  preload(frames: FrameDescriptor[]): Promise<PromiseSettledResult<HTMLImageElement>[]> {
    return Promise.allSettled(frames.map((f) => this.get(f)));
  }

  clear(): void {
    this.cache.clear();
  }
}
