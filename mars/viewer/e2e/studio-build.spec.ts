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

// ---- Chapter sets (W37; STUDIO_REPLAY.md "Chapter sets: playback") ----
// The manifest's `chapterSets` entry is ONE "Watch it being built" item that plays its chapter takes back to back; the
// chapter takes are never offered on their own. One test walks the set (chapter bar, the A → D0 seam, a roof-deck relay,
// the stair, mid-W walls, the final frame with the whole-set checks); one plays 64× for 10 s across a chapter boundary.
type SetChapter = { id: string; label: string; take: string; file: string; from: number; to: number; ticks: number };
type SetEntry = { id: string; label: string; year: number; duration: number; ticks: number; startStateHash: string; finalStateHash: string; chapters: SetChapter[] };
type ChapterCheckInfo = { id: string; hash: { ok: boolean; final: string }; start: { ok: boolean; expected: string; problems: string[] }; lines: number } | null;
type SetFinal = { hash: { ok: boolean; replayed: string; set: string }; frame: { ok: boolean; maxMm: number }; canonical: { ok: boolean; checkpoint: string; frames: { atPose: number; total: number; maxMm: number }; parts: { atPose: number; total: number; maxMm: number; byRole: Record<string, number> } } | null } | null;
type SetInfo = {
  set: string; t: number; duration: number; playing: boolean; speed: number; engineCamera: boolean;
  chapter: { k: number; id: string; label: string; at: number; end: number; local: number }; take: string | null;
  loaded: number[]; waiting: number | null; error: string | null; entities: number; rendered: { components: number; humans: number };
  shot: string; track: { id: string }; offsetY: number; hiddenAssembly: string | null;
  checks: { chapters: ChapterCheckInfo[]; final: SetFinal }; swaps: { k: number; ms: number; at: number }[];
};
type SetHook = { takeSet: () => SetInfo | null; takePerf: (reset?: boolean) => { redraws: number; pose: Stat; sample: Stat; swaps: { k: number; ms: number; at: number }[]; loads: { k: number; fetchMs: number; prepareMs: number }[] } | null };
const sets = ((manifest as { chapterSets?: SetEntry[] }).chapterSets ?? []);
const all = [...manifest.takes, ...(manifest.otherYears ?? [])] as (Entry & { chapter?: unknown })[];
const setInfo = (page: Page) => page.evaluate(() => (window.__marsStudio as unknown as SetHook).takeSet());
async function scrubSet(page: Page, t: number) {
  await page.getByRole('slider', { name: 'Take time scrubber' }).fill(String(t));
  await page.waitForFunction((want) => {
    const i = (window.__marsStudio as unknown as SetHook).takeSet();
    return !!i && Math.abs(i.t - want) < 0.051 && i.waiting === null && i.chapter.at <= i.t + 1e-6 && i.t <= i.chapter.end + 1e-6;
  }, t, { timeout: 60_000 });
  await waitFrames(page, 4);
}
/** Set time inside chapter `id`: the `n`-th of its steps with verb `verb` (the middle one by default), `f` of the way in. */
function stepMoment(s: SetEntry, id: string, verb: string, f = 0.5, n?: number) {
  const c = s.chapters.find((x) => x.id === id)!;
  const file = JSON.parse(fs.readFileSync(path.join(PUBLIC, c.file), 'utf8')) as { take: { dt: number }; steps: { verb: string; start: number | null; end: number | null; label?: string }[] };
  const xs = file.steps.filter((x) => x.verb === verb && x.start !== null && x.end !== null);
  const st = xs[n ?? Math.floor(xs.length / 2)];
  return { t: Math.round((c.from * file.take.dt + st.start! + f * (st.end! - st.start!)) * 10) / 10, label: st.label ?? verb };
}
/** The A+B pin in the engine's own test (engine/test/year-build-b.test.ts PIN_FULL_AB). */
const pinAB = /PIN_FULL_AB = \{ ticks: (\d+), hash: '([0-9a-f]{64})' \}/.exec(fs.readFileSync(path.resolve(import.meta.dirname, '../engine/test/year-build-b.test.ts'), 'utf8'));

test('the manifest has a chapter set, and its chapters are chapter takes', () => {
  expect(sets.length).toBeGreaterThan(0);
  for (const s of sets) for (const c of s.chapters) expect(all.find((e) => e.id === c.take)?.kind, `${s.id} ${c.id}`).toBe('year-build-chapter');
});

