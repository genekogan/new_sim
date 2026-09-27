// Work access for progressive construction — Mars assembly model v1, approximate
// (rule-based plausibility, not ergonomics). Where may a crew member stand to set
// a component whose top is at height y?
//   * on the ground or on any walkable deck level in the Spatial scene — decks
//     only appear there once installed AND supported (contributor.ts) — whose
//     floor is at most STANDING_REACH below y and not above y ("work from deck");
//   * within ARM_REACH horizontally of the component's footprint;
//   * with standing room (clearance ≥ radius + 0.03), not inside the component's
//     own footprint when it would be a body-height obstacle on that level, not
//     next to another person, and with a walking route from where they are now.
// Ladders / scaffold are not modelled: work more than 2.1 m above every
// accessible floor is refused (`reach.too-high`).
import { rot2, sub2, type OBB2, type Vec2, type Vec3 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { cellOf, clearanceAt, type LevelGrid } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { holdingDiagnostic, STANDING_REACH } from './rules.ts';
import { childrenState, walkCrew, type Children } from './children.ts';

export const ARM_REACH = 0.8; // m, horizontal: station → nearest point of the component
export const STAGE_RADIUS = 3.0; // m: components must be delivered (carried) this close before installing
export const LEVEL_STEP = 0.5; // m: deck level ids are round(y / LEVEL_STEP) — stable, height-derived
export const levelFor = (y: number) => Math.round(y / LEVEL_STEP);

export type Station = { actor: string; level: number; p: Vec2; yaw: number };
export type Fail = { ok: false; diagnostic: Diagnostic };
export const fail = (code: string, message: string, subjects: string[], at?: Vec3): Fail => ({ ok: false, diagnostic: { code, message, subjects, at } });
export const f2 = (x: number) => x.toFixed(2);

/** A component about to be installed: footprint, top (work height) and bottom. */
export type WorkTarget = { label: string; obb: OBB2; y: number; y0: number };

export function spatialOf(rt: Runtime): Spatial {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  return sp;
}

export function distToObb(p: Vec2, o: OBB2): number {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return Math.hypot(Math.max(Math.abs(l[0]) - o.half[0], 0), Math.max(Math.abs(l[1]) - o.half[1], 0));
}

/** Crew sanity shared by the construction verbs. */
export function crewCheck(rt: Runtime, crew: string[], min: number, max: number, what: string): Fail | null {
  if (new Set(crew).size !== crew.length) return fail('crew.duplicate', `crew for ${what} lists someone twice`, crew);
  if (crew.length < min || crew.length > max)
    return fail('crew.size', `${what} needs ${min === max ? min : `${min}–${max}`} ${max === 1 ? 'person' : 'people'}; ${crew.length} assigned`, crew);
  for (const c of crew) {
    if (rt.world.entities[c]?.kind !== 'human') return fail('entity.unknown', `no person "${c}"`, [c]);
    const d = holdingDiagnostic(rt.world, c);
    if (d) return { ok: false, diagnostic: d };
  }
  return null;
}

/** Component lying at the work area (delivered by `carry`), within STAGE_RADIUS of where it goes. */
export function stagedCheck(e: Entity, target: Vec2, code: string): Fail | null {
  if (!(e.phase === 'staged' || e.phase === 'stored') || e.support?.kind !== 'ground')
    return fail(code, `${e.id} must be lying on the ground at the work area (it is ${e.phase ?? 'unplaced'}, support ${e.support?.kind ?? 'none'})`, [e.id]);
  const d = Math.hypot(e.pose.p[0] - target[0], e.pose.p[2] - target[1]);
  if (d > STAGE_RADIUS)
    return fail(code, `${e.id} lies ${f2(d)} m from where it goes (${f2(target[0])}, ${f2(target[1])}); carry it within ${STAGE_RADIUS} m first`, [e.id]);
  return null;
}

/**
 * Pick one station per crew member (anchors[i] = the spot crew member i should
 * be near, e.g. one end of a joist). Deterministic: candidates are generated in
 * a fixed lattice order and sorted by (floor height, distance to anchor, index).
 */
export function findStations(rt: Runtime, crew: string[], anchors: Vec2[], t: WorkTarget, avoid: OBB2[] = []): { ok: true; stations: Station[] } | Fail {
  const sp = spatialOf(rt);
  const w = rt.world;
  const r = HUMAN_PROFILE.radius;
  const levels = [...sp.scene.levels].sort((a, b) => a.y - b.y || a.id - b.id);
  const eligible = levels.filter((lv) => lv.y <= t.y + 0.05 && t.y - lv.y <= STANDING_REACH);
  if (!eligible.length) {
    const below = levels.filter((lv) => lv.y <= t.y);
    const top = below[below.length - 1];
    return fail(
      'reach.too-high',
      `${t.label} at ${f2(t.y)} m is out of reach: the highest walkable floor below it (${top ? `level ${top.id} at ${f2(top.y)} m` : 'none'}) is ${top ? f2(t.y - top.y) : '?'} m down (standing reach ${STANDING_REACH} m) and no supported deck lies within reach; ladders/scaffold are not modelled`,
      crew,
    );
  }
  type Cand = { level: number; y: number; p: Vec2; k: number };
  const cands: Cand[] = [];
  const others = Object.values(w.entities).filter((e) => e.kind === 'human' && e.human && !crew.includes(e.id));
  const R = ARM_REACH, STEP = 0.2;
  for (const lv of eligible) {
    const g = sp.level(lv.id);
    if (!g) continue;
    const bodyBand = t.y0 < lv.y + HUMAN_PROFILE.height && t.y > lv.y + HUMAN_PROFILE.stepHeight;
    const nu = Math.floor((t.obb.half[0] + R) / STEP), nv = Math.floor((t.obb.half[1] + R) / STEP);
    for (let i = -nu; i <= nu; i++)
      for (let j = -nv; j <= nv; j++) {
        const o = rot2([i * STEP, j * STEP], t.obb.yaw);
        const p: Vec2 = [t.obb.c[0] + o[0], t.obb.c[1] + o[1]];
        const d = distToObb(p, t.obb);
        if (d > R) continue;
        if (bodyBand && d < r + 0.05) continue;
        if (clearanceAt(g, p) < r + 0.03) continue;
        if (avoid.some((a) => distToObb(p, a) < r + 0.05)) continue;
        if (others.some((h) => h.human!.level === lv.id && Math.hypot(h.pose.p[0] - p[0], h.pose.p[2] - p[1]) < 2 * r + 0.1)) continue;
        cands.push({ level: lv.id, y: lv.y, p, k: cands.length });
      }
  }
  const chosen: Station[] = [];
  for (const [i, actor] of crew.entries()) {
    const a = w.entities[actor];
    const anchor = anchors[Math.min(i, anchors.length - 1)];
    const order = cands
      .filter((c) => !chosen.some((s) => s.level === c.level && Math.hypot(s.p[0] - c.p[0], s.p[1] - c.p[1]) < 2 * r + 0.15))
      .sort((x, y) => x.y - y.y || Math.hypot(x.p[0] - anchor[0], x.p[1] - anchor[1]) - Math.hypot(y.p[0] - anchor[0], y.p[1] - anchor[1]) || x.k - y.k);
    let pick: Station | null = null;
    let lastWhy = '';
    // a failed route marks the candidate's whole connected standing region as unreachable
    // (e.g. the enclosed floor inside a rack bay), so it costs one search, not one per cell
    const bad = new Map<number, Uint8Array>();
    let tries = 0;
    for (const c of order) {
      const g = sp.level(c.level)!;
      const cell = cellOf(g, c.p);
      if (bad.get(c.level)?.[cell]) continue;
      if (++tries > 24) break;
      const rr = sp.route(w, HUMAN_PROFILE, { level: a.human!.level, p: [a.pose.p[0], a.pose.p[2]] }, { level: c.level, p: c.p });
      if (!rr.ok) {
        lastWhy = rr.diagnostic.message;
        if (!bad.has(c.level)) bad.set(c.level, new Uint8Array(g.nx * g.nz));
        floodMark(g, cell, r, bad.get(c.level)!);
        continue;
      }
      pick = { actor, level: c.level, p: c.p, yaw: Math.atan2(anchor[1] - c.p[1], anchor[0] - c.p[0]) };
      break;
    }
    if (!pick)
      return fail(
        'reach.no-station',
        `${actor} has no reachable place to stand within ${ARM_REACH} m of ${t.label} (${f2(t.y)} m up; floors within reach: ${eligible.map((l) => `level ${l.id} at ${f2(l.y)} m`).join(', ')})${lastWhy ? `: ${lastWhy}` : order.length ? '' : ': no standing room there'}`,
        [actor],
        [anchor[0], t.y, anchor[1]],
      );
    chosen.push(pick);
  }
  return { ok: true, stations: chosen };
}

function floodMark(g: LevelGrid, start: number, r: number, mark: Uint8Array) {
  const q = [start];
  mark[start] = 1;
  while (q.length) {
    const k = q.pop()!;
    const i = k % g.nx, j = (k - i) / g.nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
      const m = nj * g.nx + ni;
      if (!mark[m] && g.clearance[m] >= r) { mark[m] = 1; q.push(m); }
    }
  }
}

