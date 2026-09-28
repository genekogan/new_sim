// Handling poses (owner feedback §5/§6, docs/engineering/POSES.md): crouch → stand with the load,
// reach up (givers) / reach down and take (receivers on the beams), hold low (raise footers).
// - hand-up (flagship v3, lab `hand-up`): runs to the end (all steps, zero violations); every tick,
//   every arm with an engine hand point (`human.hands`) whose shoulder is within the arm's length of it
//   has its palm within 0.1 m of the point and no arm is longer than its bones. The share of all
//   published hand points reached is logged per activity and held to a regression floor (88 %; 89.5 %
//   at b7c901a with the body-model arms, 63.3 % before them): what is still missed is beyond the
//   body — reach_up above 2.06 m, reach_down deeper than a kneeling body reaches (the engine allows
//   1.0 m below the feet; the rig 0.35–0.54 m, POSES.md "Body model"), the 0.6 s crouch still going
//   down — and those arms hang, honestly;
// - captures: pickup crouch and stand-with-load, the s1 hand-up moment (reach up below, reach down /
//   take above), a raise footer holding the column base low (lab `build-bay`).
import { test, expect, type Page } from '@playwright/test';
import { labFrames, openLab } from './lab-helpers';
import { captureView } from './helpers';

type Arm = { side: string; shoulder: number[]; palm: number[]; len: number; target: number[] | null; source: string | null; contact: number; err: number | null; ratio: number | null };
type Bones = Record<string, { activity: string; base: string; arms: Arm[]; pose: { drop: number; bend: number; rise: number } }>;
type Human = { id: string; p: number[]; yaw: number; activity: string };
type Stats = { ticks: number; points: number; reached: number; reachable: number; bad: string[]; over: string[]; byAct: Record<string, [number, number]>; maxDrop: number; maxBend: number; done: boolean; tick: number };

/** Step `n` ticks in the page, checking every arm against its target each tick; aggregates in `acc`. */
async function checkRun(page: Page, n: number, acc: Stats) {
  const r: Stats = await page.evaluate(
    ([n, acc]) => {
      const h = window.__marsEngine! as unknown as { step(n: number): { done: boolean; tick: number }; bones(): Bones };
      const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      for (let i = 0; i < (n as number); i++) {
        const st = h.step(1);
        acc.ticks++;
        acc.tick = st.tick;
        for (const [id, b] of Object.entries(h.bones())) {
          acc.maxDrop = Math.max(acc.maxDrop, b.pose.drop);
          acc.maxBend = Math.max(acc.maxBend, b.pose.bend);
          for (const a of b.arms) {
            if (d(a.shoulder, a.palm) > a.len + 0.005) acc.over.push(`${st.tick} ${id} ${a.side}`);
            if (a.source !== 'hands' || !a.target) continue;
            acc.points++;
            const ok = a.err! <= 0.1;
            if (ok) acc.reached++;
            const k = b.activity;
            acc.byAct[k] ??= [0, 0];
            acc.byAct[k][0]++;
            if (ok) acc.byAct[k][1]++;
            if (a.ratio! <= 1.0) {
              acc.reachable++;
              if (!ok && acc.bad.length < 50) acc.bad.push(`${st.tick} ${id} ${k} ${a.side} err ${a.err!.toFixed(3)} ratio ${a.ratio!.toFixed(2)}`);
            }
          }
        }
        if (st.done) {
          acc.done = true;
          break;
        }
      }
      return acc;
    },
    [n, acc] as const,
  );
  Object.assign(acc, r);
}

async function stepUntil(page: Page, pred: string, max = 20 * 900) {
  return page.evaluate(
    ([src, n]) => {
      const h = window.__marsEngine! as unknown as { step(n: number): unknown; state(): { humans: Human[] }; components(): { id: string; pose: { pitch?: number } }[] };
      const f = new Function('h', `return (${src})(h)`) as (h: unknown) => boolean;
      for (let i = 0; i < (n as number); i++) {
        if (f(h)) return true;
        h.step(1);
      }
      return f(h);
    },
    [pred, max] as const,
  );
}

