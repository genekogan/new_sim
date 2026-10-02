// Engine Lab (/lab): run every proving-ground scenario in the browser via
// window.__marsEngine, assert expectations + zero violations, capture
// top-down/oblique shots with overlays off and on. See app/lab/README.md.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { captureView, collectConsoleErrors, recordVideo, writeArtifact } from './helpers';
import { labFrames, openLab, setOverlays, type LabState } from './lab-helpers';
const W51_FIXME = '2022 reconciliation W51: mars-2022 re-seeded (houses, stairs, solar, trailers moved); the recorded 2022 takes / pins no longer match it — re-record parked with the content (OWNER_DECISIONS 2026-09-29 evening; RECONCILIATION_2022.md)';

const SCENARIOS: { name: string; capture: number[] }[] = [
  { name: 'wall', capture: [0.5] },
  { name: 'u-trap', capture: [0.35] },
  { name: 'narrow-passage', capture: [0.45] },
  { name: 'stairs', capture: [0.55] },
  { name: 'deck-to-ground', capture: [0.5] },
  { name: 'incomplete-stairs', capture: [] },
  { name: 'construction', capture: [0.2, 0.5] },
];
/** Committed baselines (small representative set); everything else is capture-only. */
const BASELINES = new Set(['lab-stairs-mid-oblique', 'lab-narrow-passage-mid-top-debug']);

const run = (page: Page, name: string) => page.evaluate((n) => window.__marsEngine!.runScenario(n, { paused: true }), name);
const toEnd = (page: Page) => page.evaluate(() => window.__marsEngine!.runToEnd());
const step = (page: Page, n: number) => page.evaluate((k) => window.__marsEngine!.step(k), n);

async function shots(page: Page, base: string, testInfo: TestInfo) {
  for (const cam of ['top', 'oblique'] as const) {
    await page.evaluate((c) => window.__marsEngine!.cameraPreset(c), cam);
    for (const debug of [false, true]) {
      await setOverlays(page, debug);
      const name = `${base}-${cam}${debug ? '-debug' : ''}`;
      await captureView(page, name, { testInfo, softVisual: true, compare: BASELINES.has(name) });
    }
  }
  await setOverlays(page, false);
}

for (const s of SCENARIOS) {
  test(`lab ${s.name}: completes as expected, zero violations, captures`, async ({ page }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await openLab(page);
    await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' }); // timing numbers vary per run
    // pass 1: how long does it take?
    await run(page, s.name);
    const end: LabState = await toEnd(page);
    expect(end.done, 'scenario finished within its tick budget').toBe(true);
    for (const c of end.checks) expect(c.ok, c.message).toBe(true);
    expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
    // failures are shown loudly: one alert banner per failed action, naming the diagnostic code
    const failed = (await page.evaluate(() => window.__marsEngine!.records())).filter((r) => r.status === 'failed');
    for (const r of failed) await expect(page.getByRole('alert').filter({ hasText: r.diagnostic!.code })).toBeVisible();
    // pass 2 (deterministic replay): mid-action captures, then the end state
    await run(page, s.name);
    let at = 0;
    for (const f of s.capture) {
      const t = Math.round(end.tick * f);
      await step(page, t - at);
      at = t;
      await labFrames(page);
      await shots(page, `lab-${s.name}-${s.capture.length > 1 ? `t${t}` : 'mid'}`, testInfo);
    }
    const replay = await toEnd(page);
    expect(replay.tick, 'replay reaches the same end tick').toBe(end.tick);
    expect(replay.humans).toEqual(end.humans);
    await labFrames(page);
    await shots(page, `lab-${s.name}-end`, testInfo);
    expect(errors, 'console/page errors').toEqual([]);
  });
}

test('lab stairs: climber is on the steps, facing up-stair, rising continuously', async ({ page }) => {
  await openLab(page);
  await run(page, 'stairs');
  const samples: { y: number; yaw: number; act: string; x: number }[] = [];
  for (let i = 0; i < 400; i += 5) {
    const st = await step(page, 5);
    const h = st.humans[0];
    samples.push({ y: h.p[1], yaw: h.yaw, act: h.activity, x: h.p[0] });
    if (st.done) break;
  }
  // x ∈ [2, 6] is the stair run; the ends pop (see the known-issue test below)
  const climbing = samples.filter((s) => s.act === 'climb-up' && s.x >= 2 && s.x <= 6);
  expect(climbing.length).toBeGreaterThan(5);
  for (const c of climbing) {
    expect(Math.abs(c.yaw), 'faces +x (up stairs A)').toBeLessThan(0.06);
    // on the stair line: y = (x - 2) * 0.75 for stairs A
    expect(Math.abs(c.y - (c.x - 2) * 0.75)).toBeLessThan(0.02);
  }
});

// KNOWN ENGINE ISSUE (walk.ts stepLink): traversal starts at link.path[0] although the walker
// stands at link.from.p, and ends by snapping to link.to.p — a 0.40–0.47 m horizontal teleport
// in one tick at both ends of every stair. Fixed in walk.ts stepLink (continuous entry→steps→exit path).
for (const name of ['stairs', 'deck-to-ground']) {
  test(`lab ${name}: no horizontal teleport at stair ends`, async ({ page }) => {
    await openLab(page);
    await run(page, name);
    let prev: number[] | null = null, worst = 0;
    for (let i = 0; i < 600; i++) {
      const st = await step(page, 1);
      const p = st.humans[0].p;
      if (prev) worst = Math.max(worst, Math.hypot(p[0] - prev[0], p[2] - prev[2]));
      prev = p;
      if (st.done) break;
    }
    expect(worst, 'max horizontal move per tick (m)').toBeLessThan(1.4 / 20 + 0.01);
  });
}

