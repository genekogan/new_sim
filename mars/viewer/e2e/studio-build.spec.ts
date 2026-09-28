// Studio "Watch it being built" (docs/engineering/STUDIO_REPLAY.md): the year picker's year-build takes, replayed
// on the year scene from the pile yard to the standing structure with the engine camera, the refusal / blocked log
// as it happens, the final-frame checks against the protected year checkpoint, and arms posed from the take's
// recorded `hands` (mars-take/2) during hand-ups. Manifest-driven: one test per year-build entry of the manifest
// (2022: the east-house first bay and the whole skeleton). Captures artifacts/<run>/studio-build-<take>-{yard,mid,final}.png
// (no baselines: the takes are re-recorded). A third test plays the longest year-build take at 64× for 10 s and
// reports the frame time and the replay's redraw cost (studio-build-perf.json).
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';

type Entry = { id: string; file: string; year: number; duration: number; ticks?: number; entities: number; finalStateHash: string; rulesVersion?: string; kind?: string; moments: Record<string, number> };
type Checks = { hash: { ok: boolean; replayed: string }; frame: { ok: boolean; maxMm: number }; canonical: { ok: boolean; atPose: number; total: number; outside: number; checkpoint: string; maxMm: number } | null };
type Info = { id: string; t: number; duration: number; playing: boolean; speed: number; engineCamera: boolean; entities: number; rendered: { components: number; humans: number }; finalStateHash: string; recordedFinalStateHash: string; shot: string; offsetY: number; hiddenAssembly: string | null; checks: Checks | null; undrawable: string[]; track: { id: string; kind: string; own: boolean } };
type Hook = { take: () => Info | null; palm: (id: string, hand: 'left' | 'right') => { palm: number[] | null; recorded: number[] | null } | null };
const hook = () => window.__marsStudio as unknown as Hook;

const PUBLIC = path.resolve(import.meta.dirname, '../public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'engine/takes/manifest.json'), 'utf8')) as { takes: Entry[]; otherYears?: Entry[] };
const isYearBuild = (e: Entry) => (e.kind ? e.kind === 'year-build' : /year-build/.test(e.rulesVersion ?? ''));
const builds = [...manifest.takes, ...(manifest.otherYears ?? [])].filter(isYearBuild);
/** Capture / report name of a take: its file name without `year-build-<year>-` ('east-house-bay1', 'east-house'). */
const slug = (e: Entry) => path.basename(e.file, '.json').replace(/^year-build-\d+-/, '');

const info = (page: Page) => page.evaluate(() => (window.__marsStudio as unknown as Hook).take());
async function scrub(page: Page, t: number) {
  await page.getByRole('slider', { name: 'Take time scrubber' }).fill(String(t));
  await page.waitForFunction((want) => Math.abs(((window.__marsStudio as unknown as Hook).take()?.t ?? -1) - want) < 0.051, t);
  await waitFrames(page, 4);
}

/** Moments where a person's recorded hands stay put for ≥ 10 ticks (hand-ups: give / relay / hook), spread over the take. */
function handMoments(file: string, n: number) {
  const f = JSON.parse(fs.readFileSync(path.join(PUBLIC, file), 'utf8')) as { take: { dt: number; changes: [number, string, string, unknown][] } };
  const byId = new Map<string, [number, { left?: number[]; right?: number[] } | null][]>();
  for (const [tick, id, field, v] of f.take.changes) if (field === 'hands') (byId.get(id) ?? byId.set(id, []).get(id)!).push([tick, v as never]);
  const out: { id: string; t: number; hand: 'left' | 'right' }[] = [];
  for (const [id, xs] of [...byId.entries()].sort()) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const [tick, h] = xs[i];
      if (!h || xs[i + 1][0] - tick < 10) continue;
      for (const hand of ['left', 'right'] as const) if (h[hand]) out.push({ id, t: Math.round((tick + 5) * f.take.dt * 10) / 10, hand });
    }
  }
  out.sort((a, b) => a.t - b.t);
  // spread over the take, alternating left / right hands
  const step = Math.max(1, Math.floor(out.length / n));
  const picked: typeof out = [];
  for (let i = 0; i < out.length && picked.length < n; i += step) {
    const want = picked.length % 2 ? 'right' : 'left';
    picked.push(out.slice(i, i + step).find((x) => x.hand === want) ?? out[i]);
  }
  return picked;
}

test('the manifest has a year-build take', () => {
  expect(builds.length).toBeGreaterThan(0);
});

