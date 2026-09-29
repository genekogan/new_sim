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
const W51_FIXME = '2022 reconciliation W51: mars-2022 re-seeded (houses, stairs, solar, trailers moved); the recorded 2022 takes / pins no longer match it — re-record parked with the content (OWNER_DECISIONS 2026-09-29 evening; RECONCILIATION_2022.md)';

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
  test.fixme(true, W51_FIXME);
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
  test.fixme(true, W51_FIXME);
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

// ---- W48: the set player at high speed (STUDIO_REPLAY.md "Chapter sets: shot hold, gait across seams, Direct camera") ----
type HoldSeg = { k: number; i: number; d: number; r: number; end: number; label: string };
type SetInfo48 = SetInfo & {
  shotKey: string; hold: { on: boolean; holdS: number; span: number; anchor: number; seg: HoldSeg | null };
  gaitCarry: boolean; gaitWaiting: boolean; directed: { k: number; chapter: string; id: string } | null; track: { id: string; kind: string; own: boolean };
};
type Gait = { t: number; k: number; chapter: string; local: number; gait: Record<string, { dist: number; walk: number; stride: number | null; phase: number | null }> };
type Hook48 = SetHook & {
  takeSet: () => SetInfo48 | null;
  takeSetControl: (o: { hold?: boolean; gaitCarry?: boolean }) => { hold: boolean; gaitCarry: boolean } | null;
  setGaitAt: (T: number) => Gait | null;
};
const setInfo48 = (page: Page) => page.evaluate(() => (window.__marsStudio as unknown as Hook48).takeSet());
/** Planned shot windows per chapter (chapter seconds) and the take dt, from the shipped chapter files. */
function setShots(s: SetEntry) {
  const files = s.chapters.map((c) => JSON.parse(fs.readFileSync(path.join(PUBLIC, c.file), 'utf8')) as { take: { dt: number }; camera: { data: { shots: { t0: number; t1: number; label: string }[] } } });
  return { dt: files[0].take.dt, shots: files.map((f) => f.camera.data.shots) };
}
/** The hold rule, restated from STUDIO_REPLAY.md (not imported): the chain of displayed shots from `anchor`. */
function expectedHolds(s: SetEntry, anchor: number, span: number, until: number) {
  const { dt, shots } = setShots(s);
  const duration = s.ticks * dt;
  const chapterAt = (T: number) => { for (let k = 0; k < s.chapters.length; k++) if (T < s.chapters[k].to * dt) return k; return s.chapters.length - 1; };
  const out: { k: number; i: number; d: number; r: number }[] = [];
  for (let d = anchor; d < until && d < duration;) {
    const k = chapterAt(d), at = s.chapters[k].from * dt, l = d - at, w = shots[k];
    let i = w.findIndex((x) => l >= x.t0 && l < x.t1);
    if (i < 0) i = l < w[0].t0 ? 0 : w.length - 1;
    const end = Math.min(at + w[i].t1, s.chapters[k].to * dt);
    const r = Math.min(duration, Math.max(end, d + span));
    out.push({ k, i, d, r });
    d = r;
  }
  return out;
}

