/**
 * Accurate Earth globe.
 *
 *  - Coastlines and land: Natural Earth 1:50m (public domain), projected
 *    equirectangularly onto SphereGeometry UVs (verified in tests/geo.test.ts).
 *  - Lighting: the real sub-solar point for the given UTC time, in Earth-fixed
 *    coordinates, so the day/night terminator is where it really is.
 *  - Optional frame overlay: only for frames declared as global
 *    equirectangular maps (−180…180° lon, 90…−90° lat).
 *  - Optional marker at a lat/lon (used by the image explorer).
 *
 * No imagery, clouds, elevation or city lights are invented.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getRuntime } from '../app/runtime';
import { latLonToVector3, rotationToFaceLongitude } from './geo/coords';
import { buildEarthTextures } from './geo/earthTexture';
import { subsolarPoint } from './geo/solar';

const globeVertex = /* glsl */ `
  uniform vec3 uSunObj;
  varying vec2 vUv;
  varying vec3 vNormalObj;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying vec3 vSunView;
  void main() {
    vUv = uv;
    vNormalObj = normalize(position);
    vNormalView = normalize(normalMatrix * normal);
    vSunView = normalize(normalMatrix * uSunObj);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const globeFragment = /* glsl */ `
  uniform sampler2D uBase;
  uniform sampler2D uLines;
  uniform sampler2D uOverlay;
  uniform float uOverlayOpacity;
  uniform float uDayNight;
  uniform float uReady;
  uniform vec3 uSunObj;
  uniform float uPulse;
  uniform vec3 uMarker;
  uniform float uMarkerOn;
  varying vec2 vUv;
  varying vec3 vNormalObj;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying vec3 vSunView;

  void main() {
    vec3 base = mix(vec3(0.04, 0.145, 0.25), texture2D(uBase, vUv).rgb, uReady);
    vec2 ln = texture2D(uLines, vUv).rg * uReady;
    float ink = ln.r;
    float land = ln.g;

    vec3 n = normalize(vNormalObj);
    float ndl = dot(n, normalize(uSunObj));
    float dayF = smoothstep(-0.1, 0.1, ndl); // soft terminator (~6° twilight band)

    // Day side: Lambert-ish; night side: very dim. With day/night off: even light.
    vec3 dayCol = base * (0.42 + 0.7 * max(ndl, 0.0));
    vec3 nightCol = base * 0.3 + vec3(0.004, 0.009, 0.022);
    vec3 col = mix(base * 0.95, mix(nightCol, dayCol, dayF), uDayNight);

    // Frame overlay (unlit so data colours stay faithful)
    vec3 ov = texture2D(uOverlay, vUv).rgb;
    col = mix(col, ov, uOverlayOpacity);

    // Coastline and graticule ink
    float inkLight = mix(1.0, mix(0.6, 1.0, dayF), uDayNight);
    col = mix(col, vec3(0.80, 0.90, 0.96), clamp(ink, 0.0, 1.0) * 0.8 * inkLight);

    vec3 nv = normalize(vNormalView);
    vec3 vdir = normalize(-vViewPos);
    // Ocean sun glint
    vec3 h = normalize(normalize(vSunView) + vdir);
    float spec = pow(max(dot(nv, h), 0.0), 70.0) * (1.0 - land) * dayF * uDayNight * (1.0 - uOverlayOpacity);
    col += vec3(0.6, 0.75, 0.9) * spec * 0.4;

    // Thin inner atmosphere
    float fres = pow(1.0 - max(dot(nv, vdir), 0.0), 3.0);
    col += vec3(0.30, 0.55, 0.95) * fres * mix(0.3, 0.08 + 0.6 * dayF, uDayNight) * (1.0 + uPulse * 0.8);

    // Marker (amber ring + dot)
    if (uMarkerOn > 0.5) {
      float d = distance(n, normalize(uMarker));
      float ring = smoothstep(0.036, 0.031, d) - smoothstep(0.024, 0.019, d);
      float dotm = smoothstep(0.009, 0.006, d);
      col = mix(col, vec3(1.0, 0.82, 0.35), clamp(ring + dotm, 0.0, 1.0));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const atmoVertex = /* glsl */ `
  uniform vec3 uSunObj;
  varying vec3 vNormalView;
  varying vec3 vSunView;
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    vSunView = normalize(normalMatrix * uSunObj);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmoFragment = /* glsl */ `
  uniform float uPulse;
  uniform float uDayNight;
  varying vec3 vNormalView;
  varying vec3 vSunView;
  void main() {
    vec3 n = normalize(vNormalView);
    float rim = pow(clamp(0.66 - dot(n, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.2);
    float sun = mix(1.0, clamp(dot(n, normalize(vSunView)) * 0.6 + 0.55, 0.12, 1.0), uDayNight);
    vec3 c = vec3(0.32, 0.58, 0.95);
    gl_FragColor = vec4(c, 1.0) * rim * sun * (0.55 + uPulse * 0.6);
  }
`;

export interface GlobeMarker {
  lat: number;
  lon: number;
}

export interface EarthGlobeProps {
  overlay: CanvasImageSource | null;
  overlayOpacity: number;
  dayNight: boolean;
  date: Date;
  marker: GlobeMarker | null;
  /** Longitude to turn towards the viewer (animated). null = free/auto-rotate. */
  focusLon: number | null;
  autoRotate: boolean;
  onReady?: () => void;
}

const blank = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

export function EarthGlobe({ overlay, overlayOpacity, dayNight, date, marker, focusLon, autoRotate, onReady }: EarthGlobeProps) {
  const spin = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const [ready, setReady] = useState(false);
  const sun = useMemo(() => {
    const p = subsolarPoint(date);
    return new THREE.Vector3(...latLonToVector3(p.lat, p.lon));
  }, [date]);

  // useState (not useMemo) so the uniform objects keep a single identity for the
  // material and every effect, including across StrictMode re-mounts.
  const [uniforms] = useState(
    () => ({
      uBase: { value: blank as THREE.Texture },
      uLines: { value: blank as THREE.Texture },
      uOverlay: { value: blank as THREE.Texture },
      uOverlayOpacity: { value: 0 },
      uDayNight: { value: 1 },
      uReady: { value: 0 },
      uSunObj: { value: new THREE.Vector3(1, 0, 0) },
      uPulse: { value: 0 },
      uMarker: { value: new THREE.Vector3(0, 0, 1) },
      uMarkerOn: { value: 0 },
    }),
  );
  const [atmoUniforms] = useState(() => ({
    uPulse: { value: 0 },
    uDayNight: { value: 1 },
    uSunObj: { value: new THREE.Vector3(1, 0, 0) },
  }));
  // R3F copies the uniforms prop into the material's own uniform objects, so all
  // runtime writes must go through the material (not the initial objects above).
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const atmoRef = useRef<THREE.ShaderMaterial>(null);
  const U = () => (matRef.current?.uniforms ?? uniforms) as typeof uniforms;
  const A = () => (atmoRef.current?.uniforms ?? atmoUniforms) as typeof atmoUniforms;

  // Build coastline textures once (size depends on screen + GPU limits).
  useEffect(() => {
    let cancelled = false;
    const maxTex = gl.capabilities.maxTextureSize;
    const width = Math.min(maxTex, Math.max(size.width, size.height) * (window.devicePixelRatio || 1) > 900 ? 4096 : 2048);
    let baseTex: THREE.CanvasTexture | null = null;
    let lineTex: THREE.DataTexture | null = null;
    buildEarthTextures(width)
      .then((t) => {
        if (cancelled) return;
        baseTex = new THREE.CanvasTexture(t.base);
        baseTex.colorSpace = THREE.NoColorSpace;
        baseTex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        baseTex.needsUpdate = true;
        lineTex = new THREE.DataTexture(t.lines, t.width, t.height, THREE.RGFormat, THREE.UnsignedByteType);
        lineTex.flipY = false;
        lineTex.generateMipmaps = true;
        lineTex.minFilter = THREE.LinearMipmapLinearFilter;
        lineTex.magFilter = THREE.LinearFilter;
        lineTex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        lineTex.needsUpdate = true;
        U().uBase.value = baseTex;
        U().uLines.value = lineTex;
        U().uReady.value = 1;
        setReady(true);
        onReady?.();
      })
      .catch((e) => console.warn('[TELLUVOX] coastline texture failed:', e));
    return () => {
      cancelled = true;
      baseTex?.dispose();
      lineTex?.dispose();
    };
    // Texture size is chosen once per mount.
  }, [gl, uniforms]);

  // Frame overlay texture
  useEffect(() => {
    if (!overlay) {
      U().uOverlay.value = blank;
      return;
    }
    const t = new THREE.Texture(overlay as HTMLImageElement);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    U().uOverlay.value = t;
    return () => t.dispose();
  }, [overlay, uniforms]);

  useEffect(() => {
    U().uSunObj.value.copy(sun);
    A().uSunObj.value.copy(sun);
  }, [sun, uniforms, atmoUniforms]);

  useEffect(() => {
    U().uMarkerOn.value = marker ? 1 : 0;
    if (marker) U().uMarker.value.set(...latLonToVector3(marker.lat, marker.lon));
  }, [marker, uniforms]);

  useFrame((_, delta) => {
    const g = spin.current;
    if (g) {
      if (focusLon !== null) {
        const target = rotationToFaceLongitude(focusLon);
        let d = target - g.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest path
        g.rotation.y += d * Math.min(1, delta * 4);
      } else if (autoRotate) {
        g.rotation.y += delta * 0.035;
      }
    }
    const opacity = overlay ? overlayOpacity : 0;
    U().uOverlayOpacity.value += (opacity - U().uOverlayOpacity.value) * Math.min(1, delta * 6);
    const dn = dayNight ? 1 : 0;
    U().uDayNight.value += (dn - U().uDayNight.value) * Math.min(1, delta * 4);
    A().uDayNight.value = U().uDayNight.value;

    // Atmosphere responds to the actual audio output level (0 when silent).
    const { engine } = getRuntime();
    const analyser = engine.getAnalyser();
    let target = 0;
    if (analyser && engine.isRunning()) {
      const buf = pulseBuf.current;
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += (buf[i] ?? 0) * (buf[i] ?? 0);
      target = Math.min(1, Math.sqrt(s / buf.length) * 5);
    }
    const p = U().uPulse.value + (target - U().uPulse.value) * Math.min(1, delta * 6);
    U().uPulse.value = p;
    A().uPulse.value = p;
  });
  const pulseBuf = useRef(new Float32Array(1024));

  // Initial orientation: put the morning terminator slightly left of centre.
  const initialRotation = useMemo(() => {
    const p = subsolarPoint(date);
    return rotationToFaceLongitude(focusLon ?? p.lon - 40);
  }, []);

  return (
    <group ref={spin} rotation={[0, initialRotation, 0]} name={ready ? 'globe-ready' : 'globe-loading'}>
      <mesh>
        <sphereGeometry args={[1, 128, 64]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={globeVertex}
          fragmentShader={globeFragment}
          uniforms={uniforms}
        />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[1, 64, 32]} />
        <shaderMaterial
          ref={atmoRef}
          vertexShader={atmoVertex}
          fragmentShader={atmoFragment}
          uniforms={atmoUniforms}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
