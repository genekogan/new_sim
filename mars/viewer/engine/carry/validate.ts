// Plan-time validation for `carry` (spec §13 "validated"): crew/load checks,
// pickup and set-down geometry, the whole-formation SE(2) route, and each
// carrier's approach walk. Pure w.r.t. the world.
import { dcos, dist2, dsin, obbOverlap, pointInObb, type Vec2 } from '../core/math.ts';
import type { Diagnostic, PlanResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import { buildGrids, clearanceAt, nearestBlocker, type LevelGrid } from '../spatial/grid.ts';
import { findRoute, type Route } from '../spatial/path.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { carrierSpots, CARRIER_RADIUS, checkCrew, entityFrame, formationFor, laidPose, type Formation, type SE2 } from './formation.ts';
import { poseHit } from './sweep.ts';
import { planCarry, type Trajectory } from './planner.ts';
import { holdingDiagnostic } from '../construction/rules.ts';

export type CarryParams = { crew: string[]; item: string; to: { x: number; z: number; yaw: number; level?: number }; place?: 'lay' };

export type CarryProgram = {
  f: Formation;
  crew: string[];
  item: string;
  level: number;
  levelY: number;
  lying: Pose;
  pickup: SE2;
  approach: Vec2[];
  gather: (Route | null)[];
  traj: Trajectory;
  target: SE2;
  laid: Pose;
  setdown: Vec2[];
  stats: { expanded: number; keyposes: number };
};

const STAND_TOL = 0.02;
const fmt = (x: number, z: number) => `(${x.toFixed(1)}, ${z.toFixed(1)})`;
const bad = (d: Diagnostic): { ok: false; diagnostic: Diagnostic } => ({ ok: false, diagnostic: d });

export function labelOf(sp: Spatial, id: string) {
  return sp.scene.obstacles.find((o) => o.id === id)?.label ?? id;
}

/** Why a carrier cannot stand at p (or null). */
function standIssue(sp: Spatial, g: LevelGrid, p: Vec2): string | null {
  if (clearanceAt(g, p) >= CARRIER_RADIUS - STAND_TOL) return null;
  const b = nearestBlocker(g, p, 1.0);
  return b ? `blocked by '${labelOf(sp, b)}'` : 'off the walkable floor';
}

/** Why the load's formation cannot be at q (or null). */
function formationIssue(sp: Spatial, g: LevelGrid, f: Formation, q: SE2, crew: string[]): string | null {
  const out = { p: [0, 0] as Vec2 };
  const k = poseHit(g, f, q, 0, out);
  if (k < 0) return null;
  const d = f.discs[k];
  const part = d.part === 'load' ? `the load` : `carrier ${crew[d.carrier!]}`;
  const b = nearestBlocker(g, out.p, 1.0);
  return `${part} would intersect ${b ? `'${labelOf(sp, b)}'` : 'the edge of the floor'} at ${fmt(out.p[0], out.p[1])}`;
}

/**
 * Exact check that the load can be laid at q: its ground footprint overlaps no
 * obstacle or other component (at any height it occupies), lies on floor, and
 * every carrier has room to stand beside it. Returns a reason or null.
 */
export function laidIssue(sp: Spatial, f: Formation, q: SE2, level: number, levelY: number, exclude: string, crew: string[]): { reason: string; subjects: string[] } | null {
  const pose = laidPose(f, q, levelY);
  const fake = { id: '_laid', def: f.defId, kind: 'component', pose } as Entity;
  const fp = entityFootprint(fake);
  for (const o of sp.scene.obstacles) {
    if (o.id === exclude || o.y1 <= levelY + 1e-3 || o.y0 >= fp.y1 - 1e-3) continue;
    if (obbOverlap(fp.obb, o.obb)) return { reason: `laying it there would overlap '${o.label ?? o.id}'`, subjects: [o.id] };
  }
  const floors = sp.scene.surfaces.filter((s) => s.level === level);
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => {
    const c = dcos(fp.obb.yaw), s = dsin(fp.obb.yaw);
    const lx = a * fp.obb.half[0], lz = b * fp.obb.half[1];
    return [fp.obb.c[0] + lx * c - lz * s, fp.obb.c[1] + lx * s + lz * c] as Vec2;
  });
  for (const p of corners)
    if (!floors.some((s) => pointInObb(p, s.obb, 1e-6))) return { reason: `its footprint would leave the floor at ${fmt(p[0], p[1])}`, subjects: [] };
  const g = sp.level(level)!;
  const spots = carrierSpots(f, q, entityFrame(fake).halfW);
  for (let i = 0; i < spots.length; i++) {
    const why = standIssue(sp, g, spots[i]);
    if (why) return { reason: `carrier ${crew[i]} would have no room to stand at ${fmt(spots[i][0], spots[i][1])} (${why})`, subjects: [crew[i]] };
  }
  return null;
}

