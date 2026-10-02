// Engine Lab: the animated campfire (app/engine-view/fire.ts, owner feedback §1) in "campfire-evening"
// at dusk. Between 20 s and 40 s of the script nobody but the two lawn wanderers moves (6 warm at the
// fire, 2 seated, the talking pair), so two ticks there must differ inside the fire's screen box and
// not on a standing person; the same tick rendered twice (after a fresh replay) must draw the identical
// fire. Also: no console errors, draw calls within +2 of the W3 reference.
import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { captureView, collectConsoleErrors } from './helpers';
import { labFrames, openLab, type LabState } from './lab-helpers';

const FIRE = [-22, -22.5];
const CLOSE: [number[], number[]] = [[-24.6, 1.7, -25.2], [-22, 0.55, -22.5]];
const TOP_CLOSE: [number[], number[]] = [[-21.75, 5.2, -22.3], [-22, 0.45, -22.5]];
/** lab-view `preset('oblique')` for the scenario focus [-19.8, -22, r 8.5, az 180°]. */
const OBLIQUE: [number[], number[]] = [[-19.8 - 8.5 * 1.4, 8.5 * 0.9, -22 + 8.5 * 1.4 * Math.sin(Math.PI)], [-19.8, 0.8, -22]];
const T0 = 500, T1 = 506; // 25.0 s and 25.3 s
/** Measured W3 animated fire on this branch before v2, campfire-evening tick 500. */
const REFERENCE_CALLS = { oblique: 431, top: 429, close: 466 };
type Box = { x0: number; y0: number; x1: number; y1: number };
type V = number[];

const sub = (a: V, b: V) => a.map((v, i) => v - b[i]);
const dot = (a: V, b: V) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: V, b: V) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V) => a.map((v) => v / Math.hypot(...a));

/** Screen box of an axis-aligned world box seen by the lab camera (PerspectiveCamera fov 45, canvas aspect). */
function project(cam: V, target: V, min: V, max: V, c: { x: number; y: number; width: number; height: number }): Box {
  const f = norm(sub(target, cam)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const k = 1 / Math.tan((22.5 * Math.PI) / 180), aspect = c.width / c.height;
  const xs: number[] = [], ys: number[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const d = sub([x, y, z], cam), depth = dot(d, f);
    xs.push(c.x + ((dot(d, r) * k) / (depth * aspect) + 1) * 0.5 * c.width);
    ys.push(c.y + (1 - (dot(d, u) * k) / depth) * 0.5 * c.height);
  }
  return { x0: Math.floor(Math.min(...xs)), y0: Math.floor(Math.min(...ys)), x1: Math.ceil(Math.max(...xs)), y1: Math.ceil(Math.max(...ys)) };
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Fraction of 2×2 blocks in `box` whose mean colour changes by more than `level` (0–255, largest channel)
 * between two screenshots. The 2×2 mean ignores sub-pixel silhouette shimmer (Idle breathing, antialiasing);
 * `level` 32 ignores the firelight flicker on a still body.
 */
function changed(a: Buffer, b: Buffer, box: Box, level: number) {
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b);
  const mean = (p: PNG, x: number, y: number, c: number) =>
    (p.data[(y * p.width + x) * 4 + c] + p.data[(y * p.width + x + 1) * 4 + c] + p.data[((y + 1) * p.width + x) * 4 + c] + p.data[((y + 1) * p.width + x + 1) * 4 + c]) / 4;
  let n = 0, total = 0;
  for (let y = box.y0; y + 1 < box.y1; y += 2)
    for (let x = box.x0; x + 1 < box.x1; x += 2, total++)
      if (Math.max(...[0, 1, 2].map((c) => Math.abs(mean(pa, x, y, c) - mean(pb, x, y, c)))) > level) n++;
  return n / total;
}
function pixelShare(png: Buffer, box: Box, match: (r: number, g: number, b: number) => boolean) {
  const p = PNG.sync.read(png);
  let count = 0, total = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const i = (y * p.width + x) * 4;
    if (match(p.data[i], p.data[i + 1], p.data[i + 2])) count++;
    total++;
  }
  return count / total;
}

