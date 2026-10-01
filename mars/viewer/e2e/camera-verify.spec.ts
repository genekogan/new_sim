// Engine camera planner vs the real render (docs/engineering/CAMERA_VERIFY.md).
// Replays the flagship campus take in /studio and runs window.__marsStudio.verifyCamera
// over the whole take at 2 Hz: each planned camera pose ray-casts the planner's subject
// points against the meshes actually drawn (2026 GLB, studio scenery, take parts and
// people). Writes artifacts/<run>/camera-verify.json and screenshots of the three
// samples where the render disagrees most with the planner (engine camera on).
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CURRENT_KITCHEN_DIRECTION } from './camera-current-fixture';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';
import type { CameraVerifyReport } from '../app/studio/camera-verify';

const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/engine/takes/manifest.json'), 'utf8'));
const entry = manifest.takes[0];
type Hook = { take: () => { t: number; engineCamera: boolean } | null; verifyCamera: (fromT?: number, toT?: number, hz?: number) => Promise<CameraVerifyReport | null> };

async function scrub(page: Page, t: number) {
  await page.getByRole('slider', { name: 'Take time scrubber' }).fill(String(t));
  await page.waitForFunction((want) => Math.abs(((window.__marsStudio as unknown as Hook).take()?.t ?? -1) - want) < 0.051, t);
  await waitFrames(page, 4);
}

test('camera verify: planned readability vs ray casts against the rendered meshes', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page);
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption(entry.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 60_000 });

  const report = (await page.evaluate((duration) => (window.__marsStudio as unknown as Hook).verifyCamera(0, duration, 2), entry.duration))!;
  expect(report).not.toBeNull();
  writeArtifact('camera-verify.json', report);
  const line = (x: CameraVerifyReport['worst'][number]) =>
    `t=${x.t} planner=${x.planner} real=${x.real} crewExempt=${x.realCrewExempt} [${x.shot}] occluder=${x.occluder} cam=${x.camera.join(',')}`;
  console.log(`camera-verify: ${report.samples} samples, meanPlanner ${report.meanPlanner}, meanReal ${report.meanReal} (crew-exempt ${report.meanRealCrewExempt}), maxAbsDiff ${report.maxAbsDiff}, hidden ${report.hiddenByRealMesh.count}, over-conservative ${report.overConservative.strict.count}/${report.overConservative.soft.count}, ${report.perf.totalMs} ms`);
  for (const x of report.worst) console.log(`  worst ${line(x)}`);

  // Look at the three largest disagreements with the engine camera driving the view.
  const shots = report.hiddenByRealMesh.count ? report.hiddenByRealMesh.samples : report.worst;
  for (const x of [...shots].sort((a, b) => b.planner - b.real - (a.planner - a.real)).slice(0, 3)) {
    await scrub(page, x.t);
    expect((await page.evaluate(() => (window.__marsStudio as unknown as Hook).take()))!.engineCamera).toBe(true);
    await captureView(page, `camera-verify-t${x.t.toFixed(1)}`, { testInfo, compare: false });
  }

  expect(report.samples, 'whole take at 2 Hz').toBeGreaterThanOrEqual(Math.floor(entry.duration * 2));
  expect(report.selfCheck.frameModelMismatch, 'framing/size model identical to the engine evaluator').toBe(0);
  expect(report.selfCheck.groundRay, 'control ray hits the static campus meshes').not.toBeNull();
  expect(report.scene.staticTriangles, 'campus meshes are in the triangle grid').toBeGreaterThan(10_000);
  expect.soft(report.meanReal, 'mean real readability').toBeGreaterThanOrEqual(0.85);
  expect.soft(report.hiddenByRealMesh.samples.map(line), 'planner >= 0.8 but hidden by the real mesh (real <= 0.3)').toEqual([]);
  expect(errors, 'console/page errors').toEqual([]);
});

