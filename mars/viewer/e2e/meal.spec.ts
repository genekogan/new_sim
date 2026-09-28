// Meal (owner feedback §12, ITEMS.md, docs/engineering/POSES.md): the lab `meal` preset — four people
// take a bowl and a spoon, serve, sit round the fire and eat until the bowls are empty.
// - completes, bowls empty, zero violations;
// - every tick: each arm with an engine hand point (`human.hands`) whose shoulder is within the arm's
//   length of it lands its palm within 0.1 m of the point; no arm is longer than its bones
//   (shoulder → palm ≤ arm length); ≥ 90 % of all published hand points are reached; held items ride
//   the rendered palm (item origin within the grip offset + 2 cm of the palm);
// - captures: approach + sit, the spoon at the mouth, a legs-crossed sitter; baselines for two.
import { test, expect, type Page } from '@playwright/test';
import { labFrames, openLab } from './lab-helpers';
import { captureView } from './helpers';

type Arm = { side: string; shoulder: number[]; palm: number[]; len: number; target: number[] | null; source: string | null; contact: number; err: number | null; ratio: number | null };
type Bones = Record<string, { activity: string; base: string; arms: Arm[]; pose: { drop: number; bend: number; rise: number } }>;
type Held = { id: string; def: string; by: string; hand: string; rendered: number[] | null; engine: number[]; palm: number[] | null; fraction: number | null };
type Rec = { id: string; verb: string; status: string; phase?: string; params: Record<string, unknown> };

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function stepUntil(page: Page, pred: string, max = 20 * 120) {
  return page.evaluate(
    ([src, n]) => {
      const h = window.__marsEngine! as unknown as { step(n: number): unknown; records(): Rec[]; state(): { humans: { id: string; p: number[]; yaw: number; activity: string }[] } };
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

async function near(page: Page, id: string, side: number, dist: number, y: number, h: number) {
  const st = await page.evaluate(() => window.__marsEngine!.state());
  const p = st.humans.find((q) => q.id === id)!;
  const a = p.yaw + side;
  await page.evaluate(([pos, t]) => window.__marsEngine!.camera(pos, t), [[p.p[0] + Math.cos(a) * dist, p.p[1] + y, p.p[2] + Math.sin(a) * dist], [p.p[0], p.p[1] + h, p.p[2]]]);
  await labFrames(page, 4);
}

test('meal: everyone eats, hands on the engine hand points, items in the hands', async ({ page }) => {
  test.setTimeout(420_000);
  await openLab(page, 'meal');
  await page.evaluate(() => window.__marsEngine!.runScenario('meal', { paused: true }));
  let points = 0, reached = 0, reachable = 0, reachableOk = 0, ticks = 0;
  const bad: string[] = [], over: string[] = [], items: string[] = [];
  let maxErrReachable = 0;
  for (let t = 0; t < 20 * 180; t++) {
    const r = await page.evaluate(() => {
      const h = window.__marsEngine! as unknown as { step(n: number): { done: boolean; tick: number }; bones(): Bones; heldItems(): Held[] };
      const st = h.step(1);
      return { st, b: h.bones(), held: h.heldItems() };
    });
    ticks++;
    for (const [id, b] of Object.entries(r.b))
      for (const a of b.arms) {
        const reach = dist(a.shoulder, a.palm);
        if (reach > a.len + 0.005) over.push(`${r.st.tick} ${id} ${a.side} ${reach.toFixed(3)} > ${a.len.toFixed(3)}`);
        if (a.source !== 'hands' || !a.target) continue;
        points++;
        if (a.err! <= 0.1) reached++;
        if (a.ratio! <= 1.0) {
          reachable++;
          if (a.err! <= 0.1) reachableOk++;
          else bad.push(`${r.st.tick} ${id} ${b.activity}/${b.base} ${a.side} err ${a.err!.toFixed(3)} ratio ${a.ratio!.toFixed(2)}`);
          maxErrReachable = Math.max(maxErrReachable, a.err!);
        }
      }
    for (const it of r.held) {
      if (!it.palm || !it.rendered) continue;
      const d = dist(it.palm, it.rendered);
      const grip = it.def === 'spoon' ? 0.16 : it.def === 'pot' ? 0.31 : it.def === 'cup' ? 0.08 : 0.02;
      if (d > grip + 0.02) items.push(`${r.st.tick} ${it.id} in ${it.by}'s ${it.hand} hand ${d.toFixed(3)} m from the palm`);
    }
    if (r.st.done) break;
  }
  const st = await page.evaluate(() => window.__marsEngine!.state());
  console.log(`[meal] ${ticks} ticks, hand points ${points}, reached ≤ 0.1 m ${reached} (${((100 * reached) / Math.max(1, points)).toFixed(1)} %), rig-reachable ${reachable} of which ok ${reachableOk}, max err (reachable) ${maxErrReachable.toFixed(3)} m`);
  if (bad.length) console.log(`[meal] misses: ${bad.slice(0, 8).join(' | ')}`);
  if (items.length) console.log(`[meal] items off the palm: ${items.slice(0, 5).join(' | ')}`);
  for (const c of st.checks) expect(c.ok, c.message).toBe(true);
  expect(over, 'no arm longer than its bones').toEqual([]);
  expect(bad, 'every rig-reachable engine hand point is reached within 0.1 m').toEqual([]);
  expect(reached / points, 'share of engine hand points reached').toBeGreaterThanOrEqual(0.9);
  expect(items, 'held items stay in the hand').toEqual([]);
});

test('meal: captures (sit, spoon at the mouth, legs crossed)', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await openLab(page, 'meal');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('meal', { paused: true }));
  // approach + sit: p1 in sit-down
  expect(await stepUntil(page, `(h) => h.state().humans.some((q) => q.id === 'p1' && q.activity === 'sit-down')`)).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(6));
  await near(page, 'p1', 0.9, 2.4, 1.3, 0.6);
  await captureView(page, 'meal-sit-down', { testInfo, compare: false });
  // the spoon at the mouth: p1's eat record in its pause phase
  expect(await stepUntil(page, `(h) => h.records().some((r) => r.verb === 'eat' && r.params.actor === 'p1' && r.phase === 'pause')`)).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(3));
  await near(page, 'p1', 0.45, 1.5, 1.15, 0.9);
  await captureView(page, 'meal-spoon-at-mouth', { testInfo });
  // legs crossed: a seated person with the crossed variant
  const info = await page.evaluate(() => window.__marsEngine!.info().humans as unknown as { id: string; activity: string; crossed: boolean; sit: number }[]);
  const crossed = info.find((q) => q.crossed && q.sit === 1);
  console.log(`[meal] crossed sitters: ${info.filter((q) => q.crossed).map((q) => `${q.id}(${q.activity}, sit ${q.sit})`).join(' ')}`);
  expect(crossed, 'a seated person with legs crossed').toBeTruthy();
  await near(page, crossed!.id, 0.6, 2.3, 1.15, 0.6);
  await captureView(page, 'meal-legs-crossed', { testInfo });
  await page.evaluate(() => window.__marsEngine!.cameraPreset('oblique'));
  await labFrames(page, 4);
  await captureView(page, 'meal-oblique', { testInfo, compare: false });
});
