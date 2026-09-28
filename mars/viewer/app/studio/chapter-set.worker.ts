// Chapter-set checks off the main thread (STUDIO_REPLAY.md "Chapter sets: playback"). The studio plays a set chapter by
// chapter; this worker reads every chapter once, in order, and posts per chapter:
// - hash: the chapter's final state hashes to its recorded `finalStateHash` and the manifest's;
// - start (continuity): chapter k's first frame is chapter k − 1's final state — `take.baselineStateHash` = the manifest's
//   `chapter.startHash` = chapter k − 1's `finalStateHash`, plus the engine's own `chapterContinuity` (entities0 = the
//   previous final entities, the replayed first frame within ½ mm / ½ mrad, same phase / activity / level). Chapter 0
//   starts from the set's `startStateHash`;
// - its refusal / blocked log on the set clock (take-log.ts, shifted by `from · dt`), so the log runs on across chapters
//   and the totals cover the whole set.
// Then the final checks on the last chapter's replayed last frame: the final state = the set's (the A+B pin), last frame
// = final state, and every frame / beam (`compareToCanonical`) and every phase-B part (`compareB`) of the building at the
// mars-<year> canonical pose — the same comparisons as engine/test/year-build-b.test.ts, from the year file. The phase-B
// plan takes ≈ 2 s to build, which is why this is a worker. Only one chapter plus the previous one are held at a time.
import { hashOf } from '../../engine/core/hash.ts';
import { chapterContinuity } from '../../engine/take/chapters.ts';
import { sampleTake, takeDuration } from '../../engine/take/replay.ts';
import { assemblyGraph } from '../../engine/campus/assembly.ts';
import { campusYearUrl, sceneFromYearFile, type CampusYearFile } from '../../engine/campus/history.ts';
import { buildingFootprint } from '../../engine/campus/bom.ts';
import { yearBuildPlan, yearBuildScene } from '../../engine/campus/sequence.ts';
import { compareB, compareToCanonical } from '../../engine/scenarios/year-build.ts';
import type { Take } from '../../engine/take/types.ts';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import { setClockTenths, takeLog, type TakeStep } from '../engine-view/take-log.ts';
import type { ChapterCheck, SetCheckIn, SetFinalCheck, SetWorkerOut } from './chapter-set.ts';

const post = (m: SetWorkerOut) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);
const r2 = (x: number) => Math.round(x * 100) / 100;
const BUILD = /^mars-(\d{4}):build:(.+)$/;

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** The replayed last frame of a take as a world: sampled pose + phase over the recorded entities (as take-checks.ts). */
function lastFrame(take: Take) {
  const last = sampleTake(take, takeDuration(take));
  let maxMm = 0;
  const missing: string[] = [];
  const entities: Record<string, Entity> = {};
  for (const [id, e] of Object.entries(take.finalState.entities)) {
    const f = last.entities[id];
    if (!f) { if (take.tracks[id]) missing.push(id); continue; }
    maxMm = Math.max(maxMm, Math.hypot(f.p[0] - e.pose.p[0], f.p[1] - e.pose.p[1], f.p[2] - e.pose.p[2]) * 1000);
    entities[id] = { ...e, pose: { p: f.p, yaw: f.yaw, pitch: f.pitch, roll: f.roll }, ...(f.phase ? { phase: f.phase as Entity['phase'] } : {}) };
  }
  return { world: { ...take.finalState, entities } as WorldState, frame: { ok: !missing.length && maxMm <= 2, maxMm: r2(maxMm), missing } };
}

async function finalChecks(set: SetCheckIn['set'], take: Take): Promise<SetFinalCheck> {
  const t0 = performance.now();
  const replayed = hashOf(take.finalState);
  const { world, frame } = lastFrame(take);
  const out: SetFinalCheck = { type: 'final', hash: { ok: replayed === take.finalStateHash && replayed === set.finalStateHash, replayed, set: set.finalStateHash }, frame, canonical: null, ms: 0 };
  const m = BUILD.exec(take.finalState.base.campus);
  if (m) {
    const year = Number(m[1]), assembly = m[2];
    const base = sceneFromYearFile(year, await json<CampusYearFile>(campusYearUrl(year)));
    const g = assemblyGraph(year, base);
    const fp = buildingFootprint(g.nodes.filter((n) => n.assembly === assembly));
    const build = yearBuildPlan(g, yearBuildScene(base, assembly, fp.c, 35), assembly, { phaseB: {} });
    const a = compareToCanonical(world, build), b = compareB(world, build);
    const fin = (x: number) => (Number.isFinite(x) ? x : 0);
    const roles: Record<string, number> = {};
    for (const c of b) if (c.ok) roles[c.role] = (roles[c.role] ?? 0) + 1;
    out.canonical = {
      checkpoint: `mars-${year}`,
      assembly,
      ok: a.length > 0 && a.every((c) => c.ok) && b.every((c) => c.ok),
      frames: { atPose: a.filter((c) => c.ok).length, total: a.length, maxMm: r2(Math.max(0, ...a.map((c) => fin(c.dist) * 1000))) },
      parts: { atPose: b.filter((c) => c.ok).length, total: b.length, maxMm: r2(Math.max(0, ...b.map((c) => fin(c.dist) * 1000))), byRole: roles },
      failures: [...a.filter((c) => !c.ok).map((c) => `${c.node} ${c.kind} ${c.phase ?? ''} ${r2(c.dist * 1000)} mm`), ...b.filter((c) => !c.ok).map((c) => `${c.part} ${c.role} ${c.phase ?? ''} ${r2(c.dist * 1000)} mm`)].slice(0, 20),
    };
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
}

async function run({ set, entries }: SetCheckIn) {
  let prev: Take | null = null;
  for (let k = 0; k < set.chapters.length; k++) {
    const c = set.chapters[k];
    const t0 = performance.now();
    const f = await json<{ take: Take; steps: TakeStep[] }>(c.file);
    const take = f.take;
    const final = hashOf(take.finalState);
    const expected = prev ? prev.finalStateHash : set.startStateHash;
    const manifest = entries[k]?.chapter?.startHash ?? null;
    const problems = prev ? chapterContinuity(prev, take) : [];
    if (take.baselineStateHash !== expected) problems.unshift(`starts from ${take.baselineStateHash.slice(0, 12)}, expected ${expected.slice(0, 12)}`);
    if (manifest !== null && manifest !== expected) problems.unshift(`manifest startHash ${manifest.slice(0, 12)} ≠ ${expected.slice(0, 12)}`);
    if (prev && take.startTick !== prev.startTick + prev.ticks) problems.push(`startTick ${take.startTick} ≠ ${prev.startTick + prev.ticks}`);
    const at = c.from * take.dt;
    const msg: ChapterCheck = {
      type: 'chapter', k, id: c.id,
      hash: { ok: final === take.finalStateHash && (entries[k]?.finalStateHash ?? final) === final, final },
      start: { ok: !problems.length, expected, baseline: take.baselineStateHash, manifest, problems: problems.slice(0, 6) },
      log: takeLog(take, f.steps, { at, clock: setClockTenths }),
      ms: 0,
    };
    msg.ms = Math.round(performance.now() - t0);
    post(msg);
    if (k === set.chapters.length - 1) post(await finalChecks(set, take));
    prev = take;
  }
}

self.onmessage = (e: MessageEvent<SetCheckIn>) => {
  run(e.data).catch((err: unknown) => post({ type: 'error', message: (err as Error).message ?? String(err) }));
};
