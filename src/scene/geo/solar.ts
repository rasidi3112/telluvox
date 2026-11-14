/**
 * Sub-solar point (where the Sun is directly overhead) for a given instant,
 * using the NOAA general solar position approximation (accuracy ≈ 0.1° in
 * declination, ≈ 1 min in the equation of time). Used to light the globe with
 * the real day/night terminator for the current UTC time.
 */

export interface SubsolarPoint {
  lat: number;
  lon: number;
  declinationDeg: number;
  equationOfTimeMin: number;
}

export function subsolarPoint(date: Date): SubsolarPoint {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86400000) + 1;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const year = date.getUTCFullYear();
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  const g = ((2 * Math.PI) / daysInYear) * (dayOfYear - 1 + (hours - 12) / 24);

  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  let lon = -15 * (hours - 12 + eqTime / 60);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const declDeg = (decl * 180) / Math.PI;
  return { lat: declDeg, lon, declinationDeg: declDeg, equationOfTimeMin: eqTime };
}
