/**
 * Application runtime: one instance of each pipeline service for the SPA.
 * Created lazily so nothing touches Web Audio until the user asks for sound.
 */
import { FrameAnalyzer } from '../analyzer/frameAnalyzer';
import { AudioEngine } from '../audio/audioEngine';
import { AudioScheduler } from '../audio/audioScheduler';
import {
  DemoResourceAdapter,
  FrameImageStore,
  LocalFileResourceAdapter,
  OfficialEicResourceAdapter,
  ResourceError,
  isEquirectangularAspect,
  loadImage,
  type VisualizationCollection,
} from '../eic/resourceAdapter';
import { extractVideoFrames } from '../eic/videoFrameExtractor';
import { VisualizationPlayer } from '../eic/visualizationPlayer';
import { PipelineController } from '../sync/pipelineController';

export interface Runtime {
  player: VisualizationPlayer;
  engine: AudioEngine;
  scheduler: AudioScheduler;
  analyzer: FrameAnalyzer;
  images: FrameImageStore;
  controller: PipelineController;
  demo: DemoResourceAdapter;
  official: OfficialEicResourceAdapter;
  local: LocalFileResourceAdapter;
  /** Load the library and open the given sequence (default: first official resource, else first demo). */
  loadDemo(id?: string): Promise<void>;
  selectCollection(id: string): Promise<void>;
  loadLocalFiles(files: File[], opts: { georeferenced: boolean }): Promise<void>;
  loadVideo(file: File, opts: { count: number; georeferenced: boolean }): Promise<void>;
}

let runtime: Runtime | null = null;

export function getRuntime(): Runtime {
  if (runtime) return runtime;
  const player = new VisualizationPlayer({ baseFrameDuration: 2, loop: true });
  const engine = new AudioEngine();
  const scheduler = new AudioScheduler(engine);
  const analyzer = new FrameAnalyzer({ maxSampleWidth: 160, maxSampleHeight: 160 });
  const images = new FrameImageStore();
  const controller = new PipelineController({
    player,
    engine,
    scheduler,
    loadFrameImage: (frame) => images.get(frame),
    analyze: (image) => analyzer.analyze(image),
    readLegendImage: async (url) => {
      const img = await loadImage(url);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas unavailable');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      return { data: d.data, width: d.width, height: d.height };
    },
  });
  const demo = new DemoResourceAdapter();
  const official = new OfficialEicResourceAdapter();
  const local = new LocalFileResourceAdapter();

  const refreshLibrary = async () =>
    controller.setLibrary([...(await official.list()), ...(await demo.list()), ...(await local.list())]);
  const adapterFor = (id: string) => (id.startsWith('local-') ? local : id.startsWith('svs-') ? official : demo);

  /** Refuse to drape non-2:1 images on the globe (they cannot be global equirectangular maps). */
  const assertEquirect = async (c: VisualizationCollection) => {
    const first = c.frames[0];
    if (!first) return;
    const img = await loadImage(first.url);
    if (!isEquirectangularAspect(img.naturalWidth, img.naturalHeight)) {
      throw new ResourceError(
        `A global equirectangular map must be 2:1 (360° × 180°). “${first.label}” is ${img.naturalWidth}×${img.naturalHeight} (${(img.naturalWidth / img.naturalHeight).toFixed(2)}:1), so it was not draped on the globe. Load it again without the “global map” option.`,
      );
    }
  };

  const useCollection = (c: VisualizationCollection) => {
    images.clear();
    void images.preload(c.frames);
    controller.setCollection(c);
  };

  runtime = {
    player,
    engine,
    scheduler,
    analyzer,
    images,
    controller,
    demo,
    official,
    local,
    async loadDemo(id?: string) {
      controller.setLoading();
      try {
        await refreshLibrary();
        const lib = controller.getSnapshot().library;
        const target = id ?? lib[0]?.id;
        if (!target) throw new Error('No visualizations available.');
        useCollection(await adapterFor(target).load(target));
      } catch (e) {
        controller.setLoadError(e instanceof Error ? e.message : String(e));
      }
    },
    async selectCollection(id: string) {
      if (controller.getSnapshot().selectedId === id) return;
      const wasPlaying = player.getState().isPlaying;
      player.pause();
      try {
        const c = await adapterFor(id).load(id);
        useCollection(c);
        if (wasPlaying) player.play();
      } catch (e) {
        controller.setLoadError(e instanceof Error ? e.message : String(e));
      }
    },
    async loadLocalFiles(files: File[], opts: { georeferenced: boolean }) {
      controller.setImportState({ busy: true, message: 'Reading images…', progress: null, error: null });
      try {
        player.pause();
        const c = local.setFiles(files, opts);
        if (opts.georeferenced) await assertEquirect(c);
        useCollection(c);
        await refreshLibrary();
        controller.setImportState({ busy: false, message: `Loaded ${c.frames.length} images.`, progress: null });
      } catch (e) {
        local.dispose();
        controller.setImportState({ busy: false, message: null, progress: null, error: e instanceof Error ? e.message : String(e) });
      }
    },
    async loadVideo(file: File, opts: { count: number; georeferenced: boolean }) {
      controller.setImportState({ busy: true, message: `Extracting frames from ${file.name}…`, progress: 0, error: null });
      try {
        player.pause();
        const res = await extractVideoFrames(file, {
          count: opts.count,
          onProgress: (d, t) => controller.setImportState({ progress: d / t, message: `Extracting frame ${d} of ${t}…` }),
        });
        if (opts.georeferenced && !isEquirectangularAspect(res.width, res.height)) {
          for (const f of res.frames) URL.revokeObjectURL(f.url);
          throw new ResourceError(
            `A global equirectangular map must be 2:1 (360° × 180°). This video is ${res.width}×${res.height} (${(res.width / res.height).toFixed(2)}:1), so it was not draped on the globe. Load it again without the “global map” option.`,
          );
        }
        const c = local.setFrames(res.frames, {
          title: file.name,
          description: `${res.frames.length} frames sampled evenly from a ${res.duration.toFixed(1)} s video (${res.width}×${res.height}).`,
          georeferenced: opts.georeferenced,
          source: 'video',
        });
        useCollection(c);
        await refreshLibrary();
        controller.setImportState({ busy: false, message: `Extracted ${res.frames.length} frames.`, progress: null });
      } catch (e) {
        controller.setImportState({ busy: false, message: null, progress: null, error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
  // Development-only handle for debugging and manual verification in the console.
  if (import.meta.env.DEV) (window as unknown as { __telluvox?: Runtime }).__telluvox = runtime;
  return runtime;
}