for (const s of sets) test(`watch it being built (chapter set ${s.id.slice(0, 8)}): one entry, chapter bar, continuity at the seams, stair, walls, final A+B checks`, async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectConsoleErrors(page);
  const report: Record<string, unknown> = { set: s.id };
  await openStudio(page, s.year);
  const picker = page.getByRole('combobox', { name: 'Watch it being built' });
  const replayPicker = page.getByRole('combobox', { name: 'Replay take' });
  // ONE entry for the set; no chapter take is offered on its own in either picker; the single takes stay
  const setOpt = picker.locator(`option[value="set:${s.id}"]`);
  await expect(setOpt).toHaveCount(1);
  const text = (await setOpt.textContent())!.trim();
  report.option = text;
  expect(text).toMatch(new RegExp(`^${s.year} east-house: skeleton, decks, stair, walls, solar — from the piles · 8 h 2\\d min · ${s.chapters.length} chapters$`));
  for (const c of s.chapters) {
    await expect(picker.locator(`option[value="${c.take}"]`), `chapter ${c.id} not in Watch it being built`).toHaveCount(0);
    await expect(replayPicker.locator(`option[value="${c.take}"]`), `chapter ${c.id} not a Replay take option`).toHaveCount(0);
  }
  for (const b of builds.filter((x) => x.year === s.year)) await expect(picker.locator(`option[value="${b.id}"]`)).toHaveCount(1);
  await expect(replayPicker.locator(`option[value="set:${s.id}"]`)).toHaveCount(1);

  const t0 = Date.now();
  await picker.selectOption(`set:${s.id}`);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as SetHook).takeSet(), null, { timeout: 90_000 });
  report.openMs = Date.now() - t0;
  await expect(page.getByRole('note').filter({ hasText: 'HYPOTHETICAL build scenario — not historical' })).toBeVisible();
  const bar = page.getByRole('list', { name: 'Chapters' });
  await expect(bar.getByRole('button')).toHaveText(s.chapters.map((c) => c.id));
  let i = (await setInfo(page))!;
  expect(i.chapter.id).toBe(s.chapters[0].id);
  expect(i.hiddenAssembly, 'the building the set rebuilds is hidden').toBeTruthy();
  expect(i.engineCamera).toBe(true);
  await expect(bar.locator('li[aria-current="step"] button')).toHaveText(s.chapters[0].id);
  for (const sp of ['1×', '4×', '16×', '64×']) expect(await page.getByRole('combobox', { name: 'Take speed' }).locator('option').allTextContents()).toContain(sp);

  // the yard at t0
  await scrubSet(page, 0.5);
  await captureView(page, 'studio-build-set-yard', { testInfo, compare: false });
  i = (await setInfo(page))!;
  report.yard = { t: i.t, chapter: i.chapter.id, shot: i.shot, entities: i.entities, rendered: i.rendered };

  // the whole-set checks (worker): every chapter's hash and start, then the final checks
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as SetHook).takeSet()?.checks.final, null, { timeout: 240_000 });
  report.checksMs = Date.now() - t0; // open → the worker's final checks
  i = (await setInfo(page))!;
  report.checks = i.checks;
  for (const [k, c] of i.checks.chapters.entries()) {
    expect(c, `chapter ${k} checked`).not.toBeNull();
    expect(c!.hash.ok, `${c!.id}: final state = recorded = manifest`).toBe(true);
    expect(c!.start.ok, `${c!.id}: first frame = previous chapter's final state ${c!.start.problems.join('; ')}`).toBe(true);
    expect(c!.start.expected).toBe(k ? all.find((e) => e.id === s.chapters[k - 1].take)!.finalStateHash : s.startStateHash);
  }
  await expect(page.getByLabel('Continuity check')).toContainText(`✓ continuity: ${s.chapters.length} / ${s.chapters.length} chapter starts`);

  // the A → D0 seam: just before (A's last frame) and at the boundary (D0's first frame)
  const dt = s.duration / s.ticks;
  const seamT = s.chapters[1].from * dt;
  await scrubSet(page, Math.round((seamT - 0.1) * 10) / 10);
  const before = (await setInfo(page))!;
  expect(before.chapter.id).toBe(s.chapters[0].id);
  await scrubSet(page, Math.ceil(seamT * 10) / 10);
  const after = (await setInfo(page))!;
  expect(after.chapter.id).toBe(s.chapters[1].id);
  expect(after.take).toBe(s.chapters[1].take);
  expect(after.entities, 'the same entities either side of the seam').toBe(before.entities);
  expect(after.rendered, 'nothing pops in or out at the seam').toEqual(before.rendered);
  await expect(bar.locator('li[aria-current="step"] button')).toHaveText(s.chapters[1].id);
  const seam = s.chapters[1].id;
  const startHash = i.checks.chapters[1]!.start.expected.slice(0, 8);
  await expect(page.getByLabel('Chapter start check')).toHaveText(`${s.chapters[0].id} → ${seam}: ✓ ${startHash}… (first frame = ${s.chapters[0].id}'s final state)`);
  await expect(bar.getByLabel(`Continuity ${s.chapters[0].id} → ${seam}: ✓ ${startHash}…`, { exact: false })).toHaveText('✓');
  report.seam = { before: { t: before.t, chapter: before.chapter.id, entities: before.entities, rendered: before.rendered }, after: { t: after.t, chapter: after.chapter.id, local: after.chapter.local, entities: after.entities, rendered: after.rendered, shot: after.shot, track: after.track.id }, shown: await page.getByLabel('Chapter start check').innerText() };
  // the log runs on across the seam: A's last lines are still shown at D0's start, on the set clock
  const seamLog = await page.getByRole('log', { name: 'Take log' }).innerText();
  report.seamLog = seamLog;
  expect(seamLog).toMatch(/^1:3\d:\d\d /m);

  // captures: a roof-deck sheet going up through the relay (D2 pass_up), the stair (S), the walls mid-W, the final frame
  const shots: [string, number, string][] = [];
  const relay = stepMoment(s, 'D2', 'pass_up', 0.6);
  shots.push(['roof-relay', relay.t, relay.label]);
  const stair = stepMoment(s, 'S', 'install_stair_part', 0.5);
  shots.push(['stair', stair.t, stair.label]);
  const wall = stepMoment(s, 'W', 'install_wall', 0.5);
  shots.push(['walls', wall.t, wall.label]);
  shots.push(['final', Math.floor(s.duration * 10 + 1e-6) / 10, 'final frame']);
  for (const [name, t, label] of shots) {
    await scrubSet(page, t);
    const x = (await setInfo(page))!;
    expect(x.rendered.components + x.rendered.humans, `${name}: every sampled entity is drawn`).toBeGreaterThanOrEqual(x.entities);
    const log = await page.getByRole('log', { name: 'Take log' }).innerText();
    const steps = await page.locator('.take-now').nth(1).innerText();
    // a merged wait's "until" reads on the set clock too (h:mm:ss.s), not the chapter's own
    for (const u of log.matchAll(/until ([\d:.]+)\)/g)) expect(u[1], `${name}: until on the set clock`).toMatch(/^\d+:\d\d:\d\d\.\d$/);
    report[name] = { t: x.t, chapter: x.chapter.id, local: x.chapter.local, step: label, shot: x.shot, active: steps, entities: x.entities, rendered: x.rendered, log };
    await captureView(page, `studio-build-set-${name}`, { testInfo, compare: false });
  }
  expect((report.walls as { chapter: string }).chapter).toBe('W');
  // the final checks: the set's final state = the A+B pin; 66 frames + beams + 145 parts at the canonical pose
  const f = i.checks.final!;
  expect(f.hash.ok, 'replayed final state = recorded = the set').toBe(true);
  expect(f.frame.ok, `last frame = final state (${f.frame.maxMm} mm)`).toBe(true);
  expect(pinAB, 'the engine test pins the A+B run').not.toBeNull();
  expect(Number(pinAB![1])).toBe(s.ticks);
  expect(s.finalStateHash, 'the set ends at the engine\'s A+B pin').toBe(pinAB![2]);
  expect(f.hash.replayed).toBe(pinAB![2]);
  expect(f.canonical?.ok, 'every frame / beam and part at the canonical pose').toBe(true);
  expect(f.canonical!.frames).toMatchObject({ atPose: 66, total: 66 });
  expect(f.canonical!.parts).toMatchObject({ atPose: 145, total: 145 });
  const checks = page.getByLabel('Final state check');
  await expect(checks).toContainText(`✓ final state ${pinAB![2].slice(0, 8)}… = A+B pin`);
  await expect(checks).toContainText('✓ 66 frames + beams + 145 parts at the mars-2022 canonical pose');
  report.finalChecks = await checks.innerText();
  await page.locator('.take-diagnostics summary').click();
  report.diagnostics = await page.locator('.take-diagnostics').innerText();
  expect(report.diagnostics as string).not.toMatch(/chapters read/);
  writeArtifact(`studio-build-set.json`, report);
  console.log(`studio-build set: ${JSON.stringify({ option: text, openMs: report.openMs, checksMs: report.checksMs, seam: report.seam, final: report.finalChecks })}`);
  expect(errors, 'console/page errors').toEqual([]);
});

