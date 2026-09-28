// Handling poses (owner feedback §5/§6, docs/engineering/POSES.md): crouch → stand with the load,
// reach up (givers) / reach down and take (receivers on the beams), hold low (raise footers).
// - hand-up (flagship v3, lab `hand-up`): runs to the end (all steps, zero violations); every tick,
//   every arm with an engine hand point (`human.hands`) whose shoulder is within the arm's length of it
//   has its palm within 0.1 m of the point and no arm is longer than its bones. The share of all
//   published hand points reached is logged per activity and held to a regression floor (50 %; 54.8 % at cdcf731): the
//   engine's reach envelope (handup.ts ARM_LEN 0.75 m, 2.1 m overhead, 1.0 m below the feet) is far
//   larger than this rig's arm (0.44 m shoulder → palm), so many points are beyond it even after
//   crouching / bending / heels up — those arms hang, honestly (POSES.md "Reach gap");
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
  expect(acc.reached / acc.points, 'share of engine hand points reached (regression floor)').toBeGreaterThanOrEqual(0.5);
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
