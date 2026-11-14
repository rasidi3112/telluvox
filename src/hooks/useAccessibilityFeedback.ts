import { useEffect, useRef } from 'react';
import type { PipelineSnapshot } from '../sync/pipelineController';

export const speechSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const hapticsSupported = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export function speak(text: string): void {
  if (!speechSupported() || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.lang = 'en-US';
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

/**
 * Optional non-visual feedback on each newly analyzed frame:
 *  - haptics: a vibration whose length follows the frame's rhythmic activity (devices with vibration support)
 *  - narration: reads the frame description aloud when the user steps frames while paused
 */
export function useAccessibilityFeedback(snap: PipelineSnapshot): void {
  const last = useRef<string | null>(null);
  const key = snap.analysis ? `${snap.selectedId}:${snap.analysis.frameIndex}` : null;
  useEffect(() => {
    if (!key || key === last.current) return;
    last.current = key;
    const p = snap.params;
    if (snap.prefs.haptics && hapticsSupported() && p) {
      const pulse = Math.round(15 + 120 * p.rhythmicActivity);
      navigator.vibrate(p.ticks.length > 0 ? [pulse, 60, Math.round(pulse / 2)] : [pulse]);
    }
    if (snap.prefs.narrate && !snap.player.isPlaying) speak(snap.description);
  }, [key, snap.params, snap.prefs.haptics, snap.prefs.narrate, snap.player.isPlaying, snap.description]);
}
