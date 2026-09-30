// Lab preset "2022 east-house: skeleton from piles" (app/lab/year-build.ts, YEAR_BUILD.md): the year-build
// phase A first bay stepped live in the browser — completes, zero violations, every sequenced frame / beam
// at the canonical pose (≤ 1 cm), final state = the node rehearsal's (tick count and state hash) —
// with the rack-structure poses checked while it runs (POSES.md "Rack structure"): people on a frame
// stance have both soles on its bracing node, climbers' planted feet are on their rungs, renderer holds
// (frame / balance) are reached, engine hand points reached per activity (reach-honest: no arm longer
// than its bones). Captures: the pile yard at t0 (+ top), a frame raise, a climb, a middle beam handed up
// to installers on the bracing (2.48 m seat), the relay for a top beam (4.76 m seat: givers → relay,
// relay → installers), the finished first bay and an eye-level view from the yard side to compare with
// the owner's skeleton-stage photo (docs/engineering/evidence/2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg).
// Historical completion captures below remain parked after W51. YEAR_BUILD_FULL=1 removes
// the cost-based skip only; it does not override their unconditional reconciliation fixme.
// The current-source support audit below is mandatory even while those captures are parked.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { labFrames, openLab } from './lab-helpers';
import { ARTIFACTS, captureView } from './helpers';
import { loadCampusFile } from '../engine/campus/history-node.ts';
import { yearBuildSetup, yearBuildSupportDiagnostic } from '../engine/scenarios/year-build.ts';
import { rehearse } from '../engine/rehearsal/rehearse.ts';
const W51_FIXME = '2022 reconciliation W51: mars-2022 re-seeded (houses, stairs, solar, trailers moved); the recorded 2022 takes / pins no longer match it — re-record parked with the content (OWNER_DECISIONS 2026-09-29 evening; RECONCILIATION_2022.md)';

test('current 2022 east-house source: first bay and whole house disclose physical staging exclusions', () => {
  // This audit deliberately runs regardless of YEAR_BUILD_FULL and the historical capture FIXMEs.
  for (const bays of [1, undefined]) {
    const setup = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { bays });
    const diagnostic = yearBuildSupportDiagnostic(setup.build);
    expect(diagnostic?.code).toBe('year-build.unsupported');
    expect(diagnostic?.subjects).toHaveLength(bays ? 3 : 9);
    expect(diagnostic?.message).toContain('chiba-12-foot-orange-beam-0684c6e5');
    expect(diagnostic?.message).toContain('kitchen-12-foot-orange-beam-11ad38b2');
    for (const id of diagnostic!.subjects!) {
      expect(setup.plan.steps.filter((step) => step.params.piece === id || step.params.item === id || step.params.beam === id), id).toEqual([]);
    }
  }
});

/**
 * The node rehearsal of the same setup (engine/test/year-build.test.ts pins it: first bay 41 019 ticks
 * `ad844b78…`, whole house 116 477 `14d5c768…` at 36aa230) — computed here so an engine re-pin moves both.
 */
function rehearsal(bays?: number) {
  const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { bays });
  const r = rehearse(s.history, s.workspace, s.plan, s.cfg);
  return { ticks: r.report.metrics.ticks, hash: r.report.finalStateHash };
}

