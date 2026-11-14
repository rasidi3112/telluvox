import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  equirectPixelToLatLon,
  latLonToVector3,
  rotationToFaceLongitude,
  vector3ToLatLon,
} from '../src/scene/geo/coords';
import { subsolarPoint } from '../src/scene/geo/solar';

describe('latLonToVector3 matches THREE.SphereGeometry UV layout', () => {
  it('agrees with every vertex of a SphereGeometry', () => {
    const g = new THREE.SphereGeometry(1, 36, 18);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      // Equirectangular texture: u=0 → lon −180, uv.y=1 → lat +90
      const lon = uv.getX(i) * 360 - 180;
      const lat = uv.getY(i) * 180 - 90;
      const [x, y, z] = latLonToVector3(lat, lon, 1);
      expect(x).toBeCloseTo(pos.getX(i), 6);
      expect(y).toBeCloseTo(pos.getY(i), 6);
      expect(z).toBeCloseTo(pos.getZ(i), 6);
    }
  });

  it('puts the north pole on +Y and is not mirrored (east is to the right when facing a point)', () => {
    const [, y] = latLonToVector3(90, 0);
    expect(y).toBeCloseTo(1);
    // Face longitude 0 towards +Z, then 10°E must appear on +X (right of centre)
    const a = rotationToFaceLongitude(0);
    const rot = new THREE.Matrix4().makeRotationY(a);
    const centre = new THREE.Vector3(...latLonToVector3(0, 0)).applyMatrix4(rot);
    const east = new THREE.Vector3(...latLonToVector3(0, 10)).applyMatrix4(rot);
    expect(centre.z).toBeCloseTo(1, 6);
    expect(centre.x).toBeCloseTo(0, 6);
    expect(east.x).toBeGreaterThan(0);
  });

  it('rotationToFaceLongitude works for arbitrary longitudes', () => {
    for (const lon of [-170, -90, -45, 0, 33, 106.8, 179]) {
      const v = new THREE.Vector3(...latLonToVector3(0, lon)).applyMatrix4(new THREE.Matrix4().makeRotationY(rotationToFaceLongitude(lon)));
      expect(v.z).toBeCloseTo(1, 6);
    }
  });

  it('round-trips through vector3ToLatLon', () => {
    for (const [lat, lon] of [[-6.2, 106.8], [51.5, -0.13], [-33.9, 151.2], [64.1, -21.9], [0, 179.5]] as const) {
      const r = vector3ToLatLon(...latLonToVector3(lat, lon));
      expect(r.lat).toBeCloseTo(lat, 6);
      expect(r.lon).toBeCloseTo(lon, 6);
    }
  });

  it('maps equirectangular pixels to lat/lon', () => {
    expect(equirectPixelToLatLon(0, 0, 360, 180)).toEqual({ lon: -179.5, lat: 89.5 });
    expect(equirectPixelToLatLon(359, 179, 360, 180)).toEqual({ lon: 179.5, lat: -89.5 });
  });
});

describe('subsolarPoint', () => {
  it('is on the equator at the March 2024 equinox', () => {
    expect(Math.abs(subsolarPoint(new Date('2024-03-20T03:06:00Z')).lat)).toBeLessThan(0.3);
  });
  it('is on the Tropic of Cancer at the June 2024 solstice', () => {
    expect(subsolarPoint(new Date('2024-06-20T20:51:00Z')).lat).toBeCloseTo(23.44, 0);
  });
  it('is on the Tropic of Capricorn at the December 2024 solstice', () => {
    expect(subsolarPoint(new Date('2024-12-21T09:20:00Z')).lat).toBeCloseTo(-23.44, 0);
  });
  it('accounts for the equation of time (sun east of Greenwich at 12:00 UTC in February)', () => {
    const p = subsolarPoint(new Date('2024-02-11T12:00:00Z'));
    expect(p.equationOfTimeMin).toBeCloseTo(-14.2, 0);
    expect(p.lon).toBeCloseTo(3.55, 0);
  });
  it('moves 15° west per hour', () => {
    const a = subsolarPoint(new Date('2024-05-01T06:00:00Z'));
    const b = subsolarPoint(new Date('2024-05-01T07:00:00Z'));
    expect(a.lon - b.lon).toBeCloseTo(15, 0);
  });
});
