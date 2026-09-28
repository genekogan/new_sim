// Year build, phase A (owner feedback 2026-09-28 §7): the skeleton of one rack building of a canonical
// year, built from material piles in a fork of the year's protected checkpoint. HYPOTHETICAL order,
// piles and crew (campus/sequence.ts); the acceptance target is the checkpoint's own geometry.
//
//   const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022));
//   const reh = rehearse(s.history, s.workspace, s.plan, s.cfg);
//   compareToCanonical(reh.finalState, s.build)  // every sequenced frame / beam within 1 cm / 1°
import type { ActionDef } from '../actions/types.ts';
import { hashOf } from '../core/hash.ts';
import { wrapAngle } from '../core/math.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { carry } from '../carry/actions.ts';
import { assemblyGraph, type AssemblyGraph } from '../campus/assembly.ts';
import { buildingFootprint } from '../campus/bom.ts';
import { publishCampusYear, type CampusYearFile } from '../campus/history.ts';
import { yearBuildPlan, yearBuildScene, type YearBuildPlan } from '../campus/sequence.ts';
import type { CampusScene } from '../campus/types.ts';
import { CONSTRUCTION_ACTIONS, liftHandsInReach, uprightsSupported } from '../construction/index.ts';
import { takeFromBundle } from '../construction/bundle.ts';
import { cutStock } from '../construction/cut.ts';
import { hangHandsInReach, stanceAccessOk, STANCE_ACTIONS } from '../construction/stance.ts';
import { WorldHistory } from '../history/store.ts';
import { passUp } from '../construction/passup.ts';
import { installStairPart, installStringer, kitPartHandsInReach, kitPartsSupported, kitStairContributor } from '../construction/setpart.ts';
import { installWall } from '../construction/wall.ts';
import { MOVES_B } from '../construction/moves-b.ts';
import { SOLAR_ACTIONS } from '../construction/solar.ts';
import { progressiveContributor, progressiveSupported } from '../construction/contributor.ts';
import type { Section } from '../campus/sequence-b.ts';
import { walkTo } from '../locomotion/walk.ts';
import type { EngineConfig } from '../rehearsal/rehearse.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import type { Invariant } from '../runtime/runtime.ts';
import { bindTemplate } from '../sequence/bind.ts';
import type { BoundPlan } from '../sequence/types.ts';
import { Spatial } from '../spatial/service.ts';
import { def } from '../world/catalog.ts';
import type { WorldState } from '../world/types.ts';

export const YEAR_BUILD_RULES = 'mars-rules/year-build-phase-a';

export function yearBuildRegistry(): Map<string, ActionDef> {
  return new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry], ['take_from_bundle', takeFromBundle], ['cut', cutStock], ...[...CONSTRUCTION_ACTIONS, ...STANCE_ACTIONS].map((a) => [a.verb, a] as [string, ActionDef])]);
}
export const YEAR_BUILD_INVARIANTS: Invariant[] = [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS, uprightsSupported, liftHandsInReach, stanceAccessOk, hangHandsInReach];

// ---- phase B (W13): decks, stair, walls, solar ----
export function yearBuildRegistryB(): Map<string, ActionDef> {
  const r = yearBuildRegistry();
  for (const a of [passUp, installStringer, installStairPart, installWall, ...MOVES_B, ...SOLAR_ACTIONS] as ActionDef[]) r.set(a.verb, a);
  return r;
}
export const YEAR_BUILD_B_INVARIANTS: Invariant[] = [...YEAR_BUILD_INVARIANTS, progressiveSupported, kitPartHandsInReach, kitPartsSupported];

export type YearBuildSetup = {
  history: WorldHistory;
  /** Protected canonical workspace `mars-<year>` and the build fork. */
  canonical: string;
  workspace: string;
  graph: AssemblyGraph;
  scene: CampusScene;
  build: YearBuildPlan;
  plan: BoundPlan;
  cfg: EngineConfig;
};