// 64× for 60 s wall from 384 set-s before the A → D0 seam: the planned camera (hold off) against the shot hold. Counts the
// shots on screen (rAF, by the player's shot key) and their on-screen time; the chain seen must be the rule's chain.
for (const s of sets) test(`chapter set at 64× (${s.id.slice(0, 8)}): shot hold — every shot ≥ 1.5 s on screen, 60 s before → after`, async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page, s.year);
  await page.getByRole('combobox', { name: 'Watch it being built' }).selectOption(`set:${s.id}`);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook48).takeSet()?.checks.final, null, { timeout: 240_000 });
  await page.getByRole('combobox', { name: 'Take speed' }).selectOption('64');
  const { dt } = setShots(s);
  const from = Math.round(s.chapters[1].from * dt - 384);
  const WALL = 60_000;
  const runs: Record<string, unknown> = {};
  for (const hold of [false, true]) {
    await page.evaluate((h) => (window.__marsStudio as unknown as Hook48).takeSetControl({ hold: h }), hold);
    await expect(page.getByRole('checkbox', { name: 'Hold shots' })).toBeChecked({ checked: hold });
    await scrubSet(page, from);
    await page.waitForFunction(() => (window.__marsStudio as unknown as Hook48).takeSet()!.loaded.includes(1), null, { timeout: 60_000 });
    const anchor = (await setInfo48(page))!.hold.anchor;
    await page.getByRole('button', { name: 'Play take' }).click();
    const res = await page.evaluate((ms) => new Promise<{ w: number[]; key: string[]; t: number[]; label: string[] }>((done) => {
      const w: number[] = [], key: string[] = [], t: number[] = [], label: string[] = [];
      const t0 = performance.now();
      const f = (now: number) => {
        const i = (window.__marsStudio as unknown as Hook48).takeSet()!;
        w.push(now - t0); key.push(i.shotKey); t.push(i.t); label.push(i.shot);
        if (now - t0 < ms) requestAnimationFrame(f);
        else done({ w, key, t, label });
      };
      requestAnimationFrame(f);
    }), WALL);
    if (hold) {
      // pause inside a hold tail (the shot on screen past its planned end) and look at it
      // clicked in the same frame the condition is seen (a Playwright click can land after the hold's release under load)
      await page.evaluate(() => new Promise<void>((done) => {
        const f = () => {
          const h = (window.__marsStudio as unknown as Hook48).takeSet()!;
          if (h.hold.seg && h.t > h.hold.seg.end + 5 && h.t < h.hold.seg.r - 5) {
            (document.querySelector('button[aria-label="Pause take"]') as HTMLButtonElement).click();
            done();
          } else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }));
      await expect(page.getByRole('button', { name: 'Play take' })).toBeVisible();
      await expect(page.getByLabel('Shot now')).toContainText('· held');
      await waitFrames(page, 4);
      await captureView(page, 'studio-build-set-hold-held', { testInfo, compare: false });
      runs.held = { info: await page.getByLabel('Shot now').innerText(), seg: (await setInfo48(page))!.hold.seg, t: (await setInfo48(page))!.t };
    } else await page.getByRole('button', { name: 'Pause take' }).click();
    // segments: runs of the same shot key; on-screen time = wall between the first frame of one and of the next
    const segs: { key: string; w0: number; w1: number; startGapMs: number; t0: number; t1: number; label: string }[] = [];
    res.key.forEach((k, j) => {
      if (!segs.length || segs[segs.length - 1].key !== k) segs.push({ key: k, w0: res.w[j], w1: res.w[j], startGapMs: j ? res.w[j] - res.w[j - 1] : 0, t0: res.t[j], t1: res.t[j], label: res.label[j] });
      const g = segs[segs.length - 1];
      g.w1 = res.w[j + 1] ?? res.w[j];
      g.t1 = res.t[j];
    });
    const inner = segs.slice(1, -1).map((g) => (g.w1 - g.w0) / 1000); // complete shots only
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const sorted = [...inner].sort((a, b) => a - b);
    const setSeconds = res.t[res.t.length - 1] - res.t[0];
    const gaps = res.w.slice(1).map((w, j) => w - res.w[j]).sort((a, b) => a - b);
    const bounds = segs.slice(1, -1).map((g) => ({ key: g.key, observedS: (g.w1 - g.w0) / 1000,
      startGapS: g.startGapMs / 1000, upperDurationS: (g.w1 - g.w0 + g.startGapMs) / 1000 }));
    runs[hold ? 'hold' : 'planned'] = {
      anchor, frames: res.w.length, setSeconds: r2(setSeconds), setPerWall: r2(setSeconds / (WALL / 1000)),
      // on-screen set seconds per complete shot ÷ 64: the wall time at a true 64× (independent of the frame rate / load)
      nominalS: (() => { const x = segs.slice(1, -1).map((g, j) => (segs[j + 2].t0 - g.t0) / 64); return { mean: r2(x.reduce((a, b) => a + b, 0) / x.length), min: r2(Math.min(...x)), max: r2(Math.max(...x)) }; })(),
      shots: segs.length, complete: inner.length, meanS: r2(inner.reduce((a, b) => a + b, 0) / inner.length), minS: r2(sorted[0]), p10S: r2(sorted[Math.floor(sorted.length * 0.1)]), maxS: r2(sorted[sorted.length - 1]),
      chapters: [...new Set(res.key.map((k) => k.split(':')[0]))],
      firstShots: segs.slice(0, 6).map((g) => `${g.key} ${r2((g.w1 - g.w0) / 1000)} s · ${g.label.slice(0, 50)}`),
      cadenceMs: { max: gaps.at(-1), p95: gaps[Math.floor(gaps.length * 0.95)] },
      bounds,
    };
    // Keep failed-run evidence too. The first observation can be one frame after a cut;
    // using a fixed percentage (or a global worst frame) misstates that uncertainty.
    writeArtifact(`studio-build-set-hold-${hold ? 'held' : 'planned'}-samples.json`, { anchor, res, segs, bounds });
    writeArtifact('studio-build-set-hold.json', { set: s.id, speed: 64, wallS: WALL / 1000, from, ...runs });
    if (hold) {
      // the chain on screen is exactly the rule's chain from the anchor (deterministic given speed and start)
      const chain = expectedHolds(s, anchor, 1.5 * 64, res.t[res.t.length - 1] + 1e-6);
      const want = chain.map((x) => `${x.k}:${x.i}@${x.d.toFixed(3)}`);
      expect(segs.map((g) => g.key), 'the shots on screen are the hold chain from the anchor').toEqual(want.slice(0, segs.length));
      expect(bounds.length, 'complete held shots were sampled').toBeGreaterThan(0);
      expect(gaps[0], 'sample timestamps advance').toBeGreaterThan(0);
      expect(gaps.at(-1), 'cadence resolves a 1.5 s hold in at least four samples').toBeLessThanOrEqual(375);
      expect(res.t.every((t, j) => !j || t >= res.t[j - 1]), 'set clock never reverses').toBe(true);
      for (const x of chain.slice(1, segs.length - 1))
        expect((x.r - x.d) / 64, 'nominal held duration remains 1.5 s').toBeGreaterThanOrEqual(1.5 - 1e-9);
      for (const b of bounds)
        expect(b.upperDurationS, `${b.key}: ${b.observedS}s observed + its ${b.startGapS}s first-frame uncertainty`).toBeGreaterThanOrEqual(1.5 - 0.001);
      expect(res.label.some((l, j) => res.key[j] !== res.key[j - 1] && j > 0), 'cuts happen').toBe(true);
    } else expect(Math.min(...inner), 'without the hold some planned shots flash by').toBeLessThan(1.5);
  }
  const out = { set: s.id, speed: 64, wallS: WALL / 1000, from, ...runs };
  writeArtifact('studio-build-set-hold.json', out);
  console.log(`studio-build set hold: ${JSON.stringify(out)}`);
  expect(errors, 'console/page errors').toEqual([]);
});