for (const name of ['narrow-passage', 'stairs']) {
  test(`lab ${name}: real-time video`, async ({ browser }) => {
    const context = await recordVideo(browser, `lab-${name}`);
    const page = await context.newPage();
    await openLab(page, name);
    await page.evaluate((n) => window.__marsEngine!.runScenario(n, { paused: true }), name);
    await page.evaluate(() => {
      window.__marsEngine!.setOverlay('agents', true);
      window.__marsEngine!.setOverlay('labels', true);
      window.__marsEngine!.setOverlay('routes', true);
      window.__marsEngine!.cameraPreset('oblique');
      window.__marsEngine!.runScenario(window.__marsEngine!.state().scenario, { paused: false, speed: 2 });
    });
    await page.waitForFunction(() => window.__marsEngine!.state().done, null, { timeout: 90_000 });
    const st = await page.evaluate(() => window.__marsEngine!.state());
    for (const c of st.checks) expect(c.ok, c.message).toBe(true);
    await context.close();
  });
}

// Perf: sim step cost (synchronous fast-forward) and real-time render stats, 3 vs 30 humans.
test('lab perf: step cost + render stats for trio and stress-30', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openLab(page);
  const out: Record<string, unknown> = {};
  for (const name of ['trio', 'stress-30']) {
    await run(page, name);
    const end = await toEnd(page);
    const sim = await page.evaluate(() => window.__marsEngine!.perf());
    const violations = (await page.evaluate(() => window.__marsEngine!.violations())).length;
    // real time: replay from the start at 1x for 6 s and count frames
    await page.evaluate((n) => window.__marsEngine!.runScenario(n, { paused: false, speed: 1 }), name);
    const f0 = await page.evaluate(() => ({ f: window.__marsEngine!.frames, t: performance.now(), tick: window.__marsEngine!.state().tick }));
    await page.waitForTimeout(6000);
    const f1 = await page.evaluate(() => ({ f: window.__marsEngine!.frames, t: performance.now(), tick: window.__marsEngine!.state().tick }));
    const live = await page.evaluate(() => window.__marsEngine!.perf());
    const info = await page.evaluate(() => window.__marsEngine!.info());
    out[name] = {
      humans: end.humans.length,
      fastForward: { ticks: end.tick, ...sim },
      realtime: { fps: +((f1.f - f0.f) / ((f1.t - f0.t) / 1000)).toFixed(1), simSecondsPerSecond: +(((f1.tick - f0.tick) / 20) / ((f1.t - f0.t) / 1000)).toFixed(2), step: live },
      clips: [...new Map(info.humans.map((h) => [h.template, (h as { clipSpeed?: number }).clipSpeed])).entries()],
      render: { calls: info.calls, triangles: info.triangles, geometries: info.geometries, textures: info.textures },
      violations,
    };
    await page.evaluate(() => window.__marsEngine!.pause(true));
    await page.evaluate(() => window.__marsEngine!.cameraPreset('oblique'));
    await setOverlays(page, false);
    await captureView(page, `lab-${name}-oblique`, { testInfo, compare: false });
    await page.evaluate(() => window.__marsEngine!.cameraPreset('top'));
    await setOverlays(page, true);
    await captureView(page, `lab-${name}-top-debug`, { testInfo, compare: false });
    await setOverlays(page, false);
  }
  writeArtifact('lab-perf.json', out);
  console.log(JSON.stringify(out, null, 1));
  expect(errors).toEqual([]);
});

// Lab "Oblique yard" (year-build presets): the recorded whole-skeleton take's opening shot — the yard + crew region from
// the south-east at 32°, the planner's bottom safe area — as a lab button. Same pose as the take's first camera sample.
test('lab: year-build "Oblique yard" view = the whole-skeleton take\'s opening camera', async ({ page }, testInfo) => {
  test.fixme(true, W51_FIXME);
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await openLab(page, 'year-build-2022-house');
  await page.evaluate(() => (window.__marsEngine as unknown as { runScenario(n: string, o: object): Promise<unknown> }).runScenario('year-build-2022-house', { paused: true }));
  await page.getByRole('button', { name: 'Oblique yard' }).click();
  await labFrames(page, 4);
  const pose = await page.evaluate(() => (window.__marsEngine as unknown as { cameraPose(): { position: number[]; target: number[]; fov: number } }).cameraPose());
  const take = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/engine/takes/year-build-2022-east-house.json'), 'utf8'));
  const s0 = take.camera.data.samples[0] as { position: number[]; target: number[]; fov: number };
  for (let i = 0; i < 3; i++) {
    expect(pose.position[i], `position[${i}]`).toBeCloseTo(s0.position[i], 3);
    expect(pose.target[i], `target[${i}]`).toBeCloseTo(s0.target[i], 3);
  }
  expect(pose.fov).toBe(s0.fov);
  await captureView(page, 'lab-year-build-oblique-yard', { testInfo, compare: false });
  await page.getByRole('button', { name: 'Oblique', exact: true }).click();
  expect((await page.evaluate(() => (window.__marsEngine as unknown as { cameraPose(): { fov: number } }).cameraPose())).fov, 'the other presets restore the lab fov').toBe(45);
  expect(errors, 'console/page errors').toEqual([]);
});