type YB = {
  admission: { code: string; message: string; subjects?: string[] } | null;
  bays: number | null;
  setupMs: number;
  fetchMs: number;
  centre: [number, number];
  steps: { id: string; verb: string; beam: string | null; item: string | null; height: number | null; relay: boolean }[];
  piles: { id: string; def: string; p: number[]; yaw: number; count: number | null }[];
  compare: { n: number; ok: number; maxMm: number };
  unplaced: Record<string, number>;
  blocked: { code: string; n: number; first: string }[];
};
type Row = { id: string; verb: string; status: string; phase?: string };
type Arm = { side: string; shoulder: number[]; palm: number[]; len: number; source: string | null; err: number | null; ratio: number | null };
type Bone = { activity: string; on: string | null; soles: number[]; arms: Arm[]; frame: { kind: string; u: number; exit: number; weight: number; feet: { p: number[]; planted: boolean }[] | null } | null };
type H = {
  records(): unknown[];
  yearBuild(): YB | null;
  sequence(): { steps: Row[] | null };
  step(n: number): { tick: number; done: boolean };
  runToEnd(max: number): { tick: number; done: boolean };
  stateHash(): string;
  state(): { tick: number; time: number; done: boolean; humans: { id: string; p: number[]; yaw: number; activity: string; level: number }[]; checks: { ok: boolean; message: string }[] };
  components(): { id: string; def: string; phase?: string; support?: string; pose: { p: number[]; yaw: number; pitch?: number; roll?: number } }[];
  camera(pos: number[], target: number[]): void;
  bones(): Record<string, Bone>;
  stacks(): { id: string; def: string; count: number; top: number | null }[];
};
/** Pose statistics over the checked ticks. */
type Stats = { ticks: number; stance: number; stanceOff: string[]; ladder: number; ladderOff: string[]; holds: number; holdsReached: number; holdMiss: string[]; points: number; reached: number; reachableMiss: string[]; byAct: Record<string, [number, number]>; over: string[]; kinds: Record<string, number> };
const newStats = (): Stats => ({ ticks: 0, stance: 0, stanceOff: [], ladder: 0, ladderOff: [], holds: 0, holdsReached: 0, holdMiss: [], points: 0, reached: 0, reachableMiss: [], byAct: {}, over: [], kinds: {} });

for (const [scenario, missing] of [['year-build-2022', 3], ['year-build-2022-house', 9]] as const) {
  test(`${scenario}: current unsupported layout refuses Play, Step and Reset before physical actions`, async ({ page }, testInfo) => {
    await openLab(page, scenario);
    await page.evaluate((name) => (window.__marsEngine as unknown as { runScenario(n: string, o: object): Promise<unknown> }).runScenario(name, { paused: true }), scenario);
    const initial = await page.evaluate(() => {
      const h = window.__marsEngine as unknown as H;
      return { humans: h.state().humans, components: h.components() };
    });
    const assertRefusal = async (control: string) => {
      const result = await page.evaluate(() => {
        const h = window.__marsEngine as unknown as H;
        return { physical: { humans: h.state().humans, components: h.components() }, admission: h.yearBuild()!.admission, records: h.records(), state: h.state(), rows: h.sequence().steps, violations: window.__marsEngine!.violations() };
      });
      expect(result.admission?.code, control).toBe('year-build.unsupported');
      expect(result.admission?.subjects, control).toHaveLength(missing);
      expect(result.admission?.message).toContain('chiba-12-foot-orange-beam-0684c6e5');
      expect(result.admission?.message).toContain('kitchen-12-foot-orange-beam-11ad38b2');
      expect(result.records, control).toEqual([]);
      expect(result.rows!.every((row) => row.status === 'pending'), control).toBe(true);
      expect(result.physical, control).toEqual(initial);
      expect(result.state.done, control).toBe(true);
      expect(result.state.checks.some((check) => !check.ok && check.message.includes('unsupported')), control).toBe(true);
      expect(result.violations, control).toEqual([]);
    };
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await labFrames(page);
    await assertRefusal('Play');
    await page.getByRole('button', { name: 'Step', exact: true }).click();
    await assertRefusal('Step');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await labFrames(page);
    await assertRefusal('Reset');
    await captureView(page, `${scenario}-current-unsupported`, { testInfo, compare: false });
  });
}