/** Camera `dist` m from a person at `side` rad off their facing, `y` m above their feet, looking at `h`. */
async function near(page: Page, id: string, side: number, dist: number, y: number, h: number) {
  const st = await page.evaluate(() => window.__marsEngine!.state());
  const p = st.humans.find((q) => q.id === id)!;
  const a = p.yaw + side;
  await page.evaluate(([pos, t]) => window.__marsEngine!.camera(pos, t), [[p.p[0] + Math.cos(a) * dist, p.p[1] + y, p.p[2] + Math.sin(a) * dist], [p.p[0], p.p[1] + h, p.p[2]]]);
  await labFrames(page, 4);
  return p;
}

test('hand-up: rig-reachable hands on the engine hand points, arms never stretched', async ({ page }) => {
  test.setTimeout(900_000);
  await openLab(page, 'hand-up');
  await page.evaluate(() => window.__marsEngine!.runScenario('hand-up', { paused: true }));
  const acc: Stats = { ticks: 0, points: 0, reached: 0, reachable: 0, bad: [], over: [], byAct: {}, maxDrop: 0, maxBend: 0, done: false, tick: 0 };
  while (!acc.done && acc.ticks < 20 * 1200) await checkRun(page, 400, acc);
  const st = await page.evaluate(() => window.__marsEngine!.state());
  const acts = Object.entries(acc.byAct).map(([k, [n, ok]]) => `${k} ${ok}/${n}`).join(', ');
  console.log(`[poses] hand-up ${acc.ticks} ticks, hand points ${acc.points}, reached ≤ 0.1 m ${acc.reached} (${((100 * acc.reached) / Math.max(1, acc.points)).toFixed(1)} %), rig-reachable misses ${acc.bad.length}; by activity: ${acts}; max drop ${acc.maxDrop.toFixed(2)} m, max bend ${((acc.maxBend * 180) / Math.PI).toFixed(0)}°`);
  if (acc.bad.length) console.log(`[poses] misses: ${acc.bad.slice(0, 10).join(' | ')}`);
  for (const c of st.checks) expect(c.ok, c.message).toBe(true);
  expect(acc.over, 'no arm longer than its bones').toEqual([]);
  expect(acc.bad, 'every rig-reachable engine hand point is reached within 0.1 m').toEqual([]);
  expect(acc.reached / acc.points, 'share of engine hand points reached (regression floor)').toBeGreaterThanOrEqual(0.88);
});

test('hand-up: captures (crouch, stand with load, reach up / reach down)', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  await openLab(page, 'hand-up');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('hand-up', { paused: true }));
  // a joist giver crouching for the joist on the ground, then standing with it
  expect(await stepUntil(page, `(h) => h.state().humans.some((q) => q.activity === 'crouch')`)).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(10));
  const giver = (await page.evaluate(() => window.__marsEngine!.state())).humans.find((q) => q.activity === 'crouch' || q.activity === 'lift')!;
  await near(page, giver.id, 1.3, 2.6, 1.2, 0.6);
  await captureView(page, 'poses-pickup-crouch', { testInfo });
  expect(await stepUntil(page, `(h) => h.state().humans.some((q) => q.id === '${giver.id}' && q.activity !== 'crouch' && q.activity !== 'lift')`)).toBe(true);
  await near(page, giver.id, 1.3, 2.8, 1.3, 0.9);
  await captureView(page, 'poses-pickup-stand', { testInfo, compare: false });
  // the first joist: one giver reaches up from the ground, the receiver on beam b3 reaches down / takes it
  expect(await stepUntil(page, `(h) => { const a = h.state().humans.map((q) => q.activity); return a.includes('reach_up') && a.includes('take'); }`, 20 * 1200)).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(3));
  await side(page, 'reach_up', 'take|stand_with_load', 5.4);
  await captureView(page, 'poses-handup-joist', { testInfo });
  // s1: two givers lift it overhead at the east edge, two receivers on the beams take it
  expect(await stepUntil(page, `(h) => { const a = h.state().humans; return a.filter((q) => q.activity === 'reach_up').length >= 2 && a.some((q) => q.activity === 'take'); }`, 20 * 1200)).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(4));
  const st = await page.evaluate(() => window.__marsEngine!.state());
  console.log(`[poses] s1 hand-up t ${st.time}: ${st.humans.filter((q) => q.task).map((q) => `${q.id}:${q.activity}`).join(' ')}`);
  await side(page, 'reach_up', 'take|reach_down|stand_with_load', 5.2);
  await captureView(page, 'poses-handup', { testInfo });
});

