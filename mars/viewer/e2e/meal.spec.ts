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
import { recordWithFixture } from './take-fixture';

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
  await captureView(page, 'meal-spoon-at-mouth', { testInfo, softVisual: true });
  // legs crossed: a seated person with the crossed variant
  const info = await page.evaluate(() => window.__marsEngine!.info().humans as unknown as { id: string; activity: string; crossed: boolean; sit: number }[]);
  const crossed = info.find((q) => q.crossed && q.sit === 1);
  console.log(`[meal] crossed sitters: ${info.filter((q) => q.crossed).map((q) => `${q.id}(${q.activity}, sit ${q.sit})`).join(' ')}`);
  expect(crossed, 'a seated person with legs crossed').toBeTruthy();
  await near(page, crossed!.id, 0.6, 2.3, 1.15, 0.6);
  await captureView(page, 'meal-legs-crossed', { testInfo, softVisual: true });
  await page.evaluate(() => window.__marsEngine!.cameraPreset('oblique'));
  await labFrames(page, 4);
  await captureView(page, 'meal-oblique', { testInfo, compare: false });
});

type ReplayOut = { tick: number; bones: Bones; held: { id: string; by: string; hand: string; rendered: number[] | null; palm: number[] | null }[]; flights: string[] };

// Take replay consumption (POSES.md "Take replay"): the meal replayed from a lab-recorded take plus the
// recorder's own hands / baseActivity / on (mars-take/3: hands thinned to keyframes within 5.5 mm, interpolated by
// sampleTake) through TakePeople — the studio replay's path — at every 20th tick: every arm the live lab drives to an
// engine hand point is driven to the same point in the replay (hands source, target within 6 mm), the replay reaches at least as many of them within
// 0.1 m (less 2 %), eaters keep their seated base, and held items ride the replayed palms.
test('meal: take replay with the recorded hands / baseActivity poses as in the lab', async ({ page }) => {
  test.setTimeout(420_000);
  await openLab(page, 'meal');
  await page.evaluate(() => window.__marsEngine!.runScenario('meal', { paused: true }));
  const { extra, live } = await recordWithFixture<Bones>(page, 20 * 180, 20);
  let points = 0, liveOk = 0, replayOk = 0;
  const wrong: string[] = [], items: string[] = [], bases: string[] = [];
  for (const [ts, lb] of Object.entries(live)) {
    const t = Number(ts);
    const r: ReplayOut = await page.evaluate(([ex, t]) => (window.__marsEngine as unknown as { replayTake(e: unknown, t: number): ReplayOut }).replayTake(ex, (t as number) * 0.05), [extra, t] as const);
    for (const [id, b] of Object.entries(lb)) {
      const rb = r.bones[id];
      if (!rb) {
        wrong.push(`${t} ${id} missing in the replay`);
        continue;
      }
      if (b.base !== rb.base) bases.push(`${t} ${id} live ${b.activity}/${b.base} replay ${rb.activity}/${rb.base}`);
      b.arms.forEach((a, i) => {
        if (a.source !== 'hands' || !a.target) return;
        points++;
        if (a.err! <= 0.1) liveOk++;
        const ra = rb.arms[i];
        if (ra.source !== 'hands' || !ra.target || dist(ra.target, a.target) > 0.006) wrong.push(`${t} ${id} ${a.side}: replay ${ra.source} ${JSON.stringify(ra.target)} vs ${JSON.stringify(a.target)}`);
        else if (ra.err! <= 0.1) replayOk++;
      });
    }
    for (const it of r.held) {
      if (!it.palm || !it.rendered) continue;
      const d = dist(it.palm, it.rendered);
      const grip = it.id.startsWith('spoon') ? 0.16 : it.id.startsWith('pot') ? 0.31 : it.id.startsWith('cup') ? 0.08 : 0.02;
      if (d > grip + 0.02) items.push(`${t} ${it.id} ${d.toFixed(3)} m from ${it.by}'s ${it.hand} palm`);
    }
  }
  console.log(`[meal replay] ${Object.keys(live).length} frames, hand points ${points}: live reached ${liveOk}, replay reached ${replayOk}; wrong ${wrong.length}, base mismatches ${bases.length}, items off the palm ${items.length}`);
  if (wrong.length) console.log(`[meal replay] ${wrong.slice(0, 5).join(' | ')}`);
  if (bases.length) console.log(`[meal replay] ${bases.slice(0, 5).join(' | ')}`);
  expect(points).toBeGreaterThan(50);
  expect(wrong, 'replayed arms go to the recorded hand points').toEqual([]);
  expect(bases, 'eat / serve keep their base (seated)').toEqual([]);
  expect(replayOk, 'replay reaches the hand points as the lab does').toBeGreaterThanOrEqual(liveOk - Math.ceil(points * 0.02));
  expect(items, 'held items ride the replayed palms').toEqual([]);
});
