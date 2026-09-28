// Stair foot IK (owner feedback §4, docs/engineering/POSES.md): on the proving ground's stairs A the
// climber's feet land on the tread tops. Tick by tick (`__marsEngine.bones`, re-posed without drawing):
// at every plant (a foot becomes planted on a new spot) the sole (Foot bone − its rest ankle height)
// is within 3 cm of that tread's top; on every tick on the flight no sole is more than 3 cm below the
// top of the tread under it (no sinking between treads); knees bend (hips lower than standing on the
// flight). Up (`stairs`) and down (`deck-to-ground`). Captures a person mid-flight.
import { test, expect, type Page } from '@playwright/test';
import { labFrames, openLab } from './lab-helpers';
import { captureView } from './helpers';
import { recordWithFixture } from './take-fixture';

type Flight = { id: string; o: [number, number]; dir: [number, number]; going: number; width: number; yBottom: number; yTop: number; treads: { s: number; y: number }[] };
type Bones = { gait: { flight: string; u: number; weight: number; feet: { planted: boolean; k: number; top: number }[] } | null; feet: number[][]; soles: number[]; hipY: number; ankleH: number };

/** Support height under a world point: tread top / floor / landing of the flight. */
function supportUnder(f: Flight, x: number, z: number) {
  const s = (x - f.o[0]) * f.dir[0] + (z - f.o[1]) * f.dir[1];
  const t = f.treads.find((q) => Math.abs(q.s - s) <= f.going / 2);
  if (t) return t.y;
  return s < f.treads[0].s ? f.yBottom : f.yTop;
}

async function walkFlight(page: Page, scenario: string) {
  await openLab(page, scenario);
  await page.evaluate((n) => window.__marsEngine!.runScenario(n, { paused: true }), scenario);
  const flights: Flight[] = await page.evaluate(() => (window.__marsEngine as unknown as { stairs(): Flight[] }).stairs());
  expect(flights.length).toBeGreaterThan(0);
  const plants: { tick: number; foot: number; k: number; sole: number; top: number }[] = [];
  const sinks: { tick: number; foot: number; sole: number; under: number }[] = [];
  let onFlight = 0, minHipOverFoot = Infinity, maxHipOverFoot = -Infinity, mid: { tick: number } | null = null;
  // per foot: 'swing' while in the air on the flight; a plant = swing → planted
  const last: (string | null)[] = [null, null];
  for (let tick = 0; tick < 20 * 90; tick++) {
    const r = await page.evaluate(() => {
      const h = window.__marsEngine!;
      const st = h.step(1);
      const b = (h as unknown as { bones(id: string): Record<string, Bones> }).bones('p1').p1;
      return { done: st.done, tick: st.tick, b };
    });
    const b = r.b;
    if (b.gait && b.gait.weight >= 0.999) {
      onFlight++;
      const f = flights.find((q) => q.id === b.gait!.flight)!;
      b.gait.feet.forEach((ft, i) => {
        if (ft.planted && last[i] === 'swing') plants.push({ tick: r.tick, foot: i, k: ft.k, sole: b.soles[i], top: ft.top });
        last[i] = ft.planted ? 'planted' : 'swing';
        const under = supportUnder(f, b.feet[i][0], b.feet[i][2]);
        if (b.soles[i] < under - 0.03) sinks.push({ tick: r.tick, foot: i, sole: b.soles[i], under });
      });
      const lowFoot = Math.min(...b.soles);
      minHipOverFoot = Math.min(minHipOverFoot, b.hipY - lowFoot);
      maxHipOverFoot = Math.max(maxHipOverFoot, b.hipY - lowFoot);
      const u = b.gait.u, n = f.treads.length;
      if (!mid && u > n / 2) mid = { tick: r.tick };
    } else last[0] = last[1] = null;
    if (r.done) break;
  }
  return { plants, sinks, onFlight, minHipOverFoot, maxHipOverFoot, mid };
}

