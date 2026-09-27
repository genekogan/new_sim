// Engine Lab (/lab): run every proving-ground scenario in the browser via
// window.__marsEngine, assert expectations + zero violations, capture
// top-down/oblique shots with overlays off and on. See app/lab/README.md.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { captureView, collectConsoleErrors, recordVideo } from './helpers';
import { labFrames, openLab, setOverlays, type LabState } from './lab-helpers';

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
      await captureView(page, name, { testInfo, compare: BASELINES.has(name) });
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
// in one tick at both ends of every stair. Marked test.fail so it turns red once fixed.
for (const name of ['stairs', 'deck-to-ground']) {
  test(`lab ${name}: no horizontal teleport at stair ends (known engine issue)`, async ({ page }) => {
    test.fail();
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
