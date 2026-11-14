import { useEffect, useSyncExternalStore } from 'react';
import { getRuntime } from '../app/runtime';
import type { PipelineSnapshot } from '../sync/pipelineController';

/** Subscribe to the synchronized pipeline state. */
export function usePipeline(): PipelineSnapshot {
  const { controller } = getRuntime();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/** Run a callback on every animation frame while mounted (for meters that must not re-render React). */
export function useAnimationFrame(callback: (time: number) => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (t: number) => {
      callback(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [callback, active]);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}
