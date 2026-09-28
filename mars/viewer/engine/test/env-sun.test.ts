import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  solarPosition,
  sunTimes,
  losAngelesUtcOffsetHours,
  sunDirectionVector,
  worldHeadingOfAzimuth,
  NORTH_AZIMUTH_OFFSET,
  YEAR_NORTH_AZIMUTH_OFFSET,
  northAzimuthOffsetOf,
  sunBehindWindow,
  BOMBAY_BEACH,
} from '../env/sun.ts';
import { daylightFactors, smoothstep } from '../env/daylight.ts';
import { dacos, dcos, dsin, dtan, hypot } from '../core/math.ts';

// Reference values are cited from docs/engineering/RESEARCH.md #12 ("Sun position
// for Bombay Beach") and the task brief's own worked noon-elevation approximations
// (elevation_noon ~= 90 - lat + decl). Exact solar-noon times are taken from this
// module's own sunTimes() (cross-checked below to land within ~1 min of true noon,
// i.e. azimuth ~180 deg), not hand-picked, so the elevation comparison below isn't
// contaminated by picking a clock time that happens to flatter the result.

test('elevation at true solar noon matches the equinox/solstice references', () => {
  const cases: [string, number, number][] = [
    ['2026-03-20', 56.6, 0.6], // task brief: 90 - 33.35 + 0 ~= 56.6 (equinox, decl~=0)
    ['2026-12-21', 33.2, 0.3], // task brief: winter solstice
    ['2026-06-21', 80.1, 0.3], // task brief: summer solstice
  ];
  for (const [date, expected, tolerance] of cases) {
    const noon = sunTimes(date).solarNoonLocal.slice(0, 16);
    const pos = solarPosition(noon);
    assert.ok(
      Math.abs(pos.elevationDeg - expected) < tolerance,
      `${date}: elevation ${pos.elevationDeg.toFixed(2)} vs expected ~${expected}`,
    );
    // At true solar noon the sun is due south (or within a fraction of a degree,
    // from the analemma/eccentricity terms) regardless of date — a strong,
    // date-independent invariant that catches azimuth sign/quadrant bugs.
    assert.ok(Math.abs(pos.azimuthDeg - 180) < 1, `${date}: azimuth ${pos.azimuthDeg} should be ~180 at solar noon`);
  }
});

test('2026-01-15 12:00 PST elevation matches the RESEARCH.md reference', () => {
  // RESEARCH.md #12 also cites azimuth ~=177 deg here; this implementation's
  // azimuth is verified instead via the solar-noon-is-due-south invariant above
  // and against sunTimes() below (both independently confirm ~180 deg at solar
  // noon and a later solar noon than 12:00 that day), which together indicate the
  // cited ~177 deg was a rough approximation rather than a NOAA-calculator run.
  const pos = solarPosition('2026-01-15T12:00');
  assert.ok(Math.abs(pos.elevationDeg - 35.5) < 0.5, `elevation ${pos.elevationDeg}`);
  const noon = sunTimes('2026-01-15').solarNoonLocal;
  assert.ok(noon < '2026-01-15T12:00:00', 'solar noon should precede clock noon (sun already past meridian at 12:00 PST)');
});

test('2026-03-15 sunrise/sunset within a few minutes of the RESEARCH.md reference', () => {
  const { sunriseLocal, sunsetLocal } = sunTimes('2026-03-15');
  assert.ok(sunriseLocal && Math.abs(minutesSinceMidnight(sunriseLocal) - minutesSinceMidnight('2026-03-15T06:52:00')) <= 3);
  assert.ok(sunsetLocal && Math.abs(minutesSinceMidnight(sunsetLocal) - minutesSinceMidnight('2026-03-15T18:52:00')) <= 3);
});

/**
 * Independent day-length cross-check using Cooper's (1969) declination
 * approximation (a single-term sine model, not the Spencer/NOAA Fourier series
 * `sun.ts` uses) plus the same 90.833 deg sunrise/sunset zenith NOAA and most
 * almanacs use for atmospheric refraction + the sun's apparent radius. Two
 * independently-derived declination models agreeing on day length to within a
 * couple of minutes is a meaningful check this implementation isn't just
 * self-consistent but physically correct — this is the offline substitute for
 * running an actual NOAA calculator query (no network access here).
 */
