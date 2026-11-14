import { OrbitControls, Stars } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { usePrefersReducedMotion } from '../hooks/usePipeline';
import { EarthGlobe, type GlobeMarker } from './EarthGlobe';
import { SceneErrorBoundary, isWebGLAvailable } from './SceneErrorBoundary';

export interface EarthSceneProps {
  /** Equirectangular frame to drape on the globe (only for georeferenced frames). */
  overlay?: CanvasImageSource | null;
  overlayOpacity?: number;
  dayNight?: boolean;
  marker?: GlobeMarker | null;
  focusLon?: number | null;
  interactive?: boolean;
  label?: string;
  /** Extra space around the globe (1 = tight). */
  padding?: number;
  /** Zoom factor (1 = whole globe in view). Changing it re-fits the camera. */
  zoom?: number;
  /** Incrementing this resets the camera orientation. */
  resetKey?: number;
  onReady?: () => void;
}

const FOV = 35;

function CameraFit({ padding, zoom, resetKey }: { padding: number; zoom: number; resetKey: number }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  useEffect(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const r = 1.06 * padding;
    const dist = (r / (t * Math.min(1, aspect)) + 0.2) / zoom;
    // Slightly above the equator so the northern mid-latitudes read well.
    const elev = THREE.MathUtils.degToRad(14);
    camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [camera, controls, size.width, size.height, padding, zoom, resetKey]);
  return null;
}

function Fallback({ reason }: { reason: string }) {
  return (
    <div className="scene-fallback" role="note">
      {reason} The globe is optional; the visualization, analysis and sound work without it.
    </div>
  );
}

/** Current time, refreshed every minute, for the day/night terminator. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function EarthScene({
  overlay = null,
  overlayOpacity = 0.85,
  dayNight = true,
  marker = null,
  focusLon = null,
  interactive = true,
  label = 'Interactive 3D Earth globe with Natural Earth coastlines',
  padding = 1.18,
  zoom = 1,
  resetKey = 0,
  onReady,
}: EarthSceneProps) {
  const reducedMotion = usePrefersReducedMotion();
  const now = useMinuteClock();
  if (!isWebGLAvailable()) return <Fallback reason="WebGL is not available in this browser." />;

  return (
    <SceneErrorBoundary fallback={<Fallback reason="The 3D globe could not be initialized." />}>
      <div className="scene-wrap" role="img" aria-label={label}>
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0.5, 4], fov: FOV, near: 0.1, far: 200 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <Stars radius={80} depth={20} count={900} factor={1.8} saturation={0} fade speed={0} />
          <EarthGlobe
            overlay={overlay}
            overlayOpacity={overlayOpacity}
            dayNight={dayNight}
            date={now}
            marker={marker}
            focusLon={focusLon}
            autoRotate={!reducedMotion}
            onReady={onReady}
          />
          {interactive && (
            <OrbitControls makeDefault enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} rotateSpeed={0.55} />
          )}
          <CameraFit padding={padding} zoom={zoom} resetKey={resetKey} />
        </Canvas>
      </div>
    </SceneErrorBoundary>
  );
}