// Leg phase at the seams: every person's walked metres and leg phase on the last frame of chapter k − 1 (set time
// seam − 0.1 ms) against the first frame of chapter k (the seam). With the carry (W48) no phase may jump > 0.1; without
// it (the W37 behaviour, every chapter counting from 0) the jumps are reported as the before.
for (const s of sets) test(`chapter set seams (${s.id.slice(0, 8)}): no walker's leg phase jumps > 0.1 at A → D0 and D0 → D1`, async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page, s.year);
  await page.getByRole('combobox', { name: 'Watch it being built' }).selectOption(`set:${s.id}`);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook48).takeSet()?.checks.final, null, { timeout: 240_000 });
  const { dt } = setShots(s);
  const gaitAt = async (T: number) => {
    await page.waitForFunction((x) => !!(window.__marsStudio as unknown as Hook48).setGaitAt(x), T, { timeout: 60_000, polling: 250 });
    return (await page.evaluate((x) => (window.__marsStudio as unknown as Hook48).setGaitAt(x), T))!;
  };
  const circ = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
  const report: Record<string, unknown> = { set: s.id };
  for (const carry of [false, true]) {
    await page.evaluate((c) => (window.__marsStudio as unknown as Hook48).takeSetControl({ gaitCarry: c }), carry);
    for (const k of [1, 2]) {
      const seam = s.chapters[k].from * dt;
      const a = await gaitAt(seam - 1e-4), b = await gaitAt(seam);
      expect(a.chapter).toBe(s.chapters[k - 1].id);
      expect(b.chapter).toBe(s.chapters[k].id);
      const rows = Object.keys(b.gait).filter((id) => a.gait[id]).map((id) => {
        const x = a.gait[id], y = b.gait[id];
        return { id, before: { dist: Math.round(x.dist * 1000) / 1000, walk: x.walk, phase: x.phase }, after: { dist: Math.round(y.dist * 1000) / 1000, walk: y.walk, phase: y.phase }, jump: x.phase !== null && y.phase !== null ? Math.round(circ(x.phase, y.phase) * 1000) / 1000 : null };
      });
      expect(rows.length, 'people on both sides of the seam').toBeGreaterThan(0);
      expect(rows.every((r) => r.jump !== null), 'every person has a stride (templates loaded)').toBe(true);
      const max = Math.max(...rows.map((r) => r.jump!));
      const walking = rows.filter((r) => r.before.walk > 0 || r.after.walk > 0).map((r) => r.id);
      report[`${carry ? 'carry' : 'restart'} ${s.chapters[k - 1].id}→${s.chapters[k].id}`] = { seam, people: rows.length, walking, maxJump: max, rows };
      if (carry) {
        for (const r of rows) {
          expect(r.jump!, `${r.id}: leg phase jump at ${s.chapters[k - 1].id} → ${s.chapters[k].id}`).toBeLessThanOrEqual(0.1);
          expect(Math.abs(r.after.dist - r.before.dist), `${r.id}: walked metres continue across the seam`).toBeLessThan(0.01);
        }
      } else expect(max, 'restarting at 0 makes some leg phase jump (the W37 weak spot)').toBeGreaterThan(0.1);
    }
  }
  writeArtifact('studio-build-set-gait.json', report);
  console.log(`studio-build set gait: ${JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, typeof v === 'object' && v ? { people: (v as { people: number }).people, walking: (v as { walking: string[] }).walking, maxJump: (v as { maxJump: number }).maxJump } : v])))}`);
  expect(errors, 'console/page errors').toEqual([]);
});