for (const e of builds) test(`watch it being built (${slug(e)}): year picker → piles to standing structure, log, final checks, hands`, async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const takeName = slug(e);
  const errors = collectConsoleErrors(page);
  await openStudio(page, e.year);
  const picker = page.getByRole('combobox', { name: 'Watch it being built' });
  await expect(picker).toBeVisible();
  // one option per year-build take of that year (2022: the first bay and, since W22, the whole skeleton), each with
  // its own label, length and tick count
  const ofYear = builds.filter((x) => x.year === e.year);
  await expect(picker.locator('option', { hasText: `${e.year} · ` })).toHaveCount(ofYear.length);
  const texts = (await picker.locator('option', { hasText: `${e.year} · ` }).allTextContents()).map((x) => x.trim());
  expect(new Set(texts).size, 'distinct option texts').toBe(texts.length);
  const mine = texts.find((x) => x.includes(`${(e.ticks ?? Math.round(e.duration / 0.05)).toLocaleString('en-US')} ticks`));
  expect(mine, 'this take is offered with its tick count').toBeTruthy();
  expect(mine!).toMatch(/ · \d+ (h \d+ )?min · /);
  await picker.selectOption(e.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 90_000 });
  await expect(page.getByRole('note').filter({ hasText: 'HYPOTHETICAL build scenario — not historical' })).toBeVisible();

  const first = (await info(page))!;
  expect(first.id).toBe(e.id);
  expect(first.finalStateHash, 'final state hashes to the recorded hash').toBe(first.recordedFinalStateHash);
  expect(first.finalStateHash, 'and to the manifest').toBe(e.finalStateHash);
  expect(first.hiddenAssembly, 'the building the take rebuilds is hidden').toBeTruthy();
  const yearFile = JSON.parse(fs.readFileSync(path.join(PUBLIC, `engine/campus-${e.year}.json`), 'utf8')) as { groundY: number };
  const takeFile = JSON.parse(fs.readFileSync(path.join(PUBLIC, e.file), 'utf8')) as { site?: { groundY: number } };
  expect(first.offsetY, 'datum: year file groundY − take site groundY').toBeCloseTo(yearFile.groundY - (takeFile.site?.groundY ?? yearFile.groundY), 6);
  expect(first.engineCamera).toBe(true);

  // speed: 1× / 4× / 16× / 64× are offered; 64× plays ~64 take-seconds per second
  const speeds = await page.getByRole('combobox', { name: 'Take speed' }).locator('option').allTextContents();
  for (const s of ['1×', '4×', '16×', '64×']) expect(speeds).toContain(s);
  await page.getByRole('combobox', { name: 'Take speed' }).selectOption('64');
  await page.getByRole('button', { name: 'Play take' }).click();
  await page.waitForFunction(() => ((window.__marsStudio as unknown as Hook).take()?.t ?? 0) > 60, null, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause take' }).click();
  const played = (await info(page))!;
  expect(played.speed).toBe(64);

  const report: Record<string, unknown> = { take: e.id, played: played.t, option: mine };
  // 'final': the last point on the scrubber's 0.1 s grid (a take of an odd tick count ends between two grid points)
  const moments: [string, number][] = [['yard', 0.5], ['mid', Math.round(e.duration / 2)], ['final', Math.floor(e.duration * 10 + 1e-6) / 10]];
  for (const [name, t] of moments) {
    await scrub(page, t);
    const i = (await info(page))!;
    // mars-take/4: entities removed before the end (the emptied pile-upright-16ft-kit-1, gone at 1479 s) are drawn from the
    // take's entities0, so every sampled entity is drawable
    expect(i.undrawable, `${name}: nothing sampled is undrawable`).toEqual([]);
    expect(i.rendered.components + i.rendered.humans, `${name}: every sampled entity is drawn`).toBeGreaterThanOrEqual(i.entities);
    const log = await page.getByRole('log', { name: 'Take log' }).innerText();
    console.log(name, JSON.stringify(await page.evaluate(() => (window.__marsStudio as unknown as { visiblePeople: () => unknown }).visiblePeople())));
    report[name] = { t: i.t, shot: i.shot, entities: i.entities, rendered: i.rendered, undrawable: i.undrawable, log };
    await captureView(page, `studio-build-${takeName}-${name}`, { testInfo, compare: false });
  }
  // the whole-take diagnostics (merged "×n until" waits) as the drop-down shows them at the end
  await page.locator('.take-diagnostics summary').click();
  report.diagnostics = await page.locator('.take-diagnostics').innerText();
  await page.locator('.take-diagnostics summary').click();
  // the blocked-wait log fills as the take runs (the take's events carry the diagnostics)
  expect((report.final as { log: string }).log).toMatch(/blocked|refused/);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take()?.checks, null, { timeout: 30_000 });
  const checks = (await info(page))!.checks!;
  report.checks = checks;
  expect(checks.hash.ok, 'replayed final state = recorded = manifest').toBe(true);
  expect(checks.frame.ok, `last frame = final state (max ${checks.frame.maxMm} mm)`).toBe(true);
  expect(checks.canonical, 'year-build take: canonical comparison').not.toBeNull();
  expect(checks.canonical!.ok, `${checks.canonical!.atPose}/${checks.canonical!.total} at the canonical pose`).toBe(true);
  await expect(page.getByLabel('Final state check')).toContainText(`✓ ${checks.canonical!.atPose} / ${checks.canonical!.total} frames + beams at the ${checks.canonical!.checkpoint} canonical pose`);

  // arms from the recorded hands: rendered palm vs recorded hand point (scene coordinates)
  const samples: { id: string; t: number; hand: string; d: number | null }[] = [];
  for (const m of handMoments(e.file, 12)) {
    await scrub(page, m.t);
    const r = await page.evaluate(([id, hand]) => (window.__marsStudio as unknown as Hook).palm(id, hand as 'left' | 'right'), [m.id, m.hand] as const);
    const d = r?.palm && r.recorded ? Math.hypot(r.palm[0] - r.recorded[0], r.palm[1] - r.recorded[1], r.palm[2] - r.recorded[2]) : null;
    samples.push({ ...m, d: d === null ? null : Math.round(d * 1000) / 1000 });
  }
  report.hands = samples;
  writeArtifact(`studio-build-${takeName}.json`, report);
  console.log(`studio-build ${takeName}: played to ${played.t.toFixed(1)} s at 64×; checks ${JSON.stringify(checks.canonical)}; hands ${samples.map((s) => `${s.id}.${s.hand}@${s.t}=${s.d}`).join(' ')}`);
  const ds = samples.map((s) => s.d).filter((d): d is number => d !== null).sort((a, b) => a - b);
  expect(ds.length, 'palms found for the recorded hands').toBe(samples.length);
  expect(ds[Math.floor(ds.length / 2)], 'median palm → recorded hand point (m)').toBeLessThan(0.05);
  expect(errors, 'console/page errors').toEqual([]);
});