// ---- directed tracks (CAMERA_DIRECT.md §6.5): the `{ track }` option of verifyCamera ----------------------------
// The three owner-sentence fixtures of CAMERA_DIRECT.md §5, built here as typed directions and compiled in the
// browser (app/studio/direct-camera.ts, phase 2 on), plus the corrected close hold of studio-direct.spec.ts:
// - flagship bay orbit: 270° over 120 s, wide, from `seat_b1`'s start, against the flagship take (take people +
//   parts drawn, replay seeked per sample);
// - Chiba sunset pan: 2026 campus, nobody in it, 20 min before sunset on 2026-03-01 (17:18), take-less (no replay);
// - current 2024 Chiba kitchen: physical counter route from (1.829, 1.44, -0.9), full current scene;
// - carryA close hold from the east at 1 s (foreground → raise 1 m).
// Tolerance (CAMERA_VERIFY.md): no sample hidden by the real mesh (planner ≥ 0.8, real ≤ 0.3); |planner − real| ≥ 0.2
// reported per track with the worst sample. Writes artifacts/<run>/camera-verify-directed.json and a capture of
// each track's worst sample (engine camera for take tracks; the orbit camera at the sample's pose otherwise).
type Directed = { ok: boolean; trackId: string | null; ms: number; scene: string; shots: { label: string; t0: number; t1: number; corrections: { failure: string; strategy: string }[] }[]; diagnostics: { code: string; message: string }[] };
type DirectHook = Hook & {
  direct: (d: unknown[]) => Promise<Directed | null>;
  directOnYear: (d: unknown[], o: { datetime?: string; crop?: [number, number, number, number]; duration?: number }) => Promise<Directed>;
  verifyCamera: (fromT?: number, toT?: number, hz?: number, o?: { track?: 'take' | 'directed' | 'year' }) => Promise<CameraVerifyReport | null>;
  look: (p: number[], t: number[]) => void;
};

/** Step start (s, on the 0.1 s grid) from the take's own lifecycle events, as CAMERA_DIRECT's fixtures do. */
function stepStart(file: string, step: string): number {
  const f = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public', file.replace(/^\//, '')), 'utf8')) as { take: { dt: number; events: { type: string; id?: string; status?: string; t: number }[] } };
  const e = f.take.events.find((x) => x.type === 'action' && x.id === `step:${step}` && x.status === 'executing');
  if (!e) throw new Error(`no step ${step} in ${file}`);
  return Math.round(e.t * f.take.dt * 10) / 10;
}

type Row = { track: string; trackId: string | null; compileMs: number; corrections: string[]; samples: number; meanPlanner: number; meanReal: number; hidden: number; realWorse: number; overConservative: number; worst: unknown };
const row = (track: string, d: Directed, r: CameraVerifyReport): Row => ({
  track, trackId: d.trackId, compileMs: d.ms,
  corrections: d.shots.flatMap((s) => s.corrections.map((c) => `${s.label}: ${c.failure} → ${c.strategy}`)),
  samples: r.samples, meanPlanner: r.meanPlanner, meanReal: r.meanReal, hidden: r.hiddenByRealMesh.count,
  realWorse: r.realWorse.count, overConservative: r.overConservative.soft.count,
  worst: (() => { const w = [...r.worst, ...r.overConservative.top].sort((a, b) => Math.abs(b.planner - b.real) - Math.abs(a.planner - a.real))[0]; return w && { t: w.t, planner: w.planner, real: w.real, occluder: w.occluder, occluders: w.occluders.slice(0, 3).map((o) => `${o.subject}: ${o.label} ×${o.points}`), camera: w.camera, target: w.target, subjects: w.subjects }; })(),
});

