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
import { buildingFootprint, otherWorkZones } from '../campus/bom.ts';
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
import { MOVES_B, stairWorkOk } from '../construction/moves-b.ts';
import { SOLAR_ACTIONS } from '../construction/solar.ts';
import { progressiveContributor, progressiveSupported } from '../construction/contributor.ts';
import type { Section } from '../campus/sequence-b.ts';
import type { PartB } from '../campus/parts-b.ts';
import { entityCorners, type Contributor, type SceneContribution } from '../spatial/service.ts';
import type { Entity } from '../world/types.ts';
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
/** Phase B invariants; the support-chain checks re-run only when rack / deck / stair state changed (supportKey). */
export const yearBuildBInvariants = (): Invariant[] => [...YEAR_BUILD_INVARIANTS, cachedInvariant(progressiveSupported), kitPartHandsInReach, cachedInvariant(kitPartsSupported), stairWorkOk];
export const YEAR_BUILD_B_INVARIANTS: Invariant[] = yearBuildBInvariants();

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
export function yearBuildSetup(year: number, assembly: string, file: CampusYearFile, opts: { radius?: number; bays?: number; phaseB?: { sections?: readonly Section[]; only?: (p: PartB, i: number, all: PartB[], dir: 1 | -1) => boolean }; avoidNeighbours?: boolean } = {}): YearBuildSetup {
  const history = new WorldHistory(YEAR_BUILD_RULES);
  const { canonical, base } = publishCampusYear(history, year, file);
  const graph = assemblyGraph(year, base);
  const fp = buildingFootprint(graph.nodes.filter((n) => n.assembly === assembly));
  const scene = yearBuildScene(base, assembly, fp.c, opts.radius ?? 35);
  const build = yearBuildPlan(graph, scene, assembly, { bays: opts.bays, ...(opts.phaseB ? { phaseB: opts.phaseB } : {}), ...(opts.avoidNeighbours ? { avoid: otherWorkZones(graph, assembly).map((z) => z.zone) } : {}) });
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
  // (cached on the state they depend on: re-deriving support chains on every sync while a load is carried is slow)
  const contributors = opts.phaseB ? [cachedContributor(progressiveContributor), cachedContributor(kitStairContributor(build.partsB?.stairs ?? []))] : undefined;
  const cfg: EngineConfig = {
    registry, invariants: opts.phaseB ? yearBuildBInvariants() : YEAR_BUILD_INVARIANTS,
    services: () => ({ spatial: new Spatial(scene, { baseId: staticHash, ...(contributors ? { contributors } : {}) }) }), maxTicks: 20 * 60 * 60 * (opts.phaseB ? 16 : 4),
  };
  return { history, canonical: canonical.id, workspace, graph, scene, build, plan, cfg };
}

// ---- W38: every 2022 rack house through the same rules ----
/** The four rack houses of Mars 2022: one template (12 frames of 16 ft × 3 ft in 4 lines × 3 rows, 54 beams of 12 ft at 0.22 / 2.48 / 4.757 m). */
export const HOUSES_2022 = ['chiba', 'east-house', 'kitchen', 'west-house'] as const;
/**
 * Phase-B tranche filter: the first ground-floor deck strip over the first bay built — the lowest level's lowest strip
 * (next to geometric frame line 0 in every 2022 house), or its highest when the skeleton is built from the other end
 * (`dir` −1, sequence.ts lay-out room rule).
 */
export function firstGroundStrip(p: PartB, _i: number, all: PartB[], dir: 1 | -1 = 1): boolean {
  if (p.kind !== 'deck') return false;
  const decks = all.filter((x) => x.kind === 'deck');
  const lv = Math.min(...decks.map((x) => Number(x.meta.level)));
  const vs = decks.filter((x) => Number(x.meta.level) === lv).map((x) => Number(x.meta.strip));
  const s0 = dir === 1 ? Math.min(...vs) : Math.max(...vs);
  return Number(p.meta.level) === lv && Number(p.meta.strip) === s0;
}
/**
 * One house's A+B build (W38), the same rules for every house: crew of six, the yard clear of the house's own work zone,
 * of every scene obstacle (the neighbouring houses stand) AND of the other rack houses' work zones (`avoidNeighbours`:
 * PROVISIONAL yard rule v2 — east-house's pinned runs keep the v1 yard, see YEAR_BUILD.md). `tranche`: the default-suite
 * slice — the first bay (frame lines 0–1) + the first ground-floor deck strip (3 pieces cut, notched, pushed in).
 */
export function yearBuildHouseSetup(year: number, house: string, file: CampusYearFile, opts: { tranche?: boolean } = {}): YearBuildSetup {
  return yearBuildSetup(year, house, file, opts.tranche ? { bays: 1, phaseB: { sections: ['D0'], only: firstGroundStrip }, avoidNeighbours: true } : { phaseB: {}, avoidNeighbours: true });
}

