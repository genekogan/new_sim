/**
 * Solar position for Bombay Beach, CA (spec §19; see docs/engineering/RESEARCH.md #12
 * for the cited NOAA GML formulas this implements — the classic NOAA Solar Calculator
 * spreadsheet method, Meeus/Spencer Fourier approximations, accurate to roughly
 * 0.01-0.1 deg and sunrise/sunset within about a minute for |lat| <= 72).
 *
 * Pure TS: no three.js, no DOM, no Date.now(), no Math.random(). All calendar math
 * (day-of-year, weekday, US DST since 2007) is done with plain integer arithmetic
 * instead of the built-in Date object, so results are identical across Node, the
 * browser and the Durable Object regardless of host timezone.
 *
 * Input is a *local* ISO datetime at the campus, e.g. "2026-03-15T16:00" or
 * "2026-03-15T16:00:00" (matches `Environment.datetime` in world/types.ts — no
 * trailing offset/Z; it is always interpreted as Bombay Beach local time).
 */

import { dacos, datan, datan2, dcos, dsin, dtan } from '../core/math.ts';

export const BOMBAY_BEACH = { lat: 33.3506, lon: -115.7295 };

/** Default calendar date used by the studio when no date is supplied (spec §19
 * asks for "a plausible season date"): mid-March, matching the sunrise/sunset
 * reference case in RESEARCH.md #12. `world/factory.ts`'s emptyWorld() picks
 * 2026-03-01 for the same reason, independently — both are early-season 2026
 * defaults and do not need to match exactly. */
export const DEFAULT_SCENE_DATE = '2026-03-15';

/**
 * North axis — established (Gene, OWNER_FEEDBACK_2026-09-28 §15; OWNER_DECISIONS 2026-09-29 "North bearing").
 * Gene: the long axis of the 2020 tire ring (world X, app/studio-2020/scene.ts) runs north–south. The sign
 * comes from the March 4 2020 aerial DJI_0079 (EXIF 2020-03-04 10:10:34 PST, FlightYawDegree +99.4, i.e. the
 * camera faces ~east). The 2020 scene is laid out as that photo sees it (Portal → container → canopy →
 * Forest runs left→right = +X; the geodesic sphere, z = +17, is nearest the camera; the RV camp, z ≈ −50,
 * is far), so the camera looks along −Z with +X on its right. solarPosition() gives azimuth 143°,
 * elevation 43° at that instant; shadows therefore fall toward 323° (NW) = behind-left of an east-facing
 * camera, which is what the photo shows (the sphere's and the Forest racks' shadows fall left and slightly
 * toward the camera). Hence **world −X is geographic north**, **−Z is east**, **+X is south**, **+Z is
 * west**. `NORTH_AZIMUTH_OFFSET` (degrees, added to the compass azimuth before projecting to x/z with
 * x = sin, z = −cos) is −90: azimuth 0 → −X, 90 → −Z. It is ONE global constant, exact for the 2020 scene;
 * the other year frames were measured against drone stills (QUESTIONS_FOR_GENE Q3 note, W42): the 2026 CAD's
 * north is ≈ −X turned 33° toward −Z (≈ −57° here), the 2025 Kit's ≈ −Z (0°), the 2022 Kit is mirrored and
 * the 2024 Kit's kitchen / RV ring sit on the wrong side of Chiba. A per-year bearing is an open follow-up.
 */
export const NORTH_AZIMUTH_OFFSET = -90;

/**
 * Per-year site bearing (degrees, same convention as NORTH_AZIMUTH_OFFSET) for the year scenes whose frame was
 * measured separately; a year not listed uses the global (exact for 2020; the others are unmeasured: Q22).
 * - 2022 = −101 (W51, RECONCILIATION_2022 §f): DJI_0829 turned north-up by its logged FlightYaw 110.2° shows the
 *   houses' long walls and panel rows at bearings 95–103° (five picks, mean 100.4°; W49 read 10–12° clockwise of E–W),
 *   i.e. world −Z (Huaqiangbei's long axis) points ≈ 101° and north is world −X turned 11° toward +Z. ±5° (FlightYaw,
 *   not GimbalYaw; pitch −86.4°; picks by eye). Gene's estimate ("8 o'clock") would be −120.
 * The year files carry it (`northAzimuthOffset`, deploy/history-scenes.mjs); the camera reads the scene's value.
 */
