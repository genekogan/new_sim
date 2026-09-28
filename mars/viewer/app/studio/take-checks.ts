// Final-frame checks for a replayed take (docs/engineering/STUDIO_REPLAY.md). Lazy-imported by take-host.ts.
// 1. hash: the take's final state hashes to its recorded `finalStateHash` (loadTakeFile already refuses a take
//    whose state does not), and that equals the manifest's hash.
// 2. frame: the replayed frame at the last tick (what the studio draws) against the recorded final state — every
//    entity present in both, positions within 2 mm (the take's 1 mm quantum + interpolation).
// 3. canonical (year-build forks only, `base.campus` = mars-<year>:build:<assembly>): every frame / beam of the
//    building that the take contains, as replayed at the last tick, against the protected year checkpoint
//    `mars-<year>` — the engine's own `compareToCanonical` (installed, upright, ≤ 1 cm, ≤ 1°) over targets taken
//    from the assembly graph of the year file. Frames / beams of the building not in the take are counted as
//    "outside this take" (a tranche), never as failures.
import { hashOf } from '../../engine/core/hash.ts';
import { assemblyGraph } from '../../engine/campus/assembly.ts';
import { sceneFromYearFile } from '../../engine/campus/history.ts';
import { compareToCanonical, type Comparison } from '../../engine/scenarios/year-build.ts';
import type { Target, YearBuildPlan } from '../../engine/campus/sequence.ts';
import { sampleTake, takeDuration } from '../../engine/take/replay.ts';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import type { TakeReplayFile } from '../engine-view/take-replay.ts';
import { buildOf, yearFile } from './direct-camera.ts';

export type CanonicalCheck = {
  checkpoint: string;
  assembly: string;
  ok: boolean;
  atPose: number;
  total: number;
  /** frames / beams of the building that this take does not build (a tranche) */
  outside: number;
  maxMm: number;
  maxDeg: number;
  failures: { node: string; kind: string; phase?: string; mm: number; deg: number }[];
};
export type TakeChecks = {
  hash: { ok: boolean; replayed: string; recorded: string; manifest: string | null };
  frame: { ok: boolean; entities: number; maxMm: number; missing: string[] };
  canonical: CanonicalCheck | null;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export async function takeChecks(file: TakeReplayFile, manifestHash: string | null): Promise<TakeChecks> {
  const take = file.take;
  const replayed = hashOf(take.finalState);
  const hash = { ok: replayed === take.finalStateHash && (manifestHash === null || manifestHash === replayed), replayed, recorded: take.finalStateHash, manifest: manifestHash };

  const last = sampleTake(take, takeDuration(take));
  let maxMm = 0;
  const missing: string[] = [];
  for (const [id, e] of Object.entries(take.finalState.entities)) {
    const f = last.entities[id];
    if (!f) { if (take.tracks[id]) missing.push(id); continue; }
    maxMm = Math.max(maxMm, Math.hypot(f.p[0] - e.pose.p[0], f.p[1] - e.pose.p[1], f.p[2] - e.pose.p[2]) * 1000);
  }
  const frame = { ok: !missing.length && maxMm <= 2, entities: Object.keys(last.entities).length, maxMm: r2(maxMm), missing };

  let canonical: CanonicalCheck | null = null;
  const build = buildOf(take);
  if (build) {
    const g = assemblyGraph(build.year, sceneFromYearFile(build.year, await yearFile(build.year)));
    const nodes = g.nodes.filter((n) => n.assembly === build.assembly && (n.kind === 'upright' || n.kind === 'beam'));
    const inTake = nodes.filter((n) => take.tracks[n.id]);
    const targets: Target[] = inTake.map((n) => ({ node: n.id, def: n.def!, kind: n.kind as 'upright' | 'beam', c: n.box.c, yaw: n.box.yaw }));
    // the replayed last frame as a world: sampled pose + phase over the recorded entity
    const entities: Record<string, Entity> = {};
    for (const [id, f] of Object.entries(last.entities)) {
      const src = take.finalState.entities[id];
      if (src) entities[id] = { ...src, pose: { p: f.p, yaw: f.yaw, pitch: f.pitch, roll: f.roll }, ...(f.phase ? { phase: f.phase as Entity['phase'] } : {}) };
    }
    // compareToCanonical reads only `targets` of the plan
    const cmp: Comparison[] = compareToCanonical({ ...take.finalState, entities } as WorldState, { targets } as Pick<YearBuildPlan, 'targets'> as YearBuildPlan);
    const ok = cmp.filter((c) => c.ok);
    canonical = {
      checkpoint: `mars-${build.year}`,
      assembly: build.assembly,
      ok: cmp.length > 0 && ok.length === cmp.length,
      atPose: ok.length,
      total: cmp.length,
      outside: nodes.length - inTake.length,
      maxMm: r2(Math.max(0, ...cmp.map((c) => (Number.isFinite(c.dist) ? c.dist * 1000 : 0)))),
      maxDeg: r2(Math.max(0, ...cmp.map((c) => (Number.isFinite(c.dyaw) ? (c.dyaw * 180) / Math.PI : 0)))),
      failures: cmp.filter((c) => !c.ok).map((c) => ({ node: c.node, kind: c.kind, ...(c.phase ? { phase: c.phase } : {}), mm: r2(c.dist * 1000), deg: r2((c.dyaw * 180) / Math.PI) })),
    };
  }
  return { hash, frame, canonical };
}