// Direct camera on a set: a hold on a crew member inside D2 (the roof-deck relay), compiled against D2's take from the
// panel; the panel names D2; the shot list; Play drives the camera with the directed track inside D2; Save track adds it
// to D2's file only (the take and its planned camera untouched); Back restores the planned / held camera.
for (const s of sets) test(`chapter set Direct camera (${s.id.slice(0, 8)}): a hold on a crew member inside D2 → shot list, play, save into D2's file`, async ({ page }, testInfo) => {
  test.setTimeout(400_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page, s.year);
  await page.getByRole('combobox', { name: 'Watch it being built' }).selectOption(`set:${s.id}`);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook48).takeSet(), null, { timeout: 90_000 });
  const d2 = s.chapters.findIndex((c) => c.id === 'D2');
  expect(d2).toBeGreaterThan(0);
  const c = s.chapters[d2];
  const relay = stepMoment(s, 'D2', 'pass_up', 0.3);
  await scrubSet(page, relay.t);
  const at = (await setInfo48(page))!;
  expect(at.chapter.id).toBe('D2');
  // the crew member: the first person the planned shot at that moment frames ("… — m1 m2")
  const file = JSON.parse(fs.readFileSync(path.join(PUBLIC, c.file), 'utf8')) as { take: { id: string; dt: number }; camera: { id: string; data: { shots: { t0: number; t1: number; label: string }[] } }; cameras?: unknown };
  const local = at.chapter.local;
  const planned = file.camera.data.shots.find((x) => local >= x.t0 && local < x.t1)!;
  const crew = / — (m\d+)/.exec(planned.label)?.[1] ?? 'm1';
  const panel = page.locator('details.take-direct');
  await expect(panel.locator('summary')).toContainText('Direct camera · chapter D2');
  await panel.locator('summary').click();
  const scope = page.getByRole('note', { name: 'Direct camera applies to' });
  await expect(scope).toContainText('Applies to chapter 4/7 · D2:');
  await expect(scope).toContainText(`Save track adds it to D2's file (${path.basename(c.file)})`);
  await page.getByRole('combobox', { name: 'Subject kind' }).selectOption('entity');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(crew);
  await page.getByRole('combobox', { name: 'Verb' }).selectOption('hold');
  await page.getByRole('spinbutton', { name: 'Duration' }).fill('20');
  await page.getByRole('combobox', { name: 'Framing' }).selectOption('medium');
  await page.getByRole('button', { name: 'Replace' }).click();
  const dirs = JSON.parse(await page.getByRole('textbox', { name: 'Directions JSON' }).inputValue()) as { at: number }[];
  expect(dirs[0].at, 'the direction starts at D2\'s own (local) time').toBeCloseTo(Math.round(local * 10) / 10, 5);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Compute camera' }).click();
  const shots = page.getByRole('list', { name: 'Shot list' });
  await expect(shots).toBeVisible({ timeout: 120_000 });
  const computeMs = Date.now() - t0;
  const shotText = await shots.innerText();
  expect(shotText).toContain('hold');
  const meta = await panel.locator('.direct-meta').innerText();
  expect(meta).toMatch(/^dir-[0-9a-f]{12} · /);
  const trackId = meta.split(' · ')[0];
  await captureView(page, 'studio-build-set-direct-panel', { testInfo, compare: false });
  // play: the directed track drives the camera inside D2, from its first shot
  await page.getByRole('button', { name: 'Play directed track' }).click();
  await page.getByRole('button', { name: 'Pause take' }).click();
  let i = (await setInfo48(page))!;
  expect(i.directed).toMatchObject({ chapter: 'D2', id: trackId });
  expect(i.track).toMatchObject({ id: trackId, kind: 'directed', own: false });
  expect(i.chapter.id).toBe('D2');
  expect(i.chapter.local, 'Play starts at the first directed shot (then ran until Pause)').toBeGreaterThanOrEqual(dirs[0].at - 1e-6);
  expect(i.chapter.local).toBeLessThan(dirs[0].at + 2);
  await scrubSet(page, Math.round((i.t + 8) * 10) / 10);
  i = (await setInfo48(page))!;
  expect(i.track.own).toBe(false);
  await expect(page.getByLabel('Shot now')).toContainText('Directed (D2):');
  await captureView(page, 'studio-build-set-direct-hold', { testInfo, compare: false });
  const shown = await page.getByLabel('Shot now').innerText();
  // outside D2 the chapter's own (held) camera is back; inside D2 again the directed one
  await scrubSet(page, Math.round((s.chapters[d2 + 1].from * file.take.dt + 30) * 10) / 10);
  i = (await setInfo48(page))!;
  expect(i.chapter.id).not.toBe('D2');
  expect(i.track.own, 'another chapter plays its own camera').toBe(true);
  await scrubSet(page, Math.round((relay.t + 8) * 10) / 10);
  expect((await setInfo48(page))!.track.own).toBe(false);
  // save: the D2 file + cameras[trackId], downloaded under D2's file name; nothing else changes
  await panel.locator('summary').click();
  if (!(await page.getByRole('button', { name: 'Save track' }).isVisible())) await panel.locator('summary').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save track' }).click()]);
  expect(dl.suggestedFilename()).toBe(path.basename(c.file));
  const saved = JSON.parse(fs.readFileSync((await dl.path())!, 'utf8')) as typeof file & { cameras: Record<string, { id: string; takeId: string; kind: string }> };
  expect(Object.keys(saved.cameras)).toEqual([trackId]);
  expect(saved.cameras[trackId]).toMatchObject({ id: trackId, takeId: file.take.id, kind: 'directed' });
  const { cameras: _drop, ...rest } = saved;
  expect(file.cameras, 'the shipped D2 file carries no extra cameras').toBeUndefined();
  expect(JSON.stringify(rest), 'the downloaded file is D2\'s shipped file plus cameras').toBe(JSON.stringify(file));
  await expect(page.getByRole('status', { name: 'Saved track' })).toContainText(`Saved ${trackId} into ${path.basename(c.file)}`);
  // back to the planned / held camera
  await page.getByRole('button', { name: "Back to the take's camera" }).click();
  i = (await setInfo48(page))!;
  expect(i.directed).toBeNull();
  expect(i.track.own).toBe(true);
  const report = { set: s.id, chapter: 'D2', t: relay.t, local, crew, plannedShot: planned.label, directions: dirs, computeMs, trackId, shotList: shotText, shown, saved: { name: dl.suggestedFilename(), cameras: Object.keys(saved.cameras) } };
  writeArtifact('studio-build-set-direct.json', report);
  console.log(`studio-build set direct: ${JSON.stringify({ ...report, shotList: shotText.slice(0, 300) })}`);
  expect(errors, 'console/page errors').toEqual([]);
});