/** Side view of a hand-up: camera `dist` m off the giver → receiver line (on the open side), looking at its middle. */
async function side(page: Page, giver: string, receiver: string, dist: number) {
  const st = await page.evaluate(() => window.__marsEngine!.state());
  const g = st.humans.find((q) => new RegExp(`^(${giver})$`).test(q.activity))!;
  const r = st.humans.find((q) => new RegExp(`^(${receiver})$`).test(q.activity))!;
  const mid = [(g.p[0] + r.p[0]) / 2, (g.p[1] + r.p[1]) / 2, (g.p[2] + r.p[2]) / 2];
  const dx = r.p[0] - g.p[0], dz = r.p[2] - g.p[2], L = Math.hypot(dx, dz) || 1;
  // the side facing away from the bay centre (x 0, z 1.83): open ground, no uprights in between
  let px = -dz / L, pz = dx / L;
  if (px * (mid[0] - 0) + pz * (mid[2] - 1.83) < 0) [px, pz] = [-px, -pz];
  await page.evaluate(([pos, t]) => window.__marsEngine!.camera(pos, t), [[mid[0] + px * dist + (dx / L) * 1.2, 2.6, mid[2] + pz * dist + (dz / L) * 1.2], [mid[0], 1.5, mid[2]]]);
  await labFrames(page, 4);
}

test('raise: footer holds the column base low', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await openLab(page, 'build-bay');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('build-bay', { paused: true }));
  // upright A half-way up: footers crouch at the base, the lifter walks the top up
  expect(await stepUntil(page, `(h) => { const a = h.components().find((c) => c.id === 'A'); return !!a && Math.abs(a.pose.pitch ?? 0) > 0.5 && Math.abs(a.pose.pitch ?? 0) < 1.1 && h.state().humans.some((q) => q.activity === 'support'); }`, 20 * 900)).toBe(true);
  const b = await page.evaluate(() => (window.__marsEngine! as unknown as { bones(): Bones }).bones());
  const footers = Object.entries(b).filter(([, x]) => x.activity === 'support' && x.pose.drop > 0.15);
  console.log(`[poses] raise: ${Object.entries(b).filter(([, x]) => x.activity === 'support').map(([id, x]) => `${id} drop ${x.pose.drop.toFixed(2)} bend ${((x.pose.bend * 180) / Math.PI).toFixed(0)}° arms ${x.arms.map((a) => a.err?.toFixed(2) ?? '-').join('/')}`).join(' · ')}`);
  expect(footers.length, 'a footer crouching at the column base').toBeGreaterThan(0);
  // camera beyond the footer, away from the rising upright, a little to the side
  const [st, comps] = await Promise.all([page.evaluate(() => window.__marsEngine!.state()), page.evaluate(() => window.__marsEngine!.components())]);
  const f = st.humans.find((q) => q.id === footers[0][0])!, u = comps.find((c) => c.id === 'A')!;
  let dx = f.p[0] - u.pose.p[0], dz = f.p[2] - u.pose.p[2];
  const L = Math.hypot(dx, dz) || 1;
  [dx, dz] = [dx / L, dz / L];
  const a = 0.7, cx = dx * Math.cos(a) - dz * Math.sin(a), cz = dx * Math.sin(a) + dz * Math.cos(a);
  await page.evaluate(([pos, t]) => window.__marsEngine!.camera(pos, t), [[f.p[0] + cx * 2.6, 1.4, f.p[2] + cz * 2.6], [f.p[0] - dx * 0.3, 0.55, f.p[2] - dz * 0.3]]);
  await labFrames(page, 4);
  await captureView(page, 'poses-raise-footer', { testInfo });
});