// 64× across a chapter boundary: from 384 take-s before the A → D0 seam (1 s warm-up, then 10 s = 640 take-s, the seam
// ≈ 5 s in), engine camera on. Frame intervals (rAF), the swap's own redraw, and the prefetch of the chapter after.
for (const s of sets) test(`chapter set at 64× (${s.id.slice(0, 8)}): 10 s across the A → D0 seam without a stall`, async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page, s.year);
  await page.getByRole('combobox', { name: 'Watch it being built' }).selectOption(`set:${s.id}`);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as SetHook).takeSet(), null, { timeout: 90_000 });
  // let the whole-set checks finish first (a worker; measured separately), so the window is steady-state playback
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as SetHook).takeSet()?.checks.final, null, { timeout: 240_000 });
  await page.getByRole('combobox', { name: 'Take speed' }).selectOption('64');
  const dt = s.duration / s.ticks;
  const seamT = s.chapters[1].from * dt;
  await scrubSet(page, Math.round(seamT - 384));
  // the next chapter is prefetched while this one plays
  await page.waitForFunction(() => (window.__marsStudio as unknown as SetHook).takeSet()!.loaded.includes(1), null, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Play take' }).click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => (window.__marsStudio as unknown as SetHook).takePerf(true));
  const tA = (await setInfo(page))!.t;
  const res = await page.evaluate(() => new Promise<{ ds: number[]; ch: string[]; ts: number[] }>((done) => {
    const ds: number[] = [], ch: string[] = [], ts: number[] = [];
    let last = performance.now();
    const end = last + 10_000;
    const f = (now: number) => {
      ds.push(now - last);
      const i = (window.__marsStudio as unknown as SetHook).takeSet()!;
      ch.push(i.chapter.id);
      ts.push(i.t);
      last = now;
      if (now < end) requestAnimationFrame(f);
      else done({ ds, ch, ts });
    };
    requestAnimationFrame(f);
  }));
  const perf = (await page.evaluate(() => (window.__marsStudio as unknown as SetHook).takePerf()))!;
  const tB = (await setInfo(page))!.t;
  await page.getByRole('button', { name: 'Pause take' }).click();
  const at = res.ch.findIndex((c) => c === s.chapters[1].id);
  const around = at >= 0 ? res.ds.slice(Math.max(0, at - 3), at + 4).map((x) => Math.round(x * 10) / 10) : [];
  const sorted = [...res.ds].sort((a, b) => a - b), r = (x: number) => Math.round(x * 10) / 10;
  const out = {
    set: s.id, from: tA, to: tB, seam: seamT, takeSecondsPerWallSecond: r((tB - tA) / 10),
    frames: { n: res.ds.length, fps: r(res.ds.length / 10), mean: r(sorted.reduce((a, b) => a + b, 0) / sorted.length), p50: r(sorted[sorted.length >> 1]), p95: r(sorted[Math.floor(sorted.length * 0.95)]), max: r(sorted[sorted.length - 1]) },
    seamFrame: at, framesAroundSeam: around, maxAfterSeam: at >= 0 ? r(Math.max(...res.ds.slice(at))) : null,
    swaps: perf.swaps, loads: perf.loads, redraw: { redraws: perf.redraws, pose: perf.pose, sample: perf.sample },
  };
  writeArtifact('studio-build-set-perf.json', out);
  console.log(`studio-build set 64×: ${JSON.stringify(out)}`);
  expect(at, 'the seam was crossed while measuring').toBeGreaterThan(0);
  expect(res.ch[0]).toBe(s.chapters[0].id);
  expect(res.ts.every((t, j) => !j || t >= res.ts[j - 1]), 'the set clock never goes back').toBe(true);
  expect(out.frames.max, 'no frame > 250 ms across the seam').toBeLessThan(250);
  expect(tB - tA, 'the set advanced at ≈ 64×').toBeGreaterThan(400);
  expect(errors, 'console/page errors').toEqual([]);
});
