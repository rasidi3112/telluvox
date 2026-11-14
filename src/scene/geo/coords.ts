/**
 * Geographic ↔ 3D conversions that match THREE.SphereGeometry's UV layout,
 * so an equirectangular texture (lon −180° at the left edge, lat +90° at the
 * top) lands on the correct place on the sphere. Verified in
 * tests/geo.test.ts against SphereGeometry's own vertices.
 */

const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

/** Position on a sphere of radius r for latitude/longitude in degrees. */
export function latLonToVector3(latDeg: number, lonDeg: number, r = 1): Vec3 {
  const phi = ((lonDeg + 180) / 360) * 2 * Math.PI;
  const theta = (90 - latDeg) * DEG;
  return [-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta)];
}

/** Inverse of latLonToVector3. Longitude in (−180, 180]. */
export function vector3ToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const r = Math.hypot(x, y, z) || 1;
  const lat = 90 - Math.acos(Math.min(1, Math.max(-1, y / r))) / DEG;
  let lon = Math.atan2(z, -x) / DEG - 180;
  if (lon <= -180) lon += 360;
  return { lat, lon };
}

/** Equirectangular image pixel (x right, y down) → lat/lon of the pixel centre. */
export function equirectPixelToLatLon(px: number, py: number, width: number, height: number): { lat: number; lon: number } {
  return { lon: ((px + 0.5) / width) * 360 - 180, lat: 90 - ((py + 0.5) / height) * 180 };
}

/** Normalized (0..1) equirectangular coordinates → lat/lon. */
export function equirectUvToLatLon(u: number, v: number): { lat: number; lon: number } {
  return { lon: u * 360 - 180, lat: 90 - v * 180 };
}

/** Rotation about +Y that turns the given longitude to face the +Z axis (the default camera side). */
export function rotationToFaceLongitude(lonDeg: number): number {
  const phi = ((lonDeg + 180) / 360) * 2 * Math.PI;
  return Math.PI / 2 - phi;
}

export function formatLatLon(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la}, ${lo}`;
}
