/**
 * Pure daylight/twilight factors derived from real solar elevation (spec §19,
 * task 2/3: "twilight color gradient by elevation", season-aware, not a fake
 * hour-angle arc). No three.js — `viewer/app/studio/environment.ts` turns these
 * numbers into THREE.Color/light-intensity values.
 *
 * The three factors below reuse the exact smoothstep thresholds the previous
 * `daylightAt(hour)` sinusoid used (ambience-math.ts:4-17, left untouched), just
 * driven by `sin(elevation)` from the real NOAA sun instead of a fake arc, so
 * the tuned look (sunset warmth, night threshold, etc.) carries over unchanged
 * — only the *timing/seasonality* of when those looks occur is now correct.
 */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hermite smoothstep, equivalent to THREE.MathUtils.smoothstep (kept local so
 * this file has no three.js dependency). */
export function smoothstep(x: number, edge0: number, edge1: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export type DaylightFactors = {
  /** 0 = fully night, 1 = fully day (sun uniforms/lights should blend on this). */
  daylight: number;
  /** 0 = fully day, 1 = fully night (stars, moon). */
  night: number;
  /** 0 = midday white light, 1 = horizon-hugging golden/red twilight tint. */
  warmth: number;
  /** 0 elsewhere, peaks just after sunset / before sunrise: the deep-blue band
   * between "warm horizon" and "full night" (civil-to-nautical twilight). */
  blueHour: number;
};

/** Daylight/night/warmth/blue-hour blend factors for a given apparent solar
 * elevation (degrees, refraction-corrected — see engine/env/sun.ts). */
export function daylightFactors(elevationDeg: number): DaylightFactors {
  const sinElevation = Math.sin(elevationDeg * (Math.PI / 180));
  const daylight = smoothstep(sinElevation, -0.12, 0.22);
  const night = 1 - smoothstep(sinElevation, -0.2, 0.06);
  const warmth = 1 - smoothstep(sinElevation, 0.02, 0.55);
  // Deep blue band: below the horizon but before full night (~ -6 to -1 elevation).
  const blueHour = smoothstep(elevationDeg, -8, -3) * (1 - smoothstep(elevationDeg, -3, 1));
  return { daylight, night, warmth, blueHour };
}