const step = (page: Page, n: number): Promise<LabState> => page.evaluate((k) => window.__marsEngine!.step(k), n);
const calls = (page: Page) => page.evaluate(() => window.__marsEngine!.info().calls);
async function view(page: Page, cam: V, target: V) {
  await page.evaluate(([p, t]) => window.__marsEngine!.camera(p, t), [cam, target]);
  await labFrames(page, 4);
}
const shot = (page: Page) => page.screenshot({ animations: 'disabled', caret: 'hide' });

test('lab campfire: animated, deterministic fire; people still; draw calls; dusk captures', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await openLab(page, 'campfire-evening');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('campfire-evening', { paused: true }));
  const st0 = await step(page, T0);
  expect(st0.time).toBeCloseTo(25, 6);

  // baselines at dusk: the scenario's oblique preset and a close-up at eye level
  for (const cam of ['oblique', 'top'] as const) {
    await page.evaluate((c) => window.__marsEngine!.cameraPreset(c), cam);
    await labFrames(page, 4);
    const n = await calls(page);
    console.log(`[fire] ${cam}: ${n} draw calls (W3 reference ${REFERENCE_CALLS[cam]})`);
    expect(n, `${cam} draw calls within +2 of W3`).toBeLessThanOrEqual(REFERENCE_CALLS[cam] + 2);
    await captureView(page, cam === 'top' ? 'fire-top' : 'fire-dusk-oblique', { testInfo, softVisual: true });
  }
  await view(page, ...CLOSE);
  const nClose = await calls(page);
  console.log(`[fire] close: ${nClose} draw calls (W3 reference ${REFERENCE_CALLS.close})`);
  expect(nClose, 'close-up draw calls within +2 of W3').toBeLessThanOrEqual(REFERENCE_CALLS.close + 2);
  await captureView(page, 'fire-dusk-close', { testInfo, softVisual: true });
  const a = { close: await shot(page), oblique: Buffer.alloc(0) };
  await view(page, ...TOP_CLOSE);
  await captureView(page, 'fire-top-close', { testInfo, softVisual: true });
  const topA = await shot(page);
  await view(page, ...OBLIQUE);
  a.oblique = await shot(page);

  // regions: the flame body (±0.3 m, 0.15–1.1 m) in the close-up; in the oblique view the upper body of a
  // standing, still person clear of the ember column (embers stay within ±0.5 m of the fire axis)
  const canvas = (await page.locator('.lab-canvas canvas').boundingBox())!;
  const flame = [[FIRE[0] - 0.3, 0.15, FIRE[1] - 0.3], [FIRE[0] + 0.3, 1.1, FIRE[1] + 0.3]] as const;
  const fireBox = project(...CLOSE, [...flame[0]], [...flame[1]], canvas);
  const topBox = project(...TOP_CLOSE, [FIRE[0] - 0.4, 0.10, FIRE[1] - 0.4], [FIRE[0] + 0.4, 1.1, FIRE[1] + 0.4], canvas);
  const smokeBox = project(...CLOSE, [FIRE[0] - 0.28, 1.5, FIRE[1] - 0.28], [FIRE[0] + 0.28, 2.7, FIRE[1] + 0.28], canvas);
  const fireObl = project(...OBLIQUE, [...flame[0]], [...flame[1]], canvas);
  const column = project(...OBLIQUE, [FIRE[0] - 0.55, 0, FIRE[1] - 0.55], [FIRE[0] + 0.55, 3.0, FIRE[1] + 0.55], canvas);
  const hud = (await page.getByTestId('social-hud').boundingBox())!;
  const hudBox = { x0: hud.x, y0: hud.y, x1: hud.x + hud.width, y1: hud.y + hud.height };
  const inCanvas = (b: Box) => b.x0 >= canvas.x && b.y0 >= canvas.y && b.x1 <= canvas.x + canvas.width && b.y1 <= canvas.y + canvas.height;
  const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const people = st0.humans
    .filter((h) => h.activity === 'warm')
    .map((h) => ({ id: h.id, box: project(...OBLIQUE, [h.p[0] - 0.25, 0.9, h.p[2] - 0.25], [h.p[0] + 0.25, 1.75, h.p[2] + 0.25], canvas) }))
    .filter((q) => inCanvas(q.box) && !overlaps(q.box, column) && !overlaps(q.box, hudBox))
    .sort((p, q) => area(q.box) - area(p.box));
  expect(people.length, 'a standing person clear of the fire in the oblique view').toBeGreaterThan(0);
  const person = people[0];

  // a later take time: the flame moves, the people do not
  const st1 = await step(page, T1 - T0);
  for (const h of st1.humans.filter((x) => !['a1', 'a2'].includes(x.id))) {
    const h0 = st0.humans.find((x) => x.id === h.id)!;
    expect(Math.hypot(h.p[0] - h0.p[0], h.p[2] - h0.p[2]), `${h.id} stationary between ticks`).toBeLessThan(1e-9);
  }
  await labFrames(page, 4);
  const b = { oblique: (await captureView(page, 'fire-t25.3-oblique', { testInfo, compare: false }), await shot(page)), close: Buffer.alloc(0) };
  await view(page, ...CLOSE);
  await captureView(page, 'fire-t25.3-close', { testInfo, compare: false });
  b.close = await shot(page);
  await view(page, ...TOP_CLOSE);
  const topB = await shot(page);
  const fireDiff = changed(a.close, b.close, fireBox, 32), fireOblDiff = changed(a.oblique, b.oblique, fireObl, 32);
  const topDiff = changed(topA, topB, topBox, 24);
  const warmTop = pixelShare(topA, topBox, (r, g, b) => r > 120 && r > g * 1.25 && g > b * 1.15);
  const smokeDiff = changed(a.close, b.close, smokeBox, 12);
  const whiteCore = pixelShare(a.close, fireBox, (r, g, b) => r >= 250 && g >= 250 && b >= 250);
  const personDiff = changed(a.oblique, b.oblique, person.box, 32);
  console.log(`[fire] t25.0→t25.3 changed 2×2 blocks (> 32/255): close fire ${JSON.stringify(fireBox)} ${(fireDiff * 100).toFixed(1)} %; oblique fire ${JSON.stringify(fireObl)} ${(fireOblDiff * 100).toFixed(1)} %, person ${person.id} ${JSON.stringify(person.box)} ${(personDiff * 100).toFixed(2)} %`);
  console.log(`[fire] top-close warm ${(warmTop * 100).toFixed(2)} %, temporal silhouette ${(topDiff * 100).toFixed(2)} %; smoke column motion ${(smokeDiff * 100).toFixed(2)} %; pure-white core ${(whiteCore * 100).toFixed(3)} %`);
  expect(fireDiff, 'the flame animates between take times (close-up)').toBeGreaterThan(0.02);
  expect(topDiff, 'overhead flame silhouette changes; a flat coal disc would not').toBeGreaterThan(0.01);
  expect(warmTop, 'overhead tongues remain visibly warm').toBeGreaterThan(0.005);
  expect(smokeDiff, 'the smoke column changes above the fire at dusk').toBeGreaterThan(0.002);
  expect(whiteCore, 'less than 1% of the fire box clips to pure white').toBeLessThan(0.01);
  expect(personDiff, `${person.id} stays still`).toBeLessThan(0.005);

  // determinism: a fresh replay to the same tick draws the identical fire
  await page.evaluate(() => window.__marsEngine!.runScenario('campfire-evening', { paused: true }));
  await step(page, T1);
  await view(page, ...CLOSE);
  const c = await shot(page);
  const again = changed(b.close, c, fireBox, 0);
  console.log(`[fire] replayed tick ${T1}: fire box: ${(again * 100).toFixed(3)} % of 2×2 blocks differ at all`);
  expect(again, 'same tick → identical fire').toBe(0);
  expect(errors, 'console/page errors').toEqual([]);
});
