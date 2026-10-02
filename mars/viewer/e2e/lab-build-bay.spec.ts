// Engine Lab: the flagship build-a-rack-bay sequence (app/lab/build-bay.ts)
// stepped live in the browser. Completes with zero violations, reproduces the
// node rehearsal's final state hash exactly, geometry sanity (beams between
// the columns, joists on beams, ply on joists, stair top at the deck edge),
// captures at the key moments (oblique + top) and a 2x video of raise + beams.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import path from 'node:path';
import { ARTIFACTS, captureView, collectConsoleErrors, recordVideo, writeArtifact } from './helpers';
import { labFrames, openLab, type LabComponent, type LabState } from './lab-helpers';
import { WorldHistory } from '../engine/history/store.ts';
import { Spatial } from '../engine/spatial/service.ts';
import { emptyWorld, addAll } from '../engine/world/factory.ts';
import { bindTemplate } from '../engine/sequence/bind.ts';
import { rehearse } from '../engine/rehearsal/rehearse.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS } from '../engine/scenarios/build-bay.ts';
import { buildBayGround, BUILD_BAY_MOMENTS, BUILD_BAY_RULES, BUILD_BAY_SITE } from '../app/lab/build-bay.ts';

/** Committed baselines (3 representative shots: mid-raise, both frames held, visitor on the deck). */
const BASELINES = new Set(['build-bay-raise-oblique', 'build-bay-held-oblique', 'build-bay-visitor-oblique']);

/** Close cameras on the bay (site origin = upright A's base, bay along +z to 2.74 m, stair on +x). */
const CAM = {
  oblique: { pos: [7.2, 4.6, -4.2], target: [0.6, 1.0, 1.4] },
  top: { pos: [0.8, 13, 1.41], target: [0.8, 0, 1.4] },
};

type Cams = Record<'oblique' | 'top', { pos: number[]; target: number[] }>;
/** The same framing, re-centred on a point (x, z). */
const around = (x: number, z: number): Cams => ({
  oblique: { pos: [x + 5.5, 3.6, z - 4.5], target: [x, 0.9, z] },
  top: { pos: [x, 11, z + 0.01], target: [x, 0, z] },
});

async function shoot(page: Page, name: string, testInfo: TestInfo, cams: Cams = CAM) {
  for (const cam of ['oblique', 'top'] as const) {
    await page.evaluate(([p, t]) => window.__marsEngine!.camera(p, t), [cams[cam].pos, cams[cam].target]);
    const labels = cam === 'top';
    await page.evaluate((on) => {
      window.__marsEngine!.setOverlay('agents', on);
      window.__marsEngine!.setOverlay('labels', on);
    }, labels);
    await labFrames(page);
    const n = `build-bay-${name}-${cam}`;
    await captureView(page, n, { testInfo, softVisual: true, compare: BASELINES.has(n) });
  }
}

function rehearsalHash() {
  const h = new WorldHistory(BUILD_BAY_RULES);
  h.publishCanonical('canon', 'open ground', addAll(emptyWorld('open-ground', buildBayGround()), ...buildBayEntities(BUILD_BAY_SITE)), 'e2e');
  h.fork('canon', 'ws', 'ws');
  const plan = bindTemplate(buildBayTemplate(BUILD_BAY_SITE), buildBayBindings, { history: h, baseline: 'ws', registry: buildBayRegistry() });
  const r = rehearse(h, 'ws', plan, {
    registry: buildBayRegistry(),
    invariants: BUILD_BAY_INVARIANTS,
    services: () => ({ spatial: new Spatial(buildBayGround(), { contributors: BUILD_BAY_CONTRIBUTORS }) }),
  });
  return { hash: r.take.finalStateHash, ticks: r.take.ticks, status: r.report.status };
}

const byId = (cs: LabComponent[]) => Object.fromEntries(cs.map((c) => [c.id, c]));
const span = (c: LabComponent, k: 0 | 1 | 2) => [Math.min(...c.corners.map((p) => p[k])), Math.max(...c.corners.map((p) => p[k]))];