/** Publish `mars-<year>` (protected), fork it, commit the piles + crew, bind the skeleton template. */
export function yearBuildSetup(year: number, assembly: string, file: CampusYearFile, opts: { radius?: number; bays?: number; phaseB?: { sections?: readonly Section[] } } = {}): YearBuildSetup {
  const history = new WorldHistory(YEAR_BUILD_RULES);
  const { canonical, base } = publishCampusYear(history, year, file);
  const graph = assemblyGraph(year, base);
  const fp = buildingFootprint(graph.nodes.filter((n) => n.assembly === assembly));
  const scene = yearBuildScene(base, assembly, fp.c, opts.radius ?? 35);
  const build = yearBuildPlan(graph, scene, assembly, { bays: opts.bays, ...(opts.phaseB ? { phaseB: opts.phaseB } : {}) });
  const workspace = `mars-${year}-build-${assembly}`;
  history.fork(canonical.id, workspace, `Mars ${year}: ${assembly} skeleton from the piles (hypothetical)`);
  const w = history.read(workspace);
  // the fork runs on its own static base: the year scene without the building, ground at the Kit datum
  const staticHash = hashOf(scene);
  w.base = { campus: `mars-${year}:build:${assembly}`, staticHash };
  for (const e of build.entities) w.entities[e.id] = e;
  history.commit(workspace, w, { kind: 'design-edit', note: `year build phase ${opts.phaseB ? 'A+B' : 'A'}: ${assembly} piles, cutting station and crew (hypothetical)` });
  const registry = opts.phaseB ? yearBuildRegistryB() : yearBuildRegistry();
  const plan = bindTemplate(build.template, build.bindings, { history, baseline: workspace, registry });
  // phase B: decks become walkable floors and the Kit stair a link (usable once complete) as they are built
  const contributors = opts.phaseB ? [progressiveContributor, kitStairContributor(build.partsB?.stairs ?? [])] : undefined;
  const cfg: EngineConfig = {
    registry, invariants: opts.phaseB ? YEAR_BUILD_B_INVARIANTS : YEAR_BUILD_INVARIANTS,
    services: () => ({ spatial: new Spatial(scene, { baseId: staticHash, ...(contributors ? { contributors } : {}) }) }), maxTicks: 20 * 60 * 60 * (opts.phaseB ? 16 : 4),
  };
  return { history, canonical: canonical.id, workspace, graph, scene, build, plan, cfg };
}

export type Comparison = { node: string; kind: 'upright' | 'beam'; ok: boolean; phase?: string; dist: number; dyaw: number };

/**
 * Final state vs the canonical checkpoint: each sequenced frame / beam must be `installed` with its box
 * centre within `tolM` and its yaw (mod π, parts are symmetric) within `tolRad` of the canonical part.
 */
export function compareToCanonical(final: WorldState, build: YearBuildPlan, tolM = 0.01, tolRad = Math.PI / 180): Comparison[] {
  return build.targets.map((t) => {
    const e = final.entities[t.node];
    if (!e) return { node: t.node, kind: t.kind, ok: false, dist: Infinity, dyaw: Infinity };
    const h = def(e.def).size[1];
    const c = [e.pose.p[0], e.pose.p[1] + h / 2, e.pose.p[2]];
    const dx = c[0] - t.c[0], dy = c[1] - t.c[1], dz = c[2] - t.c[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let dyaw = Math.abs(wrapAngle(e.pose.yaw - t.yaw));
    dyaw = Math.min(dyaw, Math.abs(Math.PI - dyaw));
    const upright = Math.abs(e.pose.pitch ?? 0) < 1e-6 && Math.abs(e.pose.roll ?? 0) < 1e-6;
    return { node: t.node, kind: t.kind, ok: e.phase === 'installed' && upright && dist <= tolM && dyaw <= tolRad, phase: e.phase, dist, dyaw };
  });
}