test('camera verify: directed tracks (bay orbit, Chiba sunset pan, 2024 kitchen, corrected hold) vs the rendered meshes', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const errors = collectConsoleErrors(page);
  const rows: Row[] = [], reports: Record<string, CameraVerifyReport> = {};
  const run = async (name: string, d: Directed, which: 'directed' | 'year') => {
    expect(d.ok, `${name}: compiled (${d.diagnostics.map((x) => x.code).join(', ')})`).toBe(true);
    const t0 = Math.min(...d.shots.map((s) => s.t0)), t1 = Math.max(...d.shots.map((s) => s.t1));
    const r = (await page.evaluate(([a, b, w]) => (window.__marsStudio as unknown as DirectHook).verifyCamera(a as number, b as number, 2, { track: w as 'directed' | 'year' }), [t0, t1, which] as const))!;
    expect(r, `${name}: verified`).not.toBeNull();
    expect(r.selfCheck.frameModelMismatch, `${name}: framing model = engine`).toBe(0);
    reports[name] = r;
    const x = row(name, d, r);
    rows.push(x);
    const w = x.worst as { t: number; planner: number; real: number; occluder: string | null; camera: number[]; target: number[] } | undefined;
    console.log(`[verify ${name}] ${x.samples} samples ${t0}–${t1} s, planner ${x.meanPlanner} / real ${x.meanReal}, hidden ${x.hidden}, |Δ| ≥ 0.2: ${x.realWorse} real worse + ${x.overConservative} over-conservative; worst t=${w?.t} planner ${w?.planner} real ${w?.real} occluder ${w?.occluder}; corrections ${x.corrections.join('; ') || 'none'}`);
    return w;
  };

  // 2026: the flagship take + the Chiba sunset pan
  await openStudio(page);
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption(entry.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 60_000 });
  const seat = stepStart(entry.file, 'seat_b1');
  for (const [name, dirs] of [
    ['flagship bay orbit', [{ subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 270 }, duration: 120, at: seat, framing: { size: 'wide' } }]],
    ['carryA close hold (corrected)', [{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'hold' }, at: 1, framing: { size: 'close', side: 'east' } }]],
  ] as const) {
    const d = (await page.evaluate((x) => (window.__marsStudio as unknown as DirectHook).direct([...x]), dirs))!;
    const w = await run(name, d, 'directed');
    if (w) {
      await page.evaluate(() => (window.__marsStudio as unknown as { playDirected: (on: boolean) => void }).playDirected(true));
      await scrub(page, w.t);
      await captureView(page, `camera-verify-directed-${name.split(' ')[0].toLowerCase()}-${name.includes('hold') ? 'hold' : 'orbit'}-t${w.t.toFixed(1)}`, { testInfo, compare: false });
      await page.evaluate(() => (window.__marsStudio as unknown as { playDirected: (on: boolean) => void }).playDirected(false));
    }
  }
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption('');
  await page.waitForFunction(() => !(window.__marsStudio as unknown as Hook).take());
  const chiba = await page.evaluate(() => (window.__marsStudio as unknown as DirectHook).directOnYear([{ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' }, context: { sunBehind: { sunset: true } } }], { datetime: '2026-03-01T17:18', duration: 60 }));
  const wc = await run('Chiba sunset pan', chiba, 'year');
  if (wc) {
    await page.evaluate(([p, t]) => (window.__marsStudio as unknown as DirectHook).look(p, t), [wc.camera, wc.target] as const);
    await waitFrames(page, 4);
    await captureView(page, `camera-verify-directed-chiba-t${wc.t.toFixed(1)}`, { testInfo, compare: false });
  }

  // 2024: the kitchen move
  await openStudio(page, 2024);
  const kitchen = await page.evaluate((direction) => (window.__marsStudio as unknown as DirectHook).directOnYear([direction], { duration: 120 }), CURRENT_KITCHEN_DIRECTION);
  const wk = await run('current 2024 counter fly-through', kitchen, 'year');
  if (wk) {
    await page.evaluate(([p, t]) => (window.__marsStudio as unknown as DirectHook).look(p, t), [wk.camera, wk.target] as const);
    await waitFrames(page, 4);
    await captureView(page, `camera-verify-directed-kitchen-t${wk.t.toFixed(1)}`, { testInfo, compare: false });
  }

  writeArtifact('camera-verify-directed.json', { rows, reports });
  for (const x of rows) expect.soft(x.hidden, `${x.track}: planner ≥ 0.8 but hidden by the real mesh (real ≤ 0.3)`).toBe(0);
  expect(errors, 'console/page errors').toEqual([]);
});