test('exact pre-W51 historical source: whole skeleton completes live, all 66 parts supported and crew clear, unchanged pin', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const source = execFileSync('git', ['show', 'a0c347e0374b473876c97f536dc44dba42399521:viewer/public/engine/campus-2022.json'], { encoding: 'utf8' });
  expect(JSON.parse(source).contentHash).toBe('8b88e6f090c79b92784954787f0329295286d5b6f5e76f0d9d450023da8c49f2');
  await page.route('**/engine/campus-2022.json', (route) => route.fulfill({ contentType: 'application/json', body: source }));
  await openLab(page, 'year-build-2022-house');
  await page.evaluate(() => (window.__marsEngine as unknown as { runScenario(n: string, o: object): Promise<unknown> }).runScenario('year-build-2022-house', { paused: true }));
  expect((await yb(page)).admission).toBeNull();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.__marsEngine!.state().tick > 0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // Yield between bounded tick batches so the UI/browser stays responsive throughout the full build.
  let done = false;
  for (let chunk = 0; chunk < 240 && !done; chunk++) {
    done = await page.evaluate(() => (window.__marsEngine as unknown as H).runToEnd(500).done);
  }
  expect(done, 'historical skeleton finished within 120000 ticks').toBe(true);
  const result = await page.evaluate(() => {
    const h = window.__marsEngine as unknown as H;
    return { state: h.state(), hash: h.stateHash(), yb: h.yearBuild()!, components: h.components(), rows: h.sequence().steps!, bones: h.bones(), violations: window.__marsEngine!.violations() };
  });
  expect(result.state.tick).toBe(117277);
  expect(result.hash).toBe('d382e4614e8ae157ad971ab7a4cb2b922c4737197006b39b4a209dc0db040617');
  expect(result.yb.compare.n).toBe(66);
  expect(result.yb.compare.ok).toBe(66);
  expect(result.rows.every((row) => row.status === 'completed')).toBe(true);
  expect(result.violations).toEqual([]);
  expect(result.components.every((component) => component.phase === 'installed' && component.support !== 'held')).toBe(true);
  expect(Object.values(result.bones).every((bone) => !bone.on)).toBe(true);
  for (const check of result.state.checks) expect(check.ok, check.message).toBe(true);
  await look(page, [result.yb.centre[0] + 17, 11, result.yb.centre[1] + 18], [result.yb.centre[0], 2.4, result.yb.centre[1]]);
  await captureView(page, 'year-build-historical-supported-whole', { testInfo, compare: false });
});

async function yb(page: Page): Promise<YB> {
  return page.evaluate(() => (window.__marsEngine as unknown as H).yearBuild()!);
}

/**
 * Step one tick at a time until step `id` is executing in `phase` (or has `status`), checking the rack
 * poses every `every` ticks into `acc`. Returns the tick, or null if the run ended first.
 */
async function until(page: Page, id: string, want: { phase?: string; status?: string }, acc: Stats, every = 3, max = 20 * 3000) {
  const r = await page.evaluate(
    ([id, want, acc, every, max]) => {
      const h = window.__marsEngine as unknown as H;
      const a = acc as Stats;
      const w = want as { phase?: string; status?: string };
      const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      for (let i = 0; i < (max as number); i++) {
        const row = h.sequence().steps!.find((s) => s.id === id)!;
        if (w.phase ? row.phase === w.phase && row.status === 'executing' : row.status === w.status) return { tick: h.state().tick, acc: a };
        const st = h.step(1);
        if (st.done) return { tick: null, acc: a };
        if (st.tick % (every as number)) continue;
        a.ticks++;
        for (const [pid, b] of Object.entries(h.bones())) {
          for (const arm of b.arms) {
            if (d(arm.shoulder, arm.palm) > arm.len + 0.005) a.over.push(`${st.tick} ${pid} ${arm.side}`);
            if (arm.source === 'frame' && b.frame && b.frame.weight >= 1) {
              a.holds++;
              if (arm.err! <= 0.1) a.holdsReached++;
              else if (a.holdMiss.length < 20) a.holdMiss.push(`${st.tick} ${pid} ${b.frame.kind} ${arm.side} err ${arm.err} ratio ${arm.ratio}`);
            }
            if (arm.source !== 'hands') continue;
            a.points++;
            const ok = arm.err! <= 0.1;
            if (ok) a.reached++;
            a.byAct[b.activity] ??= [0, 0];
            a.byAct[b.activity][0]++;
            if (ok) a.byAct[b.activity][1]++;
            if (!ok && arm.ratio! <= 1.0 && a.reachableMiss.length < 30) a.reachableMiss.push(`${st.tick} ${pid} ${b.activity} ${arm.side} err ${arm.err} ratio ${arm.ratio}`);
          }
          const f = b.frame;
          if (!f) continue;
          a.kinds[`${f.kind}:${b.activity}`] = (a.kinds[`${f.kind}:${b.activity}`] ?? 0) + 1;
          if (!f.feet || f.weight < 1) continue;
          // soles (left first) against the planned soles; planted feet only
          f.feet.forEach((ft, k) => {
            if (!ft.planted) return;
            const off = Math.abs(b.soles[k] - ft.p[1]);
            if (f.kind === 'stance') {
              a.stance++;
              if (off > 0.03 && a.stanceOff.length < 20) a.stanceOff.push(`${st.tick} ${pid} ${b.activity} sole ${b.soles[k]} node ${ft.p[1]}`);
            } else {
              a.ladder++;
              if (off > 0.03 && a.ladderOff.length < 20) a.ladderOff.push(`${st.tick} ${pid} u ${f.u} sole ${b.soles[k]} rung ${ft.p[1]}`);
            }
          });
        }
      }
      return { tick: null, acc: a };
    },
    [id, want, acc, every, max] as const,
  );
  Object.assign(acc, r.acc);
  return r.tick;
}