export const YEAR_NORTH_AZIMUTH_OFFSET: Readonly<Partial<Record<number, number>>> = { 2022: -101 };
/** The site bearing of a scene (its `meta.northAzimuthOffset` / file field), else the global. */
export const northAzimuthOffsetOf = (s?: object | null): number => {
  const o = s as { northAzimuthOffset?: number; meta?: { northAzimuthOffset?: number } } | null | undefined;
  return o?.northAzimuthOffset ?? o?.meta?.northAzimuthOffset ?? NORTH_AZIMUTH_OFFSET;
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Calendar math (no Date object; see file header).
// ---------------------------------------------------------------------------

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 1-based day-of-year for a civil date. */
function dayOfYear(y: number, m: number, d: number): number {
  let doy = d;
  for (let i = 0; i < m - 1; i++)
    doy += MONTH_DAYS[i] + (i === 1 && isLeapYear(y) ? 1 : 0);
  return doy;
}

/** Julian Day Number for a proleptic-Gregorian civil date, referenced to noon UT
 * (Fliegel & Van Flandern). Used only to derive day-of-week for the DST rule below;
 * `julianDayNumber(2000,1,1) === 2451545`, a Saturday. */
function julianDayNumber(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * m2 + 2) / 5) +
    365 * y2 +
    Math.floor(y2 / 4) -
    Math.floor(y2 / 100) +
    Math.floor(y2 / 400) -
    32045
  );
}

/** 0 = Sunday .. 6 = Saturday. */
function dayOfWeek(y: number, m: number, d: number): number {
  return (((julianDayNumber(y, m, d) + 1) % 7) + 7) % 7;
}

/** Calendar day of the n-th occurrence of `weekday` (0=Sun..6=Sat) in a month. */
function nthWeekdayOfMonth(y: number, m: number, weekday: number, n: number): number {
  const firstDow = dayOfWeek(y, m, 1);
  const firstOccurrence = 1 + ((weekday - firstDow + 7) % 7);
  return firstOccurrence + (n - 1) * 7;
}

/**
 * UTC offset (hours, negative west of Greenwich) for America/Los_Angeles at a given
 * *local* wall-clock instant, using the US DST rule in force since 2007: starts the
 * second Sunday of March at 02:00 local standard time, ends the first Sunday of
 * November at 02:00 local daylight time. Not valid for years before 2007 (the US
 * rule differed) — Mars College's 2020-2026 dates are all comfortably after that.
 *
 * The single ambiguous/skipped hour at each transition (02:00-02:59 does not exist
 * in spring; 01:00-01:59 occurs twice in fall) is resolved by comparing only against
 * the 02:00 boundary: hour < 2 on the transition day counts as still in the
 * previous regime. This is a documented simplification of a genuinely ambiguous
 * hour, not a source of meaningful lighting error.
 */
export function losAngelesUtcOffsetHours(
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  const dstStartDay = nthWeekdayOfMonth(year, 3, 0, 2);
  const dstEndDay = nthWeekdayOfMonth(year, 11, 0, 1);
  const beforeSpringForward =
    month < 3 || (month === 3 && (day < dstStartDay || (day === dstStartDay && hour < 2)));
  const afterFallBack =
    month > 11 || (month === 11 && (day > dstEndDay || (day === dstEndDay && hour >= 2)));
  return beforeSpringForward || afterFallBack ? -8 : -7;
}

export type LocalDateTime = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
};

/** Parse "YYYY-MM-DDTHH:MM[:SS]" (or a date-only "YYYY-MM-DD") as a naive local
 * datetime — no timezone is read from the string; it is always Bombay Beach local. */
export function parseLocalDateTime(iso: string): LocalDateTime {
  const [datePart, timePart] = iso.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = (timePart ?? '').split(':').map(Number);
  return { year, month, day, hour: hh, minute: mm, second: ss };
}

/** Format a local calendar date + minutes-of-day as "YYYY-MM-DDTHH:MM:SS". Minutes
 * outside [0, 1440) roll the calendar date forward/back (sunrise/noon/sunset never
 * cross midnight at this latitude, but this keeps the function honest). */