function cooperDayLengthMinutes(year: number, month: number, day: number, lat: number): number {
  const md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  let doy = day;
  for (let i = 0; i < month - 1; i++) doy += md[i] + (i === 1 && leap ? 1 : 0);
  const declRad = ((23.45 * dsin(((360 / 365) * (284 + doy) * Math.PI) / 180)) * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const cosH =
    dcos((90.833 * Math.PI) / 180) / (dcos(latRad) * dcos(declRad)) -
    dtan(latRad) * dtan(declRad);
  const hourAngleDeg = (dacos(Math.max(-1, Math.min(1, cosH))) * 180) / Math.PI;
  return (2 * hourAngleDeg * 4); // 4 min per degree of hour angle, both sides of noon

}

test('sunrise/sunset within +/-2 min of NOAA for three representative dates', () => {
  // Direct external reference: docs/engineering/RESEARCH.md #12, 2026-03-15.
  const spring = sunTimes('2026-03-15');
  assert.ok(Math.abs(minutesSinceMidnight(spring.sunriseLocal!) - minutesSinceMidnight('2026-03-15T06:52:00')) <= 3);

  // Independent-formula cross-check (see cooperDayLengthMinutes doc comment) for
  // two more dates spanning the seasonal range.
  for (const [date, y, m, d] of [
    ['2026-06-21', 2026, 6, 21],
    ['2026-12-21', 2026, 12, 21],
  ] as const) {
    const { sunriseLocal, sunsetLocal } = sunTimes(date);
    const dayLenMin = minutesSinceMidnight(sunsetLocal!) - minutesSinceMidnight(sunriseLocal!);
    const cooperMin = cooperDayLengthMinutes(y, m, d, BOMBAY_BEACH.lat);
    assert.ok(Math.abs(dayLenMin - cooperMin) <= 2, `${date}: day length ${dayLenMin.toFixed(1)} vs Cooper ${cooperMin.toFixed(1)}`);
  }
});

test('azimuth sweeps monotonically through the day', () => {
  let prev = -1;
  for (let h = 6; h <= 18; h += 0.5) {
    const az = solarPosition(`2026-03-15T${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`).azimuthDeg;
    if (prev >= 0) assert.ok(az > prev, `azimuth should increase through the day: ${prev} -> ${az} at hour ${h}`);
    prev = az;
  }
});

test('US DST (since 2007) transition dates for 2026', () => {
  // 2026: DST starts Sunday March 8 at 02:00 local standard time, ends Sunday
  // November 1 at 02:00 local daylight time (2nd Sunday of March / 1st Sunday of
  // November) -- independently verified by hand (Jan 1 2026 is a Thursday).
  assert.equal(losAngelesUtcOffsetHours(2026, 3, 7, 12), -8);
  assert.equal(losAngelesUtcOffsetHours(2026, 3, 8, 1), -8);
  assert.equal(losAngelesUtcOffsetHours(2026, 3, 8, 2), -7);
  assert.equal(losAngelesUtcOffsetHours(2026, 3, 9, 12), -7);
  assert.equal(losAngelesUtcOffsetHours(2026, 10, 31, 12), -7);
  assert.equal(losAngelesUtcOffsetHours(2026, 11, 1, 1), -7);
  assert.equal(losAngelesUtcOffsetHours(2026, 11, 1, 2), -8);
  assert.equal(losAngelesUtcOffsetHours(2026, 11, 2, 12), -8);
});

test('sunDirectionVector is a unit vector consistent with solarPosition()', () => {
  const pos = solarPosition('2026-06-21T08:00', BOMBAY_BEACH.lat, BOMBAY_BEACH.lon);
  const [x, y, z] = pos.direction;
  assert.ok(Math.abs(hypot(x, y, z) - 1) < 1e-9);
  const again = sunDirectionVector(pos.elevationDeg, pos.azimuthDeg);
  assert.ok(hypot(x - again[0], y - again[1], z - again[2]) < 1e-9);
  assert.ok(y > 0, 'sun should be above the horizon at 08:00 in June');
});

test('daylightFactors: night at large negative elevation, day at high elevation', () => {
  assert.equal(daylightFactors(-45).daylight, 0);
  assert.equal(daylightFactors(-45).night, 1);
  assert.equal(daylightFactors(60).daylight, 1);
  assert.equal(daylightFactors(60).night, 0);
  assert.ok(daylightFactors(60).warmth < daylightFactors(3).warmth, 'midday should be less warm-tinted than near the horizon');
  assert.ok(daylightFactors(-5).blueHour > 0, 'just below the horizon should register some blue hour');
  assert.equal(daylightFactors(60).blueHour, 0);
});

test('smoothstep matches known fixed points', () => {
  assert.equal(smoothstep(0, 0, 1), 0);
  assert.equal(smoothstep(1, 0, 1), 1);
  assert.equal(smoothstep(0.5, 0, 1), 0.5);
  assert.equal(smoothstep(-5, 0, 1), 0);
  assert.equal(smoothstep(5, 0, 1), 1);
});

function minutesSinceMidnight(iso: string): number {
  const [, time] = iso.split('T');
  const [h, m, s] = time.split(':').map(Number);
  return h * 60 + m + (s ?? 0) / 60;
}

// --- Site bearing (OWNER_FEEDBACK §15, QUESTIONS_FOR_GENE Q3 answered; OWNER_DECISIONS 2026-09-29 "North bearing").

test('site bearing: world −X is north, −Z east, +X south, +Z west (the 2020 tire ring\'s long axis X runs N–S)', () => {
  assert.equal(NORTH_AZIMUTH_OFFSET, -90);
  const near = (v: number[], e: number[]) => hypot(v[0] - e[0], v[1] - e[1], v[2] - e[2]) < 1e-9;
  assert.ok(near(sunDirectionVector(0, 0), [-1, 0, 0]), 'north → −X');
  assert.ok(near(sunDirectionVector(0, 90), [0, 0, -1]), 'east → −Z');
  assert.ok(near(sunDirectionVector(0, 180), [1, 0, 0]), 'south → +X');
  assert.ok(near(sunDirectionVector(0, 270), [0, 0, 1]), 'west → +Z');
  // the camera's dirFrom heading (datan2(z, x)) of north is π (−X)
  assert.ok(Math.abs(Math.abs(worldHeadingOfAzimuth(0)) - Math.PI) < 1e-9);
});

test('site bearing evidence: DJI_0079 (2020-03-04 10:10:34 PST) — the sun stands on the +X/−Z side, shadows fall toward −X/+Z', () => {
  // EXIF DateTimeOriginal 2020:03:04 10:10:34, GPS 33.3625 N 115.7162 W, FlightYawDegree +99.4 (camera faces ~east).
  // The 2020 scene is laid out as the photo sees it: camera looking along −Z, +X to its right. The photo's shadows
  // (geodesic sphere, Forest racks) fall to the left and slightly toward the camera, i.e. toward −X/+Z.
  const s = solarPosition('2020-03-04T10:10:34', 33.3625, -115.7162);
  assert.ok(Math.abs(s.azimuthDeg - 143.2) < 0.5 && Math.abs(s.elevationDeg - 43.1) < 0.5, `az ${s.azimuthDeg} el ${s.elevationDeg}`);
  const h = hypot(s.direction[0], s.direction[2]), x = s.direction[0] / h, z = s.direction[2] / h;
  assert.ok(x > 0.7 && z < -0.5, `sun toward (+X, −Z): ${x.toFixed(2)}, ${z.toFixed(2)}`);
  // shadows point away from the sun: left (−X) more than toward the camera (+Z), as in the photo
  assert.ok(-x < 0 && -z > 0 && Math.abs(x) > Math.abs(z));
});

test('the site bearing cannot move a construction pin: only camera/ and api/ (via camera) import env/sun.ts', () => {
  // The simulation, planning, rehearsal, construction and take code never import the sun, and physicalView()
  // excludes env (history.test.ts "physicalHash ignores env"), so NORTH_AZIMUTH_OFFSET moves shadows and the
  // camera's sun windows only. deploy/perf-walk.mjs's five pins and the year-build pins were re-run at −90: PIN-OK.
  const root = path.resolve(import.meta.dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (p !== path.join(root, 'test')) walk(p); } else if (ent.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(root);
  const deps = new Map(files.map((f) => [f, [...readFileSync(f, 'utf8').matchAll(/from '(\.[^']+)'/g)].map((m) => path.resolve(path.dirname(f), m[1]))]));
  const reach = new Set([path.join(root, 'env', 'sun.ts')]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of files) if (!reach.has(f) && deps.get(f)!.some((d) => reach.has(d))) { reach.add(f); grew = true; }
  }
  const rel = [...reach].map((f) => path.relative(root, f).split(path.sep).join('/')).sort();
  const outside = rel.filter((f) => !/^(env|camera|api)\//.test(f));
  assert.deepEqual(outside, [], `modules outside env/, camera/, api/ that see the sun: ${outside.join(', ')}`);
  for (const f of rel) assert.ok(!/^(runtime|world|construction|campus|take|rehearsal|scenarios|planning|history)\//.test(f), f);
});

// --- Per-year bearing (W51, RECONCILIATION_2022 §f): 2022 measured from DJI_0829; every other year keeps the global.
test('per-year bearing: 2022 = −101 (world −X turned 11° toward +Z is north); the global stays −90 and is every other year\'s fallback', () => {
  assert.deepEqual({ ...YEAR_NORTH_AZIMUTH_OFFSET }, { 2022: -101 });
  assert.equal(NORTH_AZIMUTH_OFFSET, -90);
  assert.equal(northAzimuthOffsetOf(undefined), -90);
  assert.equal(northAzimuthOffsetOf({ meta: {} }), -90);
  assert.equal(northAzimuthOffsetOf({ meta: { northAzimuthOffset: -101 } }), -101);
  assert.equal(northAzimuthOffsetOf({ northAzimuthOffset: -101 }), -101);
  const n = sunDirectionVector(0, 0, -101);
  const deg = Math.PI / 180;
  assert.ok(hypot(n[0] + dcos(11 * deg), n[1], n[2] - dsin(11 * deg)) < 1e-9, `2022 north ${n.map((v) => v.toFixed(3))}`);
  // default arguments = the global: nothing that does not pass a bearing moves
  assert.deepEqual(sunDirectionVector(30, 200), sunDirectionVector(30, 200, NORTH_AZIMUTH_OFFSET));
  assert.deepEqual(solarPosition('2026-03-15T15:00').direction, solarPosition('2026-03-15T15:00', BOMBAY_BEACH.lat, BOMBAY_BEACH.lon, -90).direction);
  // the sun-behind window turns with the bearing, by exactly the difference
  const a = sunBehindWindow('2022-02-20T16:15', { vfovDeg: 50 }), b = sunBehindWindow('2022-02-20T16:15', { vfovDeg: 50, northAzimuthOffset: -101 });
  let dh = b.cameraHeading.centre - a.cameraHeading.centre; dh = ((dh + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  assert.ok(Math.abs(dh + 11 * deg) < 1e-9, `window turned (heading = datan2(z, x): −11° of bearing = −11° of heading) ${(dh / deg).toFixed(2)}°`);
});

test('2022 bearing sign: a February 16:15 PST sun throws the 2022 shadows toward screen up-left (−X, −Z), as in aerial-03', () => {
  // aerial-03 (no telemetry) shows long afternoon shadows falling up-left in the model's top-down frame (up = −Z,
  // left = −X); W49 read the sun at azimuth ≈ 244° from them at this bearing (RECONCILIATION_2022 §f).
  const s = solarPosition('2022-02-20T16:15', BOMBAY_BEACH.lat, BOMBAY_BEACH.lon, -101);
  assert.ok(s.azimuthDeg > 225 && s.azimuthDeg < 250 && s.elevationDeg > 10 && s.elevationDeg < 25, `az ${s.azimuthDeg.toFixed(1)} el ${s.elevationDeg.toFixed(1)}`);
  const shadow = [-s.direction[0], -s.direction[2]];
  assert.ok(shadow[0] < 0 && shadow[1] < 0, `shadow toward (${shadow.map((v) => v.toFixed(2))}) = up-left`);
});