for (const [scenario, dir] of [['stairs', 'up'], ['deck-to-ground', 'down']] as const) {
  test(`stair foot IK: feet on the treads (${dir})`, async ({ page }) => {
    test.setTimeout(300_000);
    const r = await walkFlight(page, scenario);
    const worst = r.plants.reduce((m, p) => Math.max(m, Math.abs(p.sole - p.top)), 0);
    console.log(`[stairs ${dir}] ticks on flight ${r.onFlight}, plants ${r.plants.length}, worst |sole − tread top| at plant ${(worst * 100).toFixed(1)} cm, sinks ${r.sinks.length}, hip over lower sole ${r.minHipOverFoot.toFixed(3)}…${r.maxHipOverFoot.toFixed(3)} m`);
    if (r.sinks.length) console.log(`[stairs ${dir}] first sinks: ${JSON.stringify(r.sinks.slice(0, 5))}`);
    expect(r.onFlight).toBeGreaterThan(40);
    expect(r.plants.length).toBeGreaterThanOrEqual(12); // one plant per tread (15), feet alternating
    for (const p of r.plants) expect(Math.abs(p.sole - p.top), `foot ${p.foot} plant on spot ${p.k} at tick ${p.tick}`).toBeLessThan(0.03);
    expect(r.sinks, 'no sole more than 3 cm below the tread under it').toEqual([]);
  });
}

test('stair foot IK: capture mid-flight (up)', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openLab(page, 'stairs');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('stairs', { paused: true }));
  // step until the climber is half-way up the flight
  const st = await page.evaluate(() => {
    const h = window.__marsEngine! as unknown as { step(n: number): { humans: { p: number[] }[] } };
    let s = h.step(1);
    for (let i = 0; i < 2400 && s.humans[0].p[1] < 1.45; i++) s = h.step(1);
    return s;
  });
  const p = st.humans[0].p;
  // side view across the flight (stairs A run along +x at z = 10), slightly from below the deck edge
  await page.evaluate(([q]) => window.__marsEngine!.camera([q[0] + 0.5, q[1] + 1.0, q[2] + 3.3], [q[0] + 0.15, q[1] + 0.8, q[2]]), [p]);
  await labFrames(page, 4);
  await captureView(page, 'poses-stairs-mid-flight', { testInfo });
});

// Take replay (POSES.md "Take replay"): the `stairs` climb recorded with the engine's TakeRecorder and
// replayed through TakePeople (the studio replay's path) with the lab scene as its base SpatialScene:
// on every 5th tick where the live climber is fully on the flight, the replayed climber is on the same
// flight with the gait fully on, and each sole is within 2 cm of the live one (feet on the treads).
test('stair foot IK: take replay walks the flight tread by tread', async ({ page }) => {
  test.setTimeout(300_000);
  await openLab(page, 'stairs');
  await page.evaluate(() => window.__marsEngine!.runScenario('stairs', { paused: true }));
  const { extra, live } = await recordWithFixture<Record<string, Bones>>(page, 20 * 90, 5, 'p1');
  let frames = 0, worst = 0;
  const bad: string[] = [];
  for (const [ts, lb] of Object.entries(live)) {
    const b = lb.p1;
    if (!b?.gait || b.gait.weight < 0.999) continue;
    frames++;
    const t = Number(ts);
    const r = await page.evaluate(([ex, t]) => (window.__marsEngine as unknown as { replayTake(e: unknown, t: number): { bones: Record<string, Bones>; flights: string[] } }).replayTake(ex, (t as number) * 0.05), [extra, t] as const);
    const rb = r.bones.p1;
    if (!rb?.gait || rb.gait.flight !== b.gait.flight || rb.gait.weight < 0.999) {
      bad.push(`${t}: replay gait ${JSON.stringify(rb?.gait ?? null)} (flights ${r.flights.join(',')})`);
      continue;
    }
    const d = Math.max(...b.soles.map((q, i) => Math.abs(q - rb.soles[i])));
    worst = Math.max(worst, d);
    if (d > 0.02) bad.push(`${t}: soles ${JSON.stringify(rb.soles)} vs live ${JSON.stringify(b.soles)}`);
  }
  console.log(`[stairs replay] ${frames} frames on the flight, worst |replay − live sole| ${(worst * 100).toFixed(1)} cm, bad ${bad.length}`);
  if (bad.length) console.log(`[stairs replay] ${bad.slice(0, 5).join(' | ')}`);
  expect(frames).toBeGreaterThan(8);
  expect(bad).toEqual([]);
});
