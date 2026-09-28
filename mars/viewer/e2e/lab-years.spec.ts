// Engine Lab year walkabouts (app/lab/year-walkabout.ts): each generated engine
// scene public/engine/campus-<year>.json is fetched and built into Spatial +
// grids in the browser, four walkers cross the campus to completion, zero
// violations. For the recently corrected years (2021 corridor, 2022 courtyard
// corner passages, 2024 frontage) it captures top-down views with the engine
// prism overlay drawn over the studio's procedural geometry, plus obliques with
// the walkers mid-route. Build times go to lab-years.json. See app/lab/README.md.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { captureView, collectConsoleErrors, writeArtifact } from './helpers';
import { labFrames, openLab, type LabState } from './lab-helpers';

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
const CORRECTED = new Set([2021, 2022, 2024]);
/** One committed baseline per corrected year: top-down, engine prisms over the studio geometry. */
const BASELINES = new Set(['lab-year-2021-top-prisms', 'lab-year-2022-top-prisms', 'lab-year-2024-top-prisms']);
/**
 * Passage checks the engine data currently fails (see app/lab/README.md "Year walkabouts"). Asserted
 * as failing so a data fix shows up here; remove the entry when it passes.
 */
// W51: the 2022 south-west corner (kitchen / west-house = Chatsubo / Huaqiangbei) opened when its table went (Q1,
// RECONCILIATION_2022 §e) and the stairs turned parallel to the houses; nothing is known-blocked now.
const KNOWN_BLOCKED: Record<string, string> = {};

/** Mid-route oblique cameras [position, target]: eye-level down the 2021 corridor, the 2022 south-west
 *  corner passage from outside, along the 2024 frontage. */
const MID_CAM: Record<number, [number[], number[]]> = {
  2021: [[0.4, 2.4, 27], [0, 1.2, 0]],
  2022: [[-15, 11, 17], [-1.5, 0.5, 1.5]],
  2024: [[15, 4.5, 25], [-2, 1, 9]],
};

type Extra = { runScenario(name: string, o?: { paused?: boolean }): Promise<LabState>; backdropReady: boolean; scenarioHud(): string[] };
const run = (page: Page, name: string): Promise<LabState> => page.evaluate((n) => (window.__marsEngine as unknown as Extra).runScenario(n, { paused: true }), name);
const hud = (page: Page): Promise<string[]> => page.evaluate(() => (window.__marsEngine as unknown as Extra).scenarioHud());
const step = (page: Page, n: number): Promise<LabState> => page.evaluate((k) => window.__marsEngine!.step(k), n);
const toEnd = (page: Page): Promise<LabState> => page.evaluate(() => window.__marsEngine!.runToEnd());
const backdrop = (page: Page, timeout = 60_000) => page.waitForFunction(() => (window.__marsEngine as unknown as Extra).backdropReady, null, { timeout });

async function overlays(page: Page, names: string[]) {
  await page.evaluate((on) => {
    const e = window.__marsEngine!;
    for (const n of ['grid', 'routes', 'traffic', 'agents', 'obstacles', 'prisms', 'links', 'labels', 'violations', 'slots']) e.setOverlay(n, on.includes(n));
  }, names);
  await labFrames(page);
}

async function shot(page: Page, name: string, cam: 'top' | 'oblique' | [number[], number[]], names: string[], testInfo: TestInfo) {
  if (typeof cam === 'string') await page.evaluate((c) => window.__marsEngine!.cameraPreset(c), cam);
  else await page.evaluate(([p, t]) => window.__marsEngine!.camera(p, t), cam);
  await overlays(page, names);
  // a different scenario means the dev server reloaded the page (a file changed on disk mid-test)
  expect(await page.evaluate(() => window.__marsEngine!.state().scenario), 'page was not reloaded mid-test').toBe(/^lab-year-(\d+)/.exec(name)![0].slice(4));
  await captureView(page, name, { testInfo, compare: BASELINES.has(name) });
}

const summary: Record<string, unknown> = {};
test.afterAll(() => {
  if (Object.keys(summary).length) writeArtifact('lab-years.json', summary);
});

for (const year of YEARS) {
  const name = `year-${year}`;
  test(`lab ${name}: engine scene builds in the browser, 4 walkers complete, zero violations${CORRECTED.has(year) ? ', captures' : ''}`, async ({ page }, testInfo) => {
    test.setTimeout(year === 2026 ? 300_000 : 180_000);
    const errors = collectConsoleErrors(page);
    await openLab(page);
    await page.addStyleTag({ content: '.lab-perf, .lab-hud { visibility: hidden }' }); // timings vary per run
    await run(page, name);
    const lines = await hud(page);
    const build = Number(/build (\d+) ms/.exec(lines[1] ?? '')?.[1]);
    expect(build, `HUD reports the build time: ${lines.join(' | ')}`).toBeGreaterThan(0);
    const end = await toEnd(page);
    expect(end.done, 'finished within the tick budget').toBe(true);
    expect(end.humans).toHaveLength(4);
    expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
    const known: string[] = [];
    for (const c of end.checks) {
      const who = /^(w\d) passed/.exec(c.message)?.[1];
      const k = who && KNOWN_BLOCKED[`${name}:${who}`];
      if (k) {
        known.push(`${c.message} — ${k}`);
        expect(c.ok, `known issue now passes, remove it from KNOWN_BLOCKED: ${c.message}`).toBe(false);
      } else expect(c.ok, c.message).toBe(true);
    }
    if (known.length) testInfo.annotations.push(...known.map((description) => ({ type: 'known engine-data issue', description })));
    summary[name] = { hud: lines, ticks: end.tick, time: end.time, checks: end.checks, known };

    if (!CORRECTED.has(year)) {
      // one review capture (not a baseline): top-down with the prism overlay at the end
      await backdrop(page, year === 2026 ? 240_000 : 60_000);
      await shot(page, `lab-year-${year}-end-top-prisms`, 'top', ['prisms'], testInfo);
      expect(errors, 'console/page errors').toEqual([]);
      return;
    }
    // deterministic replay, paused mid-route
    await run(page, name);
    const mid = Math.round(end.tick * 0.4);
    await step(page, mid);
    await backdrop(page);
    await shot(page, `lab-year-${year}-top`, 'top', [], testInfo);
    await shot(page, `lab-year-${year}-top-prisms`, 'top', ['prisms'], testInfo);
    await shot(page, `lab-year-${year}-top-grid`, 'top', ['grid', 'agents'], testInfo);
    await shot(page, `lab-year-${year}-mid-oblique`, 'oblique', [], testInfo);
    await shot(page, `lab-year-${year}-mid-close`, MID_CAM[year], [], testInfo);
    await shot(page, `lab-year-${year}-mid-close-prisms`, MID_CAM[year], ['prisms', 'routes', 'agents'], testInfo);
    const replay = await toEnd(page);
    // a different scenario here means the dev server reloaded the page mid-test (a file changed on disk)
    expect(replay.scenario, 'page was not reloaded mid-test').toBe(name);
    expect(replay.tick, 'replay reaches the same end tick').toBe(end.tick);
    expect(replay.humans).toEqual(end.humans);
    expect(errors, 'console/page errors').toEqual([]);
  });
}
