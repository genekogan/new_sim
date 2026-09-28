// Lab preset `solar-paint` (app/lab/solar-paint.ts, SOLAR_PAINT.md): the renderer's side of W8 / W7 —
// paint progress drawn per band exactly as wide as the engine's band coverage (colour, and a texture as a
// colour with a stripe), a fragile solar panel carried flat (engine pose ≤ 30° and the rendered panel at
// the engine's tilt every tick), a panel mounted at 20° on its rails, labelled equipment, bundles / stacks
// whose drawn height follows `contents.count`, the cutting station. Captures mid-paint, the carry, the end.
import { test, expect, type Page } from '@playwright/test';
import { labFrames, openLab } from './lab-helpers';
import { captureView } from './helpers';

type Paint = { id: string; face: string; color: string; texture: string | null; bands: { from: number; to: number; coverage: number; drawn: number }[] };
type Comp = { id: string; def: string; phase?: string; support?: string; pose: { p: number[]; yaw: number; pitch?: number; roll?: number }; rendered: { min: number[]; max: number[] } | null };
type H = {
  step(n: number): { tick: number; done: boolean; checks: { ok: boolean; message: string }[] };
  runToEnd(max: number): { tick: number; done: boolean; checks: { ok: boolean; message: string }[] };
  state(): { tick: number; humans: { id: string; p: number[]; yaw: number; activity: string }[]; checks: { ok: boolean; message: string }[] };
  paints(): Paint[];
  components(): Comp[];
  stacks(): { id: string; def: string; count: number; top: number | null }[];
  camera(pos: number[], target: number[]): void;
  cameraPreset(k: 'top' | 'oblique'): void;
};
/** Evaluate `f(window.__marsEngine)` in the page (f is serialised: no closures). */
const h = <T>(page: Page, f: (h: H) => T) => page.evaluate(`(${f.toString()})(window.__marsEngine)`) as Promise<T>;

test('solar-paint: paint bands as drawn = engine coverage, panel carried flat, stock and equipment, captures', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openLab(page, 'solar-paint');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => (window.__marsEngine as unknown as { runScenario(n: string, o: object): unknown }).runScenario('solar-paint', { paused: true }));

  // stacks: drawn count = contents.count; a part-used stack is lower than a full one of its kind
  const stacks = await h(page, (x) => x.stacks());
  console.log(`[solar-paint] stacks ${stacks.map((s) => `${s.id} ${s.count} top ${s.top}`).join(', ')}`);
  const top = (id: string) => stacks.find((s) => s.id === id)!.top!;
  for (const [full, part] of [['b-ply-full', 'b-ply-part'], ['s-beam-full', 's-beam-part'], ['s-up-full', 's-up-part']]) expect(top(part), `${part} lower than ${full}`).toBeLessThan(top(full) - 0.05);

  // step, checking every tick: paint overlays drawn = engine band coverage; the carried panel flat
  let maxTilt = 0, tiltOff = 0, paintChecks = 0, mid = false;
  for (let i = 0; i < 20 * 60; i++) {
    const r = await page.evaluate(() => {
      const x = window.__marsEngine as unknown as H;
      const st = x.step(1);
      const pv = x.components().find((c) => c.id === 'pv1')!;
      return { st, paints: x.paints(), pv, humans: x.state().humans };
    });
    for (const p of r.paints) for (const b of p.bands) {
      paintChecks++;
      expect(Math.abs(b.drawn - b.coverage), `${p.id} band ${b.from}–${b.to} drawn ${b.drawn} vs coverage ${b.coverage}`).toBeLessThanOrEqual(0.005);
    }
    const tilt = Math.max(Math.abs(r.pv.pose.pitch ?? 0), Math.abs(r.pv.pose.roll ?? 0));
    maxTilt = Math.max(maxTilt, tilt);
    if (r.pv.support === 'held' && tilt > (30 * Math.PI) / 180 + 1e-6) tiltOff++;
    // mid-paint (a band part-covered on w1) while the panel is up in its carriers' hands → capture both
    if (!mid && r.paints.find((p) => p.id === 'w1')?.bands.some((b) => b.coverage > 0.05 && b.coverage < 0.95) && r.pv.support === 'held' && r.pv.pose.p[1] > 0.4) {
      mid = true;
      await page.evaluate(() => (window.__marsEngine as unknown as H).camera([-5.5, 2.6, 4.5], [0, 1.2, 0.2]));
      await labFrames(page, 4);
      await captureView(page, 'solar-paint-mid-paint', { testInfo });
      const pv = r.pv.pose.p;
      await page.evaluate((p) => (window.__marsEngine as unknown as H).camera([p[0] - 3.2, 2.2, p[2] + 2.6], [p[0], 0.7, p[2]]), pv);
      await labFrames(page, 4);
      await captureView(page, 'solar-paint-carry', { testInfo, compare: false });
    }
    if (r.st.done) break;
  }
  const fin = await h(page, (x) => x.state());
  const paints = await h(page, (x) => x.paints());
  console.log(`[solar-paint] tick ${fin.tick}; paint checks ${paintChecks}; ${paints.map((p) => `${p.id} ${p.color}${p.texture ? ` texture ${p.texture}` : ''} [${p.bands.map((b) => b.drawn).join(' ')}]`).join('; ')}; panel max tilt ${((maxTilt * 180) / Math.PI).toFixed(2)}°`);
  for (const c of fin.checks) expect(c.ok, c.message).toBe(true);
  expect(mid, 'captured mid-paint while the panel was carried').toBe(true);
  expect(tiltOff, 'the fragile panel never tilted past 30° while held').toBe(0);
  expect(paints.map((p) => p.id).sort()).toEqual(['w1', 'w2']);
  expect(paints.find((p) => p.id === 'w2')!.texture).toBe('flower-mural-2024');
  // the mounted panel is drawn at the engine's 20° (its rendered box is taller than a flat panel)
  const comps = await h(page, (x) => x.components());
  const pv2 = comps.find((c) => c.id === 'pv2')!;
  expect(pv2.pose.roll!).toBeCloseTo((20 * Math.PI) / 180, 6);
  expect(pv2.rendered!.max[1] - pv2.rendered!.min[1]).toBeGreaterThan(0.3);
  await page.evaluate(() => (window.__marsEngine as unknown as H).camera([-10.5, 3.2, 12.5], [-5, 0.4, 7.5]));
  await labFrames(page, 4);
  await captureView(page, 'solar-paint-mounted-equipment', { testInfo });
  await page.evaluate(() => (window.__marsEngine as unknown as H).cameraPreset('oblique'));
  await labFrames(page, 4);
  await captureView(page, 'solar-paint-end-oblique', { testInfo, compare: false });
  await page.evaluate(() => (window.__marsEngine as unknown as H).camera([-4.5, 2.0, -0.5], [0, 1.3, 0.3]));
  await labFrames(page, 4);
  await captureView(page, 'solar-paint-end-sheets', { testInfo, compare: false });
  expect(errors).toEqual([]);
});