test('lab build-bay: flagship sequence live, zero violations, rehearsal hash, key-moment captures', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors = collectConsoleErrors(page);
  await openLab(page, 'build-bay');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('build-bay', { paused: true }));
  const shotsAt: Record<string, number> = {};
  const moments: [string, readonly string[]][] = [
    ['held', BUILD_BAY_MOMENTS.held],
    ['beams', BUILD_BAY_MOMENTS.beams],
    ['joists', BUILD_BAY_MOMENTS.joists],
    ['deck', BUILD_BAY_MOMENTS.deck],
    ['stair', BUILD_BAY_MOMENTS.stair],
  ];
  // an early carry moment for the formation visuals
  const carry = await page.evaluate(() => window.__marsEngine!.runUntilSteps(['carry_b1'], 'executing'));
  expect(carry.reached).toBe(true);
  await page.evaluate(() => {
    const e = window.__marsEngine!;
    for (let i = 0; i < 400 && e.state().humans.filter((h) => h.activity === 'carry').length < 2; i++) e.step(1);
    e.step(30);
  });
  const crew = (await page.evaluate(() => window.__marsEngine!.state())).humans.filter((h) => h.activity === 'carry');
  expect(crew.length, 'a carrying crew').toBeGreaterThanOrEqual(2);
  const cx = crew.reduce((a, h) => a + h.p[0], 0) / crew.length, cz = crew.reduce((a, h) => a + h.p[2], 0) / crew.length;
  await shoot(page, 'carry', testInfo, around(cx, cz));
  // mid-raise: A pitched about 45 degrees, crew lifting it about its base line
  await page.evaluate(() => {
    const e = window.__marsEngine!;
    e.runUntilSteps(['raiseA'], 'executing');
    const pitch = () => e.components().find((c) => c.id === 'A')!.pose.pitch ?? 0;
    for (let i = 0; i < 2000 && pitch() > Math.PI / 4; i++) e.step(1);
  });
  const midRaise = byId(await page.evaluate(() => window.__marsEngine!.components())).A;
  expect(midRaise.pose.pitch!, 'A part-raised').toBeGreaterThan(0.5);
  expect(midRaise.support).toBe('held');
  await labFrames(page);
  // side-on to the raising plane (y-z), so the pitch reads directly
  await shoot(page, 'raise', testInfo, { oblique: { pos: [7.5, 2.2, -1.6], target: [0, 1.3, -1.2] }, top: CAM.top });
  for (const [name, ids] of moments) {
    const st = await page.evaluate((x) => window.__marsEngine!.runUntilSteps(x as string[]), ids as string[]);
    expect(st.reached, `${name}: steps ${ids.join(', ')} completed (tick ${st.tick})`).toBe(true);
    expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
    shotsAt[name] = st.tick;
    if (name === 'held') {
      // both frames standing, each held by its crew in 'support'
      const cs = byId(await page.evaluate(() => window.__marsEngine!.components()));
      for (const u of ['A', 'B']) {
        expect(Math.abs(cs[u].pose.pitch ?? 0), `${u} upright`).toBeLessThan(1e-6);
        expect(cs[u].support, `${u} held`).toBe('held');
      }
      const acts = st.humans.filter((h) => ['p1', 'p2', 'p3', 'p4'].includes(h.id)).map((h) => h.activity);
      expect(acts).toEqual(['support', 'support', 'support', 'support']);
    }
    await labFrames(page);
    await shoot(page, name, testInfo);
  }
  const end: LabState = await page.evaluate(() => window.__marsEngine!.runToEnd(20 * 60 * 20));
  expect(end.done).toBe(true);
  for (const c of end.checks) expect(c.ok, c.message).toBe(true);
  expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  const visitor = end.humans.find((h) => h.id === 'visitor')!;
  expect(visitor.level).toBe(4);
  shotsAt.visitor = end.tick;
  await labFrames(page);
  await shoot(page, 'visitor', testInfo);

  // geometry sanity from engine corners (what the renderer draws; rendered bounds compared too)
  const cs = byId(await page.evaluate(() => window.__marsEngine!.components()));
  const [ax0, ax1] = span(cs.A, 0);
  for (const b of ['b1', 'b2', 'b3', 'b4']) {
    const [z0, z1] = span(cs[b], 2);
    expect(z0, `${b} starts at column A face`).toBeGreaterThan(-0.2);
    expect(z1, `${b} ends at column B`).toBeLessThan(2.95);
    const [x0, x1] = span(cs[b], 0);
    expect(x0 >= ax0 - 0.12 && x1 <= ax1 + 0.12, `${b} at a column line`).toBe(true);
  }
  const beamTop = Math.max(...['b3', 'b4'].map((b) => span(cs[b], 1)[1]));
  for (const j of ['j1', 'j2', 'j3', 'j4', 'j5']) expect(Math.abs(span(cs[j], 1)[0] - beamTop), `${j} bottom on the upper beams`).toBeLessThan(0.01);
  const joistTop = Math.max(...['j1', 'j2', 'j3', 'j4', 'j5'].map((j) => span(cs[j], 1)[1]));
  for (const s of ['s1', 's2']) expect(Math.abs(span(cs[s], 1)[0] - joistTop), `${s} bottom on the joists`).toBeLessThan(0.01);
  const deckTop = span(cs.s1, 1)[1];
  expect(Math.abs(visitor.p[1] - deckTop), 'visitor stands on the ply').toBeLessThan(0.02);
  const [, stTop] = span(cs.st, 1);
  expect(Math.abs(stTop - deckTop), 'stair flight top at deck height').toBeLessThan(0.1);
  expect(Math.abs(span(cs.st, 0)[0] - span(cs.s1, 0)[1]), 'stair flight meets the deck edge').toBeLessThan(0.2);
  for (const c of Object.values(cs)) {
    if (!c.rendered) continue;
    for (const k of [0, 1, 2] as const) {
      const [lo, hi] = span(c, k);
      expect(c.rendered.min[k], `${c.id} rendered min[${k}]`).toBeGreaterThan(lo - 0.02);
      expect(c.rendered.max[k], `${c.id} rendered max[${k}]`).toBeLessThan(hi + 0.02);
    }
  }

  // live stepping == SequenceRunner.run() in the node rehearsal
  const labHash = await page.evaluate(() => window.__marsEngine!.stateHash());
  const reh = rehearsalHash();
  expect(reh.status).toBe('completed');
  expect(end.tick, 'lab ends on the rehearsal tick').toBe(reh.ticks);
  expect(labHash, 'lab final state == rehearsal final state').toBe(reh.hash);

  const seq = await page.evaluate(() => window.__marsEngine!.sequence());
  const blocked = seq.diagnostics.filter((d) => d.level === 'warn');
  writeArtifact('build-bay-summary.json', {
    ticks: end.tick,
    simulatedSeconds: end.tick / 20,
    shotsAt,
    rehearsalHash: reh.hash,
    steps: seq.steps!.map((s) => ({ id: s.id, start: s.start, end: s.end, blockedTicks: s.blockedTicks })),
    blocked: blocked.map((d) => `${d.tick} ${d.text}`),
  });
  // blocked waits (traffic.person, carry.setdown-occupied, …) must be visible in the HUD log when they occur
  for (const s of seq.steps!) if (s.blockedTicks > 0) expect(blocked.some((d) => d.text.includes(s.id)), `blocked wait of ${s.id} logged`).toBe(true);
  expect(errors, 'console/page errors').toEqual([]);
});