export function planCarryAction(rt: Runtime, p: CarryParams): PlanResult<CarryProgram> {
  const w = rt.world;
  const sp = rt.services.spatial as Spatial;
  const item = w.entities[p.item];
  if (!item) return bad({ code: 'entity.unknown', message: `no item "${p.item}"`, subjects: [p.item] });
  if (item.kind !== 'component') return bad({ code: 'carry.not-carriable', message: `"${p.item}" is a ${item.kind}, not a component`, subjects: [p.item] });
  const people: Entity[] = [];
  for (const id of p.crew) {
    const e = w.entities[id];
    if (!e) return bad({ code: 'entity.unknown', message: `no crew member "${id}"`, subjects: [id] });
    if (e.kind !== 'human' || !e.human) return bad({ code: 'actor.not-human', message: `"${id}" is a ${e.kind}, not a person`, subjects: [id] });
    const hd = holdingDiagnostic(w, id); // someone holding up a frame cannot walk off to carry (review C2)
    if (hd) return bad(hd);
    people.push(e);
  }
  const crewDiag = checkCrew(item.def, p.crew.length, item.id);
  if (crewDiag) return bad({ ...crewDiag, subjects: [item.id, ...p.crew] });
  if ((item.phase !== 'stored' && item.phase !== 'staged') || item.support?.kind !== 'ground')
    return bad({ code: 'carry.item-unavailable', message: `${item.id} is ${item.phase ?? 'in use'} (support ${item.support?.kind ?? 'none'}); only items lying on the ground can be picked up`, subjects: [item.id] });
  const level = people[0].human!.level;
  const split = people.find((e) => e.human!.level !== level);
  if (split) return bad({ code: 'carry.crew-split', message: `${split.id} is on level ${split.human!.level} but ${people[0].id} is on level ${level}; the crew must start on one level`, subjects: [split.id] });
  if ((p.to.level ?? level) !== level)
    return bad({ code: 'carry.level-change', message: `carrying the load from level ${level} to level ${p.to.level} would need stairs or a lift; carrying loads between levels is not supported yet`, subjects: [item.id] });
  sp.sync(w);
  let g = sp.level(level);
  if (!g) return bad({ code: 'route.unknown-level', message: `level ${level} does not exist` });
  const levelY = g.y;
  // a tall-lying item would block its own pickup in the grid: plan on a grid without it
  const own = sp.scene.obstacles.find((o) => o.id === item.id);
  if (own && own.y1 > levelY + 0.22) g = buildGrids({ ...sp.scene, levels: sp.scene.levels.filter((l) => l.id === level), obstacles: sp.scene.obstacles.filter((o) => o.id !== item.id) }, sp.cell).levels.get(level)!;
  const f = formationFor(item.def, p.crew.length);
  const lie = entityFrame(item);
  // pickup: the crew may lift facing either way along the load
  const startCands: SE2[] = [lie.q, { ...lie.q, th: lie.q.th + Math.PI }];
  const startWhy: string[] = [];
  const starts = startCands.filter((q) => {
    const spots = carrierSpots(f, q, lie.halfW);
    for (let i = 0; i < spots.length; i++) {
      const why = standIssue(sp, g!, spots[i]);
      if (why) { startWhy.push(`${p.crew[i]} has no room to stand at ${fmt(spots[i][0], spots[i][1])} (${why})`); return false; }
    }
    const why = formationIssue(sp, g!, f, q, p.crew);
    if (why) { startWhy.push(`once lifted, ${why}`); return false; }
    return true;
  });
  if (!starts.length)
    return bad({ code: 'carry.pickup-blocked', message: `the crew cannot pick up the ${f.name} ${item.id} at ${fmt(lie.q.x, lie.q.z)}: ${startWhy[0]}`, subjects: [item.id, ...p.crew], at: [lie.q.x, levelY, lie.q.z] });
  // set-down target (yaw = long-axis direction; the crew may arrive facing either way)
  const tq: SE2 = { x: p.to.x, z: p.to.z, th: p.to.yaw };
  const cands = [tq, { ...tq, th: tq.th + Math.PI }];
  const lays = cands.map((q) => laidIssue(sp, f, q, level, levelY, item.id, p.crew));
  if (lays.every((l) => l)) {
    const lay = lays[0]!;
    return bad({ code: 'carry.target-blocked', message: `the ${f.name} ${item.id} cannot be set down at ${fmt(tq.x, tq.z)}: ${lay.reason}`, subjects: [item.id, ...lay.subjects], at: [tq.x, levelY, tq.z] });
  }
  const goalWhy: string[] = [];
  const goals = cands.filter((q, i) => {
    if (lays[i]) return false;
    const why = formationIssue(sp, g!, f, q, p.crew);
    if (why) goalWhy.push(why);
    return !why;
  });
  const humansFit = () =>
    people.every((e) => sp.route(w, HUMAN_PROFILE, { level, p: [e.pose.p[0], e.pose.p[2]] }, { level, p: [tq.x, tq.z] }, { goalTolerance: 1.0 }).ok);
  const routeFail = (why: string, extra: Partial<Diagnostic> = {}) => {
    const fit = humansFit();
    return bad({
      code: fit ? 'carry.clearance' : 'carry.no-route',
      message: fit ? `every crew member could walk to ${fmt(tq.x, tq.z)} alone, but the carrying formation cannot: ${why}` : why,
      subjects: [item.id, ...p.crew, ...(extra.subjects ?? [])],
      at: extra.at ?? [tq.x, levelY, tq.z],
      details: extra.details,
    });
  };
  if (!goals.length) return routeFail(`the ${f.name} formation does not fit at the target ${fmt(tq.x, tq.z)}: ${goalWhy[0]}`);
  const r = planCarry({ g, f, starts, goals, labelOf: (id) => labelOf(sp, id), carrierNames: p.crew });
  if (!r.ok) return routeFail(r.diagnostic.message, r.diagnostic);
  const pickup = starts[r.start], target = goals[r.goal];
  // approach walks to the grip spots around the lying item (the item is an obstacle for the approach)
  const approach = carrierSpots(f, pickup, lie.halfW);
  const gather: (Route | null)[] = [];
  let aug: ReturnType<typeof buildGrids> | null = null;
  for (let i = 0; i < people.length; i++) {
    const e = people[i];
    const at: Vec2 = [e.pose.p[0], e.pose.p[2]];
    if (dist2(at, approach[i]) < 0.05) { gather.push(null); continue; }
    const fp = entityFootprint(item);
    const scene = { ...sp.scene, levels: sp.scene.levels.filter((l) => l.id === level), links: [], obstacles: [...sp.scene.obstacles.filter((o) => o.id !== item.id), { id: item.id, obb: fp.obb, y0: levelY, y1: levelY + 1, kind: 'component' as const }] };
    aug ??= buildGrids(scene, sp.cell);
    const rr = findRoute(aug, scene, HUMAN_PROFILE, { level, p: at }, { level, p: approach[i] }, { goalTolerance: 0.5 });
    if (!rr.ok) return bad({ ...rr.diagnostic, code: 'carry.gather-unreachable', message: `${e.id} cannot reach grip ${f.carriers[i].slot} of ${item.id} at ${fmt(approach[i][0], approach[i][1])}: ${rr.diagnostic.message}`, subjects: [e.id, item.id] });
    gather.push(rr.route);
  }
  const laid = laidPose(f, target, levelY);
  const setdown = carrierSpots(f, target, entityFrame({ ...item, pose: laid }).halfW);
  return {
    ok: true,
    program: { f, crew: [...p.crew], item: item.id, level, levelY, lying: item.pose, pickup, approach, gather, traj: r.traj, target, laid, setdown, stats: { expanded: r.expanded, keyposes: r.keyposes } },
  };
}