// Rack structure (POSES.md "Rack structure"): in hand-up v3 the receivers climb a frame on its W2 `climb:`
// link (ladder cycle: facing the frame, planted feet on their rungs, hands on the hold line) and walk beam b3
// (arms out for balance, short steps). Checked on every tick of the first climb and beam walk; captured.
test('hand-up: climbing a frame (ladder cycle) and walking a beam (arms out)', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await openLab(page, 'hand-up');
  await page.addStyleTag({ content: '.lab-perf, .lab-hud { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('hand-up', { paused: true }));
  type FB = { activity: string; soles: number[]; arms: Arm[]; frame: { kind: string; u: number; weight: number; feet: { p: number[]; planted: boolean }[] | null } | null };
  const bones = () => page.evaluate(() => (window.__marsEngine! as unknown as { bones(): Record<string, FB> }).bones());
  expect(await stepUntil(page, `(h) => h.state().humans.some((q) => q.activity === 'climb-up' && q.p[1] > 0.9)`, 20 * 900)).toBe(true);
  let b = await bones();
  const [cid] = Object.entries(b).find(([, x]) => x.activity === 'climb-up')!;
  // every tick of the rest of this climb: planted soles on their rungs, holds reached, nothing stretched
  let ticks = 0, planted = 0, off: string[] = [], holds = 0, reached = 0;
  for (; ticks < 400; ticks++) {
    const x = b[cid];
    if (x.activity !== 'climb-up') break;
    if (x.frame?.kind === 'ladder' && x.frame.weight >= 1 && x.frame.feet) {
      x.frame.feet.forEach((f, k) => {
        if (!f.planted) return;
        planted++;
        if (Math.abs(x.soles[k] - f.p[1]) > 0.03) off.push(`${ticks} sole ${x.soles[k]} rung ${f.p[1]}`);
      });
      for (const a of x.arms) if (a.source === 'frame') { holds++; if (a.err! <= 0.1) reached++; }
    }
    for (const a of x.arms) expect(Math.hypot(a.shoulder[0] - a.palm[0], a.shoulder[1] - a.palm[1], a.shoulder[2] - a.palm[2])).toBeLessThanOrEqual(a.len + 0.005);
    if (ticks === 6) {
      const st = await page.evaluate(() => window.__marsEngine!.state());
      const q = st.humans.find((h) => h.id === cid)!;
      await page.evaluate(([p, y]) => window.__marsEngine!.camera([p[0] + Math.cos(y + 2.0) * 3.2, p[1] + 1.6, p[2] + Math.sin(y + 2.0) * 3.2], [p[0], p[1] + 0.9, p[2]]), [q.p, q.yaw] as const);
      await labFrames(page, 4);
      await captureView(page, 'poses-climb-frame', { testInfo });
    }
    await page.evaluate(() => window.__marsEngine!.step(1));
    b = await bones();
  }
  console.log(`[poses] climb ${cid}: ${ticks} ticks, planted soles ${planted} (off ${off.length}), frame holds reached ${reached}/${holds}`);
  expect(off, 'planted feet on their rungs').toEqual([]);
  expect(planted).toBeGreaterThan(20);
  expect(reached / Math.max(1, holds)).toBeGreaterThanOrEqual(0.95);
  // a beam walker: both arms out for balance (renderer holds, reached), short steps (half Walk weight)
  expect(await stepUntil(page, `(h) => h.state().humans.some((q) => q.activity === 'beam-walk')`, 20 * 900)).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(6));
  b = await bones();
  const walker = Object.entries(b).find(([, x]) => x.activity === 'beam-walk');
  if (walker) {
    const [wid, x] = walker;
    console.log(`[poses] beam-walk ${wid}: arms ${x.arms.map((a) => `${a.source} err ${a.err}`).join(' / ')}`);
    expect(x.arms.every((a) => a.source === 'frame' && a.err! <= 0.1), 'arms out on the beam').toBe(true);
    const st = await page.evaluate(() => window.__marsEngine!.state());
    const q = st.humans.find((h) => h.id === wid)!;
    await page.evaluate(([p, y]) => window.__marsEngine!.camera([p[0] + Math.cos(y) * 3.6 + Math.cos(y + 1.57) * 1.2, p[1] + 0.9, p[2] + Math.sin(y) * 3.6 + Math.sin(y + 1.57) * 1.2], [p[0], p[1] + 1.0, p[2]]), [q.p, q.yaw] as const);
    await labFrames(page, 4);
    await captureView(page, 'poses-beam-walk', { testInfo });
  }
});