// ---- shared execution: walk the crew to stations, then lift the part into place ----

export type LiftExec = { id: string; crew: string[]; item: string; phase: 'approach' | 'place'; children?: Children; t: number; from: Pose; to: Pose; duration: number };

export function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

export function lerpPose(a: Pose, b: Pose, s: number): Pose {
  const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * s, a.p[1] + (b.p[1] - a.p[1]) * s, a.p[2] + (b.p[2] - a.p[2]) * s],
    yaw: a.yaw + dy * s,
    pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * s,
    roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * s,
  };
}

/** 'arrived' when every crew member stands at their station; a diagnostic if a walk failed. */
export function approach(rt: Runtime, ex: LiftExec, stations: Station[], code: string): 'running' | 'arrived' | Diagnostic {
  if (!ex.children) {
    const r = walkCrew(rt, ex.id, stations.map((s) => ({ actor: s.actor, p: s.p, yaw: s.yaw, level: s.level })));
    if ('code' in r) return { ...r, code };
    ex.children = r;
  }
  const s = childrenState(ex.children);
  if (s === 'running') return 'running';
  if (s !== 'done') return s;
  return 'arrived';
}

export function beginLift(rt: Runtime, ex: LiftExec) {
  const item = rt.world.entities[ex.item];
  item.phase = 'carried';
  item.support = { kind: 'held', by: [...ex.crew] };
  ex.from = { ...item.pose, p: [...item.pose.p] };
  for (const c of ex.crew) Object.assign(rt.world.entities[c].human!, { activity: 'lift', grip: { entity: item.id, slot: c }, task: ex.id });
}

/** Advance the lift; true when the part has reached its final pose. */
export function liftStep(rt: Runtime, ex: LiftExec, dt: number): boolean {
  ex.t = Math.min(1, ex.t + dt / ex.duration);
  rt.world.entities[ex.item].pose = lerpPose(ex.from, ex.to, smooth(ex.t));
  return ex.t >= 1;
}

export function releaseCrew(rt: Runtime, crew: string[]) {
  for (const c of crew) Object.assign(rt.world.entities[c].human!, { activity: 'idle', grip: undefined, task: undefined });
}

export function cancelLift(rt: Runtime, ex: LiftExec, code: string) {
  if (ex.phase === 'place')
    return { ok: false as const, diagnostic: { code, message: `${ex.item} is being lifted into place; it cannot be abandoned mid-air`, subjects: [ex.item] } };
  for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
  return { ok: true as const };
}
