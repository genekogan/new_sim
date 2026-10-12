#!/usr/bin/env node
// MARSLAND: render the world from the 2026 drone's own positions and headings and put each render beside the drone
// picture (team/lanes/marsland-shots/compare/<name>.jpg: drone left, world right).
//
//   node tools/god-skill/scripts/mars-two/drone.mjs <world-url> [name…] [--dpr 2] [--out dir] [--q 'extra=query']
//
// Poses: the video's DJI telemetry (team/lanes/marsland-frames/telemetry.csv: metres east/north of the clip's first fix,
// height above the take-off point) or a still's EXIF GPS + FlightYaw. Positions are relative to the drone's take-off
// point (HOME, fitted from the telemetry's distance-to-home column), which sits at HOME_WORLD in the world frame
// (frame.mjs: north −z, east +x). Headings of video frames are not logged: each view states the one fitted by eye.
// Pitch comes from the horizon row of the drone picture (vertical fov 45° = the viewer's camera; the DJI video's 16:9
// field is ≈ 73° wide, the same as the viewer's at 16:9).
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT, sharp } from './v3.mjs';
import { HOME_WORLD } from './frame.mjs';
import { chromeLease } from '../../lib/chrome-lease.mjs';

const LANES = '<team>/lanes';
const FRAMES = join(LANES, 'marsland-frames');
const W = 1600, H = 900, F = (H / 2) / Math.tan((45 / 2) * Math.PI / 180);   // focal length (px) of the viewer's camera
const tel = readFileSync(join(FRAMES, 'telemetry.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
// the take-off point relative to the clip's first fix (least-squares fit of the D column, rms 3.2 m)
const HOME_REL = [-30, 35];
// the clip's first fix, for stills (EXIF GPS → metres from the take-off point)
const FIX0 = { lon: -115.7135, lat: 33.3619 }, M_LON = 111320 * Math.cos(33.3619 * Math.PI / 180), M_LAT = 110574;
const fromGps = (lat, lon) => [(lon - FIX0.lon) * M_LON - HOME_REL[0], (lat - FIX0.lat) * M_LAT - HOME_REL[1]];

/** Views: frame (video, 1-based, every 4 s) or still; heading (° from north) and horizon row (px of 900) fitted by eye. */
export const VIEWS = {
  // DJI_0012 (2026-03-19 14:33 PDT, the same flight day): EXIF GPS 33.361876 −115.714690, 33.2 m up, FlightYaw 63.5°
  still12: { src: 'stills/DJI_0012.jpg', gps: [33.361876055555555, -115.71469030555556], h: 33.2, heading: 63.5, horizon: 150 },
  // DJI_0033 (2026-03-30 09:37): 67.5 m up, FlightYaw −38.3°
  still33: { src: 'stills/DJI_0033.jpg', gps: [33.36082180555556, -115.7121291388889], h: 67.5, heading: -38.3, horizon: 120 },
  f001: { frame: 1, heading: 319, horizon: 128 },
  f040: { frame: 40, heading: 354, horizon: 138, nudge: [5, -8] },
  f094: { frame: 94, heading: 336, horizon: 125 },
  f035: { frame: 35, heading: 228, horizon: 140 },
  f033: { frame: 33, heading: 182, horizon: 140 },
  f117: { frame: 117, heading: 300, horizon: 128, nudge: [0, 14] },
  f017: { frame: 17, heading: 95, horizon: 70 },
  f080: { frame: 80, heading: 350, horizon: 72 },
  f060: { frame: 60, heading: 175, horizon: 20 },
};

export function pose(v) {
  let rel, h;
  if (v.gps) { rel = fromGps(v.gps[0], v.gps[1]); h = v.h; }
  else { const t = (v.frame - 1) * 4, r = tel[t]; rel = [r[3] - HOME_REL[0], r[4] - HOME_REL[1]]; h = r[6]; }
  // nudge: a per-view eye shift (world m, x east / z south) for the video's 4-decimal GPS (±5 m) and the take-off fit (±10 m)
  const n = v.nudge ?? [0, 0], eye = [HOME_WORLD[0] + rel[0] + n[0], h + 0.3, HOME_WORLD[1] - rel[1] + n[1]];
  const pitch = Math.atan((H / 2 - v.horizon) / F), hd = v.heading * Math.PI / 180, d = 200;
  const at = [eye[0] + Math.sin(hd) * Math.cos(pitch) * d, eye[1] - Math.sin(pitch) * d, eye[2] - Math.cos(hd) * Math.cos(pitch) * d];
  return { eye, at, rel, h, pitchDeg: pitch * 180 / Math.PI };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
  const dpr = Number(flag('dpr', 1)), out = flag('out', join(LANES, 'marsland-shots/compare')), extra = flag('q', '');
  const [url, ...names] = args; mkdirSync(out, { recursive: true });
  const { chromium } = createRequire(join(ROOT, 'mars/viewer/package.json'))('@playwright/test');
  const release = await chromeLease('marsland drone');
  try {
    const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const page = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr })).newPage();
    for (const name of names.length ? names : Object.keys(VIEWS)) {
      const v = VIEWS[name], p = pose(v);
      const q = new URLSearchParams({ shot: '1', eye: p.eye.map((x) => x.toFixed(2)).join(','), at: p.at.map((x) => x.toFixed(2)).join(','), settle: '2000' });
      await page.goto(`${url}?${q}${extra ? `&${extra}` : ''}`, { waitUntil: 'commit', timeout: 600000 });
      for (let i = 0; i < 240; i++) { await page.waitForTimeout(1000); if (i > 5 && await page.evaluate(() => !!window.__shotReady).catch(() => false)) break; }
      await page.waitForTimeout(2500);
      const shot = join(out, `${name}-world${dpr !== 1 ? `@${dpr}x` : ''}.png`);
      await page.screenshot({ path: shot });
      const src = join(FRAMES, v.src ?? `f_${String(v.frame).padStart(3, '0')}.jpg`);
      if (existsSync(src)) {
        const left = await sharp(src).resize(W, H, { fit: 'fill' }).toBuffer(), right = await sharp(shot).resize(W, H).toBuffer();
        const label = Buffer.from(`<svg width="${2 * W}" height="40"><rect width="100%" height="40" fill="black"/><text x="12" y="28" font-size="24" font-family="Helvetica" fill="#ffd34d">${name}: drone (left) · world (right) · ${p.rel.map((x) => x.toFixed(0)).join(' E, ')} N of take-off, ${p.h.toFixed(0)} m up, heading ${v.heading}°, pitch ${p.pitchDeg.toFixed(1)}°</text></svg>`);
        await sharp({ create: { width: 2 * W, height: H + 40, channels: 3, background: '#000' } })
          .composite([{ input: label, top: 0, left: 0 }, { input: left, top: 40, left: 0 }, { input: right, top: 40, left: W }])
          .jpeg({ quality: 82 }).toFile(join(out, `${name}${dpr !== 1 ? `@${dpr}x` : ''}.jpg`));
      }
      console.log(`${name}: eye ${p.eye.map((x) => x.toFixed(1))} heading ${v.heading} pitch ${p.pitchDeg.toFixed(1)} → ${shot}`);
    }
    await b.close();
  } finally { release(); }
}