type Probe = { template: string; body: Record<string, number>; arms: Arm[]; pose: { drop: number; bend: number; rise: number; kneel: number } };
type BodyRow = { id: string; template: string; shoulderH: number; shoulderHalf: number; armLen: number; overhead: number; heels: number; down: number; downPose: Probe['pose'] | null; out: number; stretched: number };

// Body model (OWNER_DECISIONS "One body model", POSES.md "Body model"): lab preset `body`, one person per
// rig template at the 3 m deck's edge. probe() sets hand points directly and returns bones() once the
// posture has settled. Measured per template: standing shoulder height and arm length (Idle, t = 0);
// overhead reach = the highest palm centre over a sweep of targets straight above the shoulders, flat
// (activity idle: no heel raise) and on the toes (reach_up); reach-down = the deepest target
// BODY_MODEL.reachDownOut ahead of the feet, beyond the edge, that both palms reach within 2 cm
// (reach_down: kneel + bend). All within 2 cm of BODY_MODEL (reach-down: the shallowest template).
test('body model: the loaded rig matches BODY_MODEL within 2 cm', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await openLab(page, 'body');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('body', { paused: true }));
  const { M, E, rows } = await page.evaluate(() => {
    type H = { probe(id: string, s: unknown): Probe; bodyModel(): { renderer: Record<string, number>; engine: Record<string, number> }; state(): { humans: Human[] } };
    const h = window.__marsEngine! as unknown as H;
    const { renderer: M, engine: E } = h.bodyModel();
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const rows: BodyRow[] = [];
    for (const id of ['b1', 'b2', 'b0']) {
      const [x, y, z] = h.state().humans.find((q) => q.id === id)!.p;
      const rest = h.probe(id, { activity: 'idle', hands: null });
      const sh = rest.arms.map((a) => a.shoulder);
      let stretched = 0;
      const look = (b: Probe) => {
        for (const a of b.arms) stretched = Math.max(stretched, d(a.shoulder, a.palm) - a.len, Math.abs(a.len - M.armLength));
        return b;
      };
      const over = (activity: string) => {
        let top = -Infinity;
        for (let hh = 1.85; hh <= 2.2; hh += 0.005) {
          const b = look(h.probe(id, { activity, hands: { left: [sh[0][0], y + hh, sh[0][2]], right: [sh[1][0], y + hh, sh[1][2]] } }));
          top = Math.max(top, Math.min(...b.arms.map((a) => a.palm[1])) - y);
        }
        return top;
      };
      const overhead = over('idle'), heels = over('reach_up');
      const reached = (f: number, dd: number) => {
        const b = look(h.probe(id, { activity: 'reach_down', hands: { left: [x + f, y - dd, z - 0.15], right: [x + f, y - dd, z + 0.15] } }));
        return Math.max(...b.arms.map((a) => a.err!)) <= 0.02 ? b : null;
      };
      let down = 0, downPose: Probe['pose'] | null = null;
      for (let dd = 0; dd <= 0.9; dd += 0.01) {
        const b = reached(M.reachDownOut, dd);
        if (b) [down, downPose] = [dd, b.pose];
      }
      // how far out a kneeling body reaches just below its feet (the engine's kneel rule allows 0.8 m)
      let out = 0;
      for (let f = 0.3; f <= 1.2; f += 0.01) if (reached(f, 0.1)) out = f;
      h.probe(id, { activity: 'idle', hands: null });
      rows.push({ id, template: rest.template, shoulderH: rest.body.shoulderH, shoulderHalf: rest.body.shoulderHalf, armLen: rest.body.armLen, overhead, heels, down, downPose, out, stretched });
    }
    return { M, E, rows };
  });
  for (const r of rows)
    console.log(`[body] ${r.template}: shoulders ${r.shoulderH.toFixed(3)} m, arm ${r.armLen.toFixed(3)} m, overhead ${r.overhead.toFixed(3)} m flat / ${r.heels.toFixed(3)} m heels up, reach-down ${r.down.toFixed(2)} m below the feet ${M.reachDownOut} m out (kneel ${r.downPose?.kneel ?? '-'}, bend ${r.downPose ? ((r.downPose.bend * 180) / Math.PI).toFixed(0) : '-'}°), out to ${r.out.toFixed(2)} m at 0.1 m below the feet, worst stretch ${(r.stretched * 100).toFixed(2)} cm`);
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.02;
  for (const r of rows) {
    expect(near(r.shoulderH, M.shoulderHeight), `${r.template} shoulders ${r.shoulderH} vs ${M.shoulderHeight}`).toBe(true);
    expect(near(r.armLen, M.armLength), `${r.template} arm ${r.armLen} vs ${M.armLength}`).toBe(true);
    expect(near(r.overhead, M.overheadReach), `${r.template} overhead ${r.overhead} vs ${M.overheadReach}`).toBe(true);
    expect(near(r.heels, M.overheadReach + M.heelRise), `${r.template} heels up ${r.heels} vs ${M.overheadReach + M.heelRise}`).toBe(true);
    expect(r.down, `${r.template} reaches ${M.reachDown} m below the feet`).toBeGreaterThanOrEqual(M.reachDown - 0.02);
    expect(r.downPose?.kneel, `${r.template} kneels to reach down`).toBe(1);
    expect(r.stretched, `${r.template}: no arm longer than its bones`).toBeLessThanOrEqual(0.005);
  }
  expect(near(Math.min(...rows.map((r) => r.down)), M.reachDown), 'BODY_MODEL.reachDown = the shallowest template').toBe(true);
  // the engine's copy (engine/body/model.ts): the numbers it shares with the rendered body must agree …
  for (const r of rows) {
    expect(near(r.armLen, E.armLength), `${r.template} arm vs engine armLength ${E.armLength}`).toBe(true);
    expect(near(r.overhead, E.overheadReach), `${r.template} overhead vs engine overheadReach ${E.overheadReach}`).toBe(true);
    expect(near(r.heels, E.overheadMax), `${r.template} heels up vs engine overheadMax ${E.overheadMax}`).toBe(true);
  }
  // … and where it asks for more than this body does, say so on every run (POSES.md "Body model": open)
  const low = Math.min(...rows.map((r) => r.down)), sh = rows[0].shoulderH, half = Math.max(...rows.map((r) => r.shoulderHalf));
  if (!near(sh, E.shoulderHeight)) console.log(`[body] ENGINE MISMATCH shoulderHeight: engine ${E.shoulderHeight} m, rendered ${sh} m`);
  if (!near(half, E.shoulderHalf)) console.log(`[body] ENGINE MISMATCH shoulderHalf: engine ${E.shoulderHalf} m, rendered ≤ ${half} m`);
  if (low < E.reachDownBelowFeet - 0.02) console.log(`[body] ENGINE MISMATCH reachDownBelowFeet: engine ${E.reachDownBelowFeet} m, a kneeling rig reaches ${low.toFixed(2)}–${Math.max(...rows.map((r) => r.down)).toFixed(2)} m`);
  // capture: the three kneel at the edge reaching 0.3 m below the deck; the three below reach up to 2.0 m
  await page.evaluate((M) => {
    const h = window.__marsEngine! as unknown as { probe(id: string, s: unknown): Probe; state(): { humans: Human[] } };
    for (const q of h.state().humans) {
      const [x, y, z] = q.p;
      if (q.id.startsWith('b')) h.probe(q.id, { activity: 'reach_down', hands: { left: [x + M.reachDownOut, y - 0.3, z - 0.15], right: [x + M.reachDownOut, y - 0.3, z + 0.15] } });
      else h.probe(q.id, { activity: 'reach_up', hands: { left: [x - 0.35, 2.0, z - 0.15], right: [x - 0.35, 2.0, z + 0.15] } });
    }
  }, M);
  await page.evaluate(() => window.__marsEngine!.camera([17.2, 3.4, 4.6], [14, 2.1, 10]));
  await labFrames(page, 4);
  await captureView(page, 'poses-body-kneel-edge', { testInfo, compare: false });
});