test('lab build-bay: 2x video of raise + beams', async ({ browser }) => {
  test.setTimeout(420_000);
  const context = await recordVideo(browser, 'build-bay-raise-beams');
  const page = await context.newPage();
  await openLab(page, 'build-bay');
  await page.evaluate(() => window.__marsEngine!.runScenario('build-bay', { paused: true }));
  // raiseA starts as soon as carry_b4 is done (carryB is still under way)
  const st = await page.evaluate(() => window.__marsEngine!.runUntilSteps(['carry_b4']));
  expect(st.reached).toBe(true);
  await page.evaluate(([p, t]) => {
    const e = window.__marsEngine!;
    e.camera(p, t);
    e.setOverlay('labels', true);
    e.setSpeed(2);
    e.pause(false);
  }, [CAM.oblique.pos, CAM.oblique.target]);
  await page.waitForFunction(() => window.__marsEngine!.sequence().steps!.find((s) => s.id === 'releaseB')!.status === 'completed', null, { timeout: 360_000, polling: 500 });
  await page.evaluate(() => window.__marsEngine!.pause(true));
  expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  const video = page.video()!;
  await context.close();
  await video.saveAs(path.join(ARTIFACTS, 'build-bay-raise-beams-2x.webm'));
  await video.delete(); // keep only the named copy
});