// 64× smoothness: play each year-build take at 64× for 10 s from 40 % of its length (the skeleton going up) with the
// engine camera on, and record the browser's frame intervals and the replay's own redraw cost (TakeReplay.perf:
// `pose` = sampleTake + posing people / parts / piles, `sample` = sampleTake alone). SwiftShader renders in software,
// so the frame interval is mostly rendering; the redraw numbers are what the take's length could make worse.
type Stat = { mean: number; p50: number; p95: number; max: number } | null;
type PerfHook = Hook & { takePerf: (reset?: boolean) => { redraws: number; pose: Stat; sample: Stat } | null };
const perfReport: Record<string, unknown> = {};
for (const e of builds) test(`watch it being built at 64× (${slug(e)}): 10 s frame time`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page, e.year);
  await page.getByRole('combobox', { name: 'Watch it being built' }).selectOption(e.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 90_000 });
  await page.getByRole('combobox', { name: 'Take speed' }).selectOption('64');
  await scrub(page, Math.round(e.duration * 0.4));
  await page.getByRole('button', { name: 'Play take' }).click();
  await page.waitForTimeout(1000); // warm-up: first frames compile shaders for newly visible parts
  const t0 = (await info(page))!.t;
  await page.evaluate(() => (window.__marsStudio as unknown as PerfHook).takePerf(true));
  const frames = await page.evaluate(() => new Promise<number[]>((done) => {
    const ds: number[] = [];
    let last = performance.now();
    const end = last + 10_000;
    const f = (now: number) => {
      ds.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(f);
      else done(ds);
    };
    requestAnimationFrame(f);
  }));
  const redraw = (await page.evaluate(() => (window.__marsStudio as unknown as PerfHook).takePerf()))!;
  const t1 = (await info(page))!.t;
  await page.getByRole('button', { name: 'Pause take' }).click();
  const s = [...frames].sort((a, b) => a - b), r = (x: number) => Math.round(x * 10) / 10;
  const out = {
    take: e.id, ticks: e.ticks, entities: e.entities, from: t0, to: t1,
    takeSecondsPerWallSecond: r((t1 - t0) / 10),
    frames: { n: frames.length, fps: r(frames.length / 10), mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(s[s.length >> 1]), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s[s.length - 1]) },
    redraw,
  };
  perfReport[slug(e)] = out;
  writeArtifact('studio-build-perf.json', perfReport);
  console.log(`studio-build 64× ${slug(e)}: ${JSON.stringify(out)}`);
  expect(t1, 'the take advanced while playing at 64×').toBeGreaterThan(t0 + 10);
  expect(redraw.redraws, 'one redraw per frame while playing').toBeGreaterThan(frames.length * 0.8);
  expect(errors, 'console/page errors').toEqual([]);
});