async function look(page: Page, pos: number[], target: number[]) {
  await page.evaluate(([p, t]) => (window.__marsEngine as unknown as H).camera(p, t), [pos, target] as const);
  await labFrames(page, 4);
}

/** Camera `d` m from point `c` on the side `yaw` (rad, engine x/z), `y` m up, looking at c at height ty. */
function around(c: number[], yaw: number, d: number, y: number, ty: number): [number[], number[]] {
  return [[c[0] + Math.cos(yaw) * d, y, c[2] + Math.sin(yaw) * d], [c[0], ty, c[2]]];
}

const hud = (page: Page, on: boolean) => page.evaluate((v) => document.querySelectorAll<HTMLElement>('.lab-hud').forEach((e) => (e.style.visibility = v ? '' : 'hidden')), on);
const comps = (page: Page) => page.evaluate(() => (window.__marsEngine as unknown as H).components());
const humans = async (page: Page) => (await page.evaluate(() => (window.__marsEngine as unknown as H).state())).humans;

test('year-build 2022 east-house (first bay): live = rehearsal pin, rack poses on the bracing, captures', async ({ page }, testInfo) => {
  test.fixme(true, W51_FIXME);
  test.setTimeout(1_800_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openLab(page, 'year-build-2022');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  const t0 = Date.now();
  await page.evaluate(() => (window.__marsEngine as unknown as { runScenario(n: string, o: object): Promise<unknown> }).runScenario('year-build-2022', { paused: true }));
  const loadMs = Date.now() - t0;
  const info = await yb(page);
  console.log(`[year-build] load ${loadMs} ms (fetch ${info.fetchMs} ms, setup ${info.setupMs} ms): ${info.steps.length} steps, ${info.compare.n} parts, piles ${info.piles.map((p) => `${p.def}×${p.count}`).join(', ')}; unplaced ${JSON.stringify(info.unplaced)}`);
  expect(info.steps.length).toBe(198);
  expect(info.compare.n).toBe(24);
  const acc = newStats();

  // t0: the pile yard, from the building side, and the site from above
  const ps = info.piles.map((p) => p.p);
  const yard = [ps.reduce((s, p) => s + p[0], 0) / ps.length, 0, ps.reduce((s, p) => s + p[2], 0) / ps.length];
  const c = [info.centre[0], 0, info.centre[1]];
  const away = Math.atan2(yard[2] - c[2], yard[0] - c[0]);
  const stacks = await page.evaluate(() => (window.__marsEngine as unknown as H).stacks());
  console.log(`[year-build] stacks drawn: ${stacks.map((s) => `${s.id} ${s.count} top ${s.top}`).join(', ')}`);
  for (const s of stacks) expect(s.count, s.id).toBe(info.piles.find((p) => p.id === s.id)!.count);
  await look(page, ...around(yard, away + Math.PI * 0.8, 14, 6, 0.4));
  await captureView(page, 'year-build-t0-yard', { testInfo, compare: false });
  await look(page, [c[0] + 0.01, 45, c[2]], [c[0], 0, c[2]]);
  await captureView(page, 'year-build-t0-top', { testInfo, compare: false });

  // a frame raise, part way up
  const raise = info.steps.find((s) => s.verb === 'raise_upright')!;
  expect(await until(page, raise.id, { phase: 'raise' }, acc)).not.toBeNull();
  await page.evaluate(() => (window.__marsEngine as unknown as H).step(40));
  const up = (await comps(page)).find((q) => q.id === raise.item)!;
  console.log(`[year-build] raise ${raise.id} (${raise.item}) pitch ${(up.pose.pitch ?? 0).toFixed(2)} roll ${(up.pose.roll ?? 0).toFixed(2)}`);
  await look(page, ...around(up.pose.p, up.pose.yaw + Math.PI / 2 + 0.9, 11, 3.5, 1.4));
  await captureView(page, 'year-build-raise', { testInfo, compare: false });

  // a climb onto a frame stance (the installers of the first middle beam), mid-way up
  const climb = info.steps.find((s) => s.verb === 'climb_stance')!;
  expect(await until(page, climb.id, { phase: 'climb' }, acc)).not.toBeNull();
  await page.evaluate(() => (window.__marsEngine as unknown as H).step(12));
  const who = (await humans(page)).find((q) => q.activity === 'climb-up')!;
  const fr = (await comps(page)).find((q) => q.id === climb.item)!;
  // in profile: along the frame plane, from outside the column the climber is beside
  const ex = [Math.cos(fr.pose.yaw), Math.sin(fr.pose.yaw)], out = (who.p[0] - fr.pose.p[0]) * ex[0] + (who.p[2] - fr.pose.p[2]) * ex[1] >= 0 ? 1 : -1;
  await hud(page, false);
  await look(page, [who.p[0] + ex[0] * out * 3.4 + ex[1] * 1.2, who.p[1] + 1.5, who.p[2] + ex[1] * out * 3.4 - ex[0] * 1.2], [who.p[0], who.p[1] + 0.9, who.p[2]]);
  await captureView(page, 'year-build-climb', { testInfo, compare: false });
  await hud(page, true);

  // a middle beam (2.48 m) handed up by two givers to two installers on the bracing (0.91 m)
  const mid = info.steps.find((s) => s.verb === 'hang_beam' && s.height !== null && Math.abs(s.height - 2.48) < 0.01 && !s.relay)!;
  expect(await until(page, mid.id, { phase: 'take-hook' }, acc)).not.toBeNull();
  await page.evaluate(() => (window.__marsEngine as unknown as H).step(4));
  let beam = (await comps(page)).find((q) => q.id === mid.beam)!;
  let hs = await humans(page);
  console.log(`[year-build] hand-up ${mid.id} beam ${mid.beam} at y ${beam.pose.p[1].toFixed(2)}: ${hs.filter((q) => q.activity !== 'idle').map((q) => `${q.id}:${q.activity}@${q.p[1].toFixed(2)}`).join(' ')}`);
  await hud(page, false);
  await look(page, ...around(beam.pose.p, beam.pose.yaw + Math.PI / 2 + 0.35, 7.5, 2.4, 1.6));
  await captureView(page, 'year-build-handup-248', { testInfo });
  await hud(page, true);

  // a top beam (4.76 m) through the relay: givers → relay (take-relay), relay → installers (take-hook)
  const top = info.steps.find((s) => s.verb === 'hang_beam' && s.relay)!;
  expect(await until(page, top.id, { phase: 'take-relay' }, acc)).not.toBeNull();
  await page.evaluate(() => (window.__marsEngine as unknown as H).step(4));
  beam = (await comps(page)).find((q) => q.id === top.beam)!;
  await hud(page, false);
  await look(page, ...around(beam.pose.p, beam.pose.yaw + Math.PI / 2 + 0.35, 9, 2.6, 2.1));
  await captureView(page, 'year-build-relay-give', { testInfo, compare: false });
  expect(await until(page, top.id, { phase: 'take-hook' }, acc)).not.toBeNull();
  await page.evaluate(() => (window.__marsEngine as unknown as H).step(4));
  beam = (await comps(page)).find((q) => q.id === top.beam)!;
  hs = await humans(page);
  console.log(`[year-build] relay ${top.id} beam ${top.beam} at y ${beam.pose.p[1].toFixed(2)}: ${hs.filter((q) => q.activity !== 'idle').map((q) => `${q.id}:${q.activity}@${q.p[1].toFixed(2)}`).join(' ')}`);
  await look(page, ...around(beam.pose.p, beam.pose.yaw + Math.PI / 2 + 0.35, 10.5, 3.2, 2.8));
  await captureView(page, 'year-build-relay-476', { testInfo, compare: false });
  await hud(page, true);

  // the rest, checked, to the end (runToEnd stops at `done`; step(n) would tick on past it)
  const t1 = Date.now();
  const last = info.steps[info.steps.length - 1];
  await until(page, last.id, { status: 'completed' }, acc, 3, 20 * 3000);
  await page.evaluate(() => (window.__marsEngine as unknown as H).runToEnd(20 * 600));
  const runMs = Date.now() - t1;
  const fin = await page.evaluate(() => (window.__marsEngine as unknown as H).state());
  const hash = await page.evaluate(() => (window.__marsEngine as unknown as H).stateHash());
  const end = await yb(page);
  const acts = Object.entries(acc.byAct).map(([k, [n, ok]]) => `${k} ${ok}/${n}`).join(', ');
  console.log(`[year-build] done at tick ${fin.tick} (${fin.time.toFixed(0)} s simulated), hash ${hash.slice(0, 12)}…; rest of the run ${runMs} ms wall (checked every 3rd tick); canonical ${end.compare.ok}/${end.compare.n} (max ${end.compare.maxMm} mm); blocked ${JSON.stringify(end.blocked)}`);
  console.log(`[year-build] poses over ${acc.ticks} checked ticks: layers ${JSON.stringify(acc.kinds)}; stance soles ${acc.stance} (off ${acc.stanceOff.length}), ladder planted soles ${acc.ladder} (off ${acc.ladderOff.length}), frame holds ${acc.holdsReached}/${acc.holds}; engine hand points ${acc.reached}/${acc.points} (${((100 * acc.reached) / Math.max(1, acc.points)).toFixed(1)} %), rig-reachable misses ${acc.reachableMiss.length}; by activity: ${acts}`);
  for (const l of [acc.stanceOff, acc.ladderOff, acc.holdMiss, acc.reachableMiss]) if (l.length) console.log(`[year-build]   ${l.slice(0, 6).join(' | ')}`);
  for (const ch of fin.checks) expect(ch.ok, ch.message).toBe(true);
  expect(end.compare.ok).toBe(end.compare.n);
  const reh = rehearsal(1);
  console.log(`[year-build] node rehearsal ${reh.ticks} ticks ${reh.hash.slice(0, 12)}…`);
  expect({ ticks: fin.tick, hash }, 'live stepping = the node rehearsal').toEqual(reh);
  expect(acc.over, 'no arm longer than its bones').toEqual([]);
  expect(acc.stanceOff, 'both soles on the bracing node on a stance').toEqual([]);
  expect(acc.ladderOff, 'planted feet on their rungs').toEqual([]);
  expect(acc.stance).toBeGreaterThan(100);
  expect(acc.ladder).toBeGreaterThan(100);

  const building = (await comps(page)).filter((q) => q.phase === 'installed');
  const bc = [building.reduce((a, q) => a + q.pose.p[0], 0) / building.length, 0, building.reduce((a, q) => a + q.pose.p[2], 0) / building.length];
  const fyaw = building.find((q) => q.def.startsWith('upright'))!.pose.yaw;
  await look(page, ...around(bc, fyaw + Math.PI / 2 + 0.5, 16, 7, 2.2));
  await captureView(page, 'year-build-skeleton', { testInfo });
  // eye level from the pile-yard side, facing the frames (the photo's framing: piles in the foreground)
  const side = Math.cos(away - (fyaw + Math.PI / 2)) >= 0 ? fyaw + Math.PI / 2 : fyaw - Math.PI / 2;
  await hud(page, false);
  await look(page, ...around(bc, side + 0.25, 15, 1.6, 2.6));
  await captureView(page, 'year-build-skeleton-eye', { testInfo, compare: false });
  fs.writeFileSync(path.join(ARTIFACTS, 'year-build.json'), JSON.stringify({ loadMs, runMs, tick: fin.tick, hash, info: { ...info, steps: info.steps.length }, end: { ...end, steps: end.steps.length }, poses: acc }, null, 2));
  expect(errors).toEqual([]);
});

test('year-build 2022 east-house, whole house (YEAR_BUILD_FULL=1): live = rehearsal pin, timed, skeleton captures', async ({ page }, testInfo) => {
  test.fixme(true, W51_FIXME);
  test.skip(process.env.YEAR_BUILD_FULL !== '1', 'whole house: set YEAR_BUILD_FULL=1');
  test.setTimeout(900_000);
  await openLab(page, 'year-build-2022-house');
  const t0 = Date.now();
  await page.evaluate(() => (window.__marsEngine as unknown as { runScenario(n: string, o: object): Promise<unknown> }).runScenario('year-build-2022-house', { paused: true }));
  const loadMs = Date.now() - t0;
  const r = await page.evaluate(() => {
    const h = window.__marsEngine as unknown as H;
    const t = performance.now();
    const s = h.runToEnd(20 * 60 * 240);
    return { tick: s.tick, ms: performance.now() - t, hash: h.stateHash(), yb: h.yearBuild()!, checks: h.state().checks };
  });
  console.log(`[year-build full] load ${loadMs} ms (setup ${r.yb.setupMs} ms), ${r.yb.steps.length} steps, ${r.tick} ticks in ${(r.ms / 1000).toFixed(1)} s wall (${((r.tick / 20) / (r.ms / 1000)).toFixed(0)}× real time); canonical ${r.yb.compare.ok}/${r.yb.compare.n} (max ${r.yb.compare.maxMm} mm); blocked / refused ${JSON.stringify(r.yb.blocked.map((b) => [b.code, b.n]))}`);
  // ambient make-way walks the engine submits for a person already reserved by a waiting step fail (reservation.conflict,
  // a red banner each); the sequence is unaffected (same hash as the rehearsal). Reported to the engine (PROGRESS W14).
  const failed = r.yb.blocked.filter((b) => b.code.startsWith('FAILED'));
  if (failed.length) console.log(`[year-build full] FAILED ambient actions: ${failed.map((b) => `${b.code} ×${b.n} (first: ${b.first})`).join('; ')}`);
  for (const ch of r.checks) expect(ch.ok, ch.message).toBe(true);
  expect({ ticks: r.tick, hash: r.hash }, 'live stepping = the node rehearsal').toEqual(rehearsal());
  // the finished skeleton: oblique, and eye level from the yard side (compare with the skeleton-stage photo)
  const building = (await comps(page)).filter((q) => q.phase === 'installed');
  const bc = [building.reduce((a, q) => a + q.pose.p[0], 0) / building.length, 0, building.reduce((a, q) => a + q.pose.p[2], 0) / building.length];
  const fyaw = building.find((q) => q.def.startsWith('upright'))!.pose.yaw;
  const ps = r.yb.piles.map((p) => p.p);
  const away = Math.atan2(ps.reduce((a, p) => a + p[2], 0) / Math.max(1, ps.length) - bc[2], ps.reduce((a, p) => a + p[0], 0) / Math.max(1, ps.length) - bc[0]);
  const side = Math.cos(away - (fyaw + Math.PI / 2)) >= 0 ? fyaw + Math.PI / 2 : fyaw - Math.PI / 2;
  await page.addStyleTag({ content: '.lab-perf, .lab-hud, .lab-banners { visibility: hidden }' });
  await look(page, ...around(bc, side + 0.6, 20, 9, 2.4));
  await captureView(page, 'year-build-house-oblique', { testInfo, compare: false });
  // eye level: the yard side is shut in by the neighbouring 2022 house, so also the other long side and the end
  for (const [name, yaw, d] of [['year-build-house-eye', side + 0.25, 19], ['year-build-house-eye-far', side + Math.PI - 0.25, 17], ['year-build-house-eye-end', fyaw + 0.2, 17]] as const) {
    await look(page, ...around(bc, yaw, d, 1.6, 2.8));
    await captureView(page, name, { testInfo, compare: false });
  }
});