function formatLocalDateTime(year: number, month: number, day: number, minutesOfDay: number): string {
  const dayShift = Math.floor(minutesOfDay / 1440);
  const m = ((minutesOfDay % 1440) + 1440) % 1440;
  let y = year, mo = month, d = day + dayShift;
  while (d < 1) {
    mo -= 1;
    if (mo < 1) { mo = 12; y -= 1; }
    d += MONTH_DAYS[mo - 1] + (mo === 2 && isLeapYear(y) ? 1 : 0);
  }
  for (;;) {
    const lastDay = MONTH_DAYS[mo - 1] + (mo === 2 && isLeapYear(y) ? 1 : 0);
    if (d <= lastDay) break;
    d -= lastDay;
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  const hh = Math.floor(m / 60), mm = Math.floor(m % 60), ss = Math.round((m % 1) * 60);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

// ---------------------------------------------------------------------------
// NOAA / Spencer solar ephemeris (day-angle gamma, equation of time, declination).
// Same structure as the NOAA Solar Calculator spreadsheet: local calendar
// date/time in, with the local UTC offset folded into `time_offset` — no
// separate UTC date conversion is needed (RESEARCH.md #12).
// ---------------------------------------------------------------------------

type Ephemeris = { eqtimeMin: number; declRad: number };

function ephemerisAt(year: number, month: number, day: number, hourDecimal: number): Ephemeris {
  const doy = dayOfYear(year, month, day);
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const gamma = ((2 * Math.PI) / daysInYear) * (doy - 1 + (hourDecimal - 12) / 24);
  const g2 = 2 * gamma, g3 = 3 * gamma;
  const eqtimeMin =
    229.18 *
    (0.000075 +
      0.001868 * dcos(gamma) -
      0.032077 * dsin(gamma) -
      0.014615 * dcos(g2) -
      0.040849 * dsin(g2));
  const declRad =
    0.006918 -
    0.399912 * dcos(gamma) +
    0.070257 * dsin(gamma) -
    0.006758 * dcos(g2) +
    0.000907 * dsin(g2) -
    0.002697 * dcos(g3) +
    0.00148 * dsin(g3);
  return { eqtimeMin, declRad };
}

/** Atmospheric refraction correction (degrees) for a *true* (geometric) elevation,
 * added to get the apparent elevation the eye/camera would see. Meeus's standard
 * piecewise approximation (arcminutes-ish near the horizon, negligible above ~20deg). */
function refractionCorrectionDeg(trueElevationDeg: number): number {
  if (trueElevationDeg > 85) return 0;
  const te = dtan(trueElevationDeg * DEG2RAD);
  let arcsec: number;
  if (trueElevationDeg > 5) {
    arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  } else if (trueElevationDeg > -0.575) {
    arcsec =
      1735 +
      trueElevationDeg *
        (-518.2 + trueElevationDeg * (103.4 + trueElevationDeg * (-12.79 + trueElevationDeg * 0.711)));
  } else {
    arcsec = -20.774 / te;
  }
  return arcsec / 3600;
}

export type SolarPosition = {
  /** Apparent (refraction-corrected) elevation above the horizon, degrees. */
  elevationDeg: number;
  /** Geometric elevation, no refraction — for reference/debugging. */
  trueElevationDeg: number;
  /** Azimuth, degrees clockwise from north. */
  azimuthDeg: number;
  /** Unit vector from a ground point toward the sun, studio frame (y up; x, z
   * as in NORTH_AZIMUTH_OFFSET above: −X north, −Z east). */
  direction: [number, number, number];
};

/** Solar position at a local Bombay Beach datetime (spec §19, task 1). */
export function solarPosition(
  localIso: string,
  lat = BOMBAY_BEACH.lat,
  lon = BOMBAY_BEACH.lon,
  /** The scene's site bearing (YEAR_NORTH_AZIMUTH_OFFSET / northAzimuthOffsetOf); only `direction` depends on it. */
  northOffset = NORTH_AZIMUTH_OFFSET,
): SolarPosition {
  const t = parseLocalDateTime(localIso);
  const hourDecimal = t.hour + t.minute / 60 + t.second / 3600;
  const tz = losAngelesUtcOffsetHours(t.year, t.month, t.day, t.hour);
  const { eqtimeMin, declRad } = ephemerisAt(t.year, t.month, t.day, hourDecimal);
  const timeOffsetMin = eqtimeMin + 4 * lon - 60 * tz;
  const tstMin = hourDecimal * 60 + timeOffsetMin;
  const haDeg = tstMin / 4 - 180;
  const haRad = haDeg * DEG2RAD;
  const latRad = lat * DEG2RAD;
  const cosZen = clamp(
    dsin(latRad) * dsin(declRad) + dcos(latRad) * dcos(declRad) * dcos(haRad),
    -1,
    1,
  );
  const zenithDeg = dacos(cosZen) * RAD2DEG;
  const trueElevationDeg = 90 - zenithDeg;
  const sinZen = Math.sqrt(Math.max(0, 1 - cosZen * cosZen));
  let azimuthDeg: number;
  if (sinZen < 1e-6) {
    azimuthDeg = 180; // sun at/near the zenith or nadir: azimuth undefined, pick a stable value
  } else {
    // Standard NOAA form (solareqns.PDF): x = (sin(lat)cos(zen) - sin(decl)) /
    // (cos(lat)sin(zen)); az = 180 +/- acos(x), sign by the hour-angle side.
    // (RESEARCH.md's "cos(180-az) = -(...)" is the same identity with az on the
    // other side of the equation; this is the form actually used by the NOAA
    // spreadsheet and is the one verified against hand-computed spherical
    // astronomy below in env-sun.test.ts.)
    const x = clamp(
      (dsin(latRad) * cosZen - dsin(declRad)) / (dcos(latRad) * sinZen),
      -1,
      1,
    );
    const acosDeg = dacos(x) * RAD2DEG;
    azimuthDeg = haDeg > 0 ? 180 + acosDeg : 180 - acosDeg;
  }
  azimuthDeg = ((azimuthDeg % 360) + 360) % 360;
  const elevationDeg = trueElevationDeg + refractionCorrectionDeg(trueElevationDeg);
  return {
    elevationDeg,
    trueElevationDeg,
    azimuthDeg,
    direction: sunDirectionVector(elevationDeg, azimuthDeg, northOffset),
  };
}

export type SunTimes = {
  sunriseLocal: string | null; // null = no sunrise this day (polar day/night; never happens at 33.35N)
  sunsetLocal: string | null;
  solarNoonLocal: string;
};

/** Sunrise, solar noon and sunset for a local calendar date (spec §19, task 1). */
export function sunTimes(
  localIso: string,
  lat = BOMBAY_BEACH.lat,
  lon = BOMBAY_BEACH.lon,
): SunTimes {
  const t = parseLocalDateTime(localIso);
  const tz = losAngelesUtcOffsetHours(t.year, t.month, t.day, 12);
  const { eqtimeMin, declRad } = ephemerisAt(t.year, t.month, t.day, 12);
  const latRad = lat * DEG2RAD;
  const solarNoonMin = 720 - 4 * lon - eqtimeMin + 60 * tz;
  const cosHa0 =
    dcos(90.833 * DEG2RAD) / (dcos(latRad) * dcos(declRad)) -
    dtan(latRad) * dtan(declRad);
  const solarNoonLocal = formatLocalDateTime(t.year, t.month, t.day, solarNoonMin);
  if (cosHa0 < -1 || cosHa0 > 1) {
    // |cosHa0| > 1: the sun never sets (>1 magnitude, polar day) or never rises
    // (polar night) that day. Does not occur at 33.35N; guarded for completeness.
    return { sunriseLocal: cosHa0 < -1 ? solarNoonLocal : null, sunsetLocal: cosHa0 < -1 ? solarNoonLocal : null, solarNoonLocal };
  }
  const ha0Deg = dacos(cosHa0) * RAD2DEG;
  return {
    sunriseLocal: formatLocalDateTime(t.year, t.month, t.day, solarNoonMin - 4 * ha0Deg),
    sunsetLocal: formatLocalDateTime(t.year, t.month, t.day, solarNoonMin + 4 * ha0Deg),
    solarNoonLocal,
  };
}

/**
 * Project elevation/azimuth to a unit direction vector in the studio's (x, y, z)
 * frame — see NORTH_AZIMUTH_OFFSET above for the site bearing this bakes in.
 */
export function sunDirectionVector(elevationDeg: number, azimuthDeg: number, northOffset = NORTH_AZIMUTH_OFFSET): [number, number, number] {
  const azRad = (azimuthDeg + northOffset) * DEG2RAD;
  const elRad = elevationDeg * DEG2RAD;
  const cosEl = dcos(elRad);
  return [dsin(azRad) * cosEl, dsin(elRad), -dcos(azRad) * cosEl];
}

// ---------------------------------------------------------------------------
// Sun-behind windows for camera direction (OWNER_FEEDBACK_2026-09-28 §11,
// docs/engineering/CAMERA_DIRECT.md). Additive: nothing above depends on it.
// ---------------------------------------------------------------------------

/**
 * World heading (radians, `datan2(z, x)` — the camera's `dirFrom` azimuth convention) of a compass
 * azimuth (degrees clockwise from north), under the NORTH_AZIMUTH_OFFSET bearing above.
 */
export function worldHeadingOfAzimuth(azimuthDeg: number, northOffset = NORTH_AZIMUTH_OFFSET): number {
  const d = sunDirectionVector(0, azimuthDeg, northOffset);
  return datan2(d[2], d[0]);
}

export type SunBehindOpts = {
  /** Vertical field of view (deg) of the lens that must keep the sun in frame. */
  vfovDeg: number;
  /** Frame aspect (width / height), default 16:9. */
  aspect?: number;
  /** Keep the sun at least this far inside the frame edge (deg), default 3. */
  marginDeg?: number;
  /** Minimum angle between the optical axis and the sun (deg): flare / blown-out subject guard, default 6. */
  flareDeg?: number;
  /** The scene's site bearing (default: the global NORTH_AZIMUTH_OFFSET). */
  northAzimuthOffset?: number;
};

/**
 * Where a camera must be for the sun to sit *behind the subject*, in frame but off the optical axis, at a
 * local Bombay Beach datetime:
 * - `cameraHeading`: world heading from the subject to the camera (dirFrom convention) = sun heading + π,
 *   with `halfWidth` = hfov/2 − margin (the sun stays horizontally inside the frame);
 * - `pitch`: allowed view pitch (radians, + = looking up): the sun between `flare` and vfov/2 − margin above
 *   the optical axis (sky in the upper frame, never dead centre).
 * `aboveHorizon` false (sun set) means no such window exists: callers refuse.
 */
export type SunBehindWindow = {
  datetime: string;
  sun: { azimuthDeg: number; elevationDeg: number; direction: [number, number, number]; heading: number };
  cameraHeading: { centre: number; halfWidth: number };
  pitch: { min: number; max: number };
  hfovDeg: number;
  vfovDeg: number;
  marginDeg: number;
  flareDeg: number;
  aboveHorizon: boolean;
};

export function sunBehindWindow(localIso: string, opts: SunBehindOpts): SunBehindWindow {
  const north = opts.northAzimuthOffset ?? NORTH_AZIMUTH_OFFSET;
  const s = solarPosition(localIso, BOMBAY_BEACH.lat, BOMBAY_BEACH.lon, north);
  const aspect = opts.aspect ?? 16 / 9;
  const margin = opts.marginDeg ?? 3;
  const flare = opts.flareDeg ?? 6;
  const hfovDeg = 2 * datan(dtan((opts.vfovDeg * DEG2RAD) / 2) * aspect) * RAD2DEG;
  const heading = worldHeadingOfAzimuth(s.azimuthDeg, north);
  let centre = heading + Math.PI;
  if (centre > Math.PI) centre -= 2 * Math.PI;
  return {
    datetime: localIso,
    sun: { azimuthDeg: s.azimuthDeg, elevationDeg: s.elevationDeg, direction: s.direction, heading },
    cameraHeading: { centre, halfWidth: (hfovDeg / 2 - margin) * DEG2RAD },
    pitch: { min: (s.elevationDeg - (opts.vfovDeg / 2 - margin)) * DEG2RAD, max: (s.elevationDeg - flare) * DEG2RAD },
    hfovDeg,
    vfovDeg: opts.vfovDeg,
    marginDeg: margin,
    flareDeg: flare,
    aboveHorizon: s.elevationDeg > 0,
  };
}