/**
 * A contributor re-run only when what it reads changed: every rack frame / beam (phase, support, pose, connections),
 * every installed or staged plywood sheet and every Kit stair part. Same output as calling it every sync.
 */
/** What the phase-B support chains read: every rack frame / beam, installed or staged plywood, Kit stair parts (phase, support, holders, connections, pose). */
export function supportKey(world: WorldState): string {
  const parts: string[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.kind !== 'component') continue;
    const cat = def(e.def).category;
    if (!(cat === 'rack-upright' || cat === 'rack-beam' || (cat === 'plywood' && (e.phase === 'installed' || e.phase === 'staged')) || e.def.startsWith('stair-'))) continue;
    const s = e.support;
    parts.push(`${e.id}|${e.phase}|${s?.kind}|${s?.kind === 'held' ? s.by.length : ''}|${(e.connections ?? []).map((x) => x.to).join(',')}|${e.pose.p.join(',')}|${e.pose.yaw}|${e.pose.pitch ?? 0}|${e.pose.roll ?? 0}`);
  }
  return parts.join(';');
}
/** A contributor re-run only when supportKey changed: same output as calling it every sync. */
export function cachedContributor(c: Contributor): Contributor {
  let key = '';
  let last: SceneContribution | null = null;
  return (world, base) => {
    const k = supportKey(world);
    if (last === null || k !== key) { key = k; last = c(world, base); }
    return last;
  };
}
/** An invariant over support chains only, re-run when supportKey changed (one instance per run: yearBuildBInvariants()). */
export function cachedInvariant(inv: Invariant): Invariant {
  let key = '';
  let last: ReturnType<Invariant> | null = null;
  return (rt) => {
    const k = supportKey(rt.world);
    if (last === null || k !== key) { key = k; last = inv(rt); }
    return last;
  };
}

export type Comparison = { node: string; kind: 'upright' | 'beam'; ok: boolean; phase?: string; dist: number; dyaw: number };

export type ComparisonB = { part: string; node: string; kind: string; role: string; ok: boolean; phase?: string; dist: number; dang: number };
/**
 * Phase B: every sequenced part installed at its target pose (the material rule's physical placement, parts-b.ts)
 * within `tolM` (pose origin) and `tolRad` (yaw mod π, pitch, roll). The Kit-drawing offsets of those placements
 * are reported by `kitOffsets`, not hidden.
 */
export function compareB(final: WorldState, build: YearBuildPlan, tolM = 0.01, tolRad = Math.PI / 180): ComparisonB[] {
  const parts = build.partsB?.parts ?? [];
  const done = new Set(build.doneB ?? []);
  return parts.filter((p) => done.has(p.id)).map((p) => {
    const e = final.entities[p.id];
    if (!e) return { part: p.id, node: p.nodes[0], kind: p.kind, role: p.role, ok: false, dist: Infinity, dang: Infinity };
    const dx = e.pose.p[0] - p.pose.p[0], dy = e.pose.p[1] - p.pose.p[1], dz = e.pose.p[2] - p.pose.p[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let dyaw = Math.abs(wrapAngle(e.pose.yaw - p.pose.yaw));
    dyaw = Math.min(dyaw, Math.abs(Math.PI - dyaw));
    const dang = Math.max(dyaw, Math.abs((e.pose.pitch ?? 0) - (p.pose.pitch ?? 0)), Math.abs((e.pose.roll ?? 0) - (p.pose.roll ?? 0)));
    return { part: p.id, node: p.nodes[0], kind: p.kind, role: p.role, ok: e.phase === 'installed' && dist <= tolM && dang <= tolRad, phase: e.phase, dist, dang };
  });
}

/** Per Kit node: the box of its installed parts vs the Kit's box (centre offset, extent difference), with the rule's stated offset. */
export function kitOffsets(final: WorldState, build: YearBuildPlan): { node: string; kind: string; parts: number; installed: number; dc: [number, number, number]; offset: string }[] {
  const parts = build.partsB?.parts ?? [];
  return (build.partsB?.kit ?? []).map((k) => {
    const ps = parts.filter((p) => p.nodes.includes(k.node) && (p.role !== 'panel-rail'));
    const es = ps.map((p) => final.entities[p.id]).filter((e) => e && e.phase === 'installed');
    if (!es.length) return { node: k.node, kind: k.kind, parts: ps.length, installed: 0, dc: [NaN, NaN, NaN] as [number, number, number], offset: k.offset };
    const cs = es.flatMap((e) => entityCorners(e!));
    const lo = [0, 1, 2].map((i) => Math.min(...cs.map((c) => c[i]))), hi = [0, 1, 2].map((i) => Math.max(...cs.map((c) => c[i])));
    const c = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2);
    return { node: k.node, kind: k.kind, parts: ps.length, installed: es.length, dc: [c[0] - k.c[0], c[1] - k.c[1], c[2] - k.c[2]] as [number, number, number], offset: k.offset };
  });
}

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
