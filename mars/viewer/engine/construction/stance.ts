// Frame stances and hanging beams at any seat height (owner feedback 2026-09-28 §5/§7: "uprights'
// bracing works as a ladder"; nothing above standing reach is interpolated into place).
// Mars assembly model v1, approximate. Used by the year builds (campus/sequence.ts); the flagship
// scenarios keep connect_beam / climb_frame / hand_up and are untouched.
//
// STANCE — a person standing on a frame's bracing: `stance:<upright>:<l|r>:<f|b>@<feet>`.
//   * body 0.30 m inward of the column (on the bracing), 0.36 m off the frame plane on face f (+z of
//     the frame) or b (−z), feet on a bracing node (`rungs`: the Kit's diagonal-brace ends,
//     0.25 + 0.7k and 0.91 + 0.7k m, up to height − 1.2 m so there is frame to hold above);
//   * reached by `climb_stance` from a foot point on the ground just outside the column (aisle /
//     outside the rack side, 0.25 m behind the frame plane): up the frame's edge at 0.35 m/s and round
//     the column onto the face (the climb path is not body-checked, as W2's climb links);
//   * a frame that is only held (not beam-stable) may be climbed to feet ≤ 1.0 m (a step up, its
//     base held); higher needs a stable frame. One column face carries several people only ≥ 1.9 m
//     apart vertically. The body (r 0.22 m, 1.75 m tall) may not intersect any other component.
//   * hands: ≤ feet + 2.1 m, ≥ feet − 0.5 m (one hand stays on the frame), ≤ 0.9 m horizontally from
//     the body centre.
// hold_frame / let_go — a person takes hold of a standing held upright from any spot within reach
//   (typically behind it, clear of the bay being built); a holder lets go while ≥ holdCrew others
//   (or a stable assembly) keep it up.
// hang_beam — a beam lying staged 0.40 m outside its seat line (in the aisle between rows, or outside
//   the rack) goes up beside the line and is slid onto the two column seats and hooked:
//   * ground mode (seat ≤ 1.2 m): two installers on the ground at its ends lift it (crouch) and hook it;
//   * aloft: two ground givers under it lift it to ≤ 2.1 m; the two installers on stances of the two
//     frames (the same column, the faces toward each other) take it and hook it; optionally two relay
//     people on the same column faces lower down take it from the givers first and raise it to where
//     the installers can reach down to it. Every hand-off height must be inside both parties' reach
//     (`hang.gap` names the heights otherwise).
//   Loads rise vertically at the aisle offset, then slide 0.40 m sideways onto the line at the seat
//   height (swept against everything but the two frames); hands published every tick (human.hands).
import { z } from 'zod';
import { angleDelta, datan2, rot2, wrapAngle, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Invariant, Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { def, HUMAN_RADIUS } from '../world/catalog.ts';
import { entityFootprint } from '../spatial/service.ts';
import { obbOverlap } from '../core/math.ts';
import { groupStability, holdingDiagnostic, isBeam, isStanding, isSupported, isUpright, seatPoint, snapSeat } from './rules.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { levelFor, sweepPoses } from './access.ts';
import { CLIMB_SPEED, frameAccessOk } from './frame.ts';

export const STANCE_IN = 0.3, STANCE_OFF = 0.36, FOOT_OUT = 0.35, FOOT_BACK = 0.25;
export const HELD_STANCE_MAX = 1.0;
export const STANCE_UP = 2.1, STANCE_DOWN = 0.5, STANCE_ARM = 0.9, STANCE_SEP = 1.9;
export const BODY_R = 0.22, BODY_H = 1.75;
export const GIVE_MAX = 2.1, GROUND_ARM = 0.8, GROUND_HANG_MAX = 1.2;
export const LOAD_OUT = 0.4;
const CROUCH_S = 0.6, LIFT_S = 0.6, TAKE_S = 0.5, HOOK_S = 1.0;
const RAISE_GIVE = 0.4, RAISE_ALOFT = 0.3, SLIDE = 0.2;
const TOL = 1e-6;
const f2 = (x: number) => x.toFixed(2);
const fail = (code: string, message: string, subjects: string[]): { ok: false; diagnostic: Diagnostic } => ({ ok: false, diagnostic: { code, message, subjects } });
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const dist = (a: Vec2, b: Vec2) => { const dx = a[0] - b[0], dz = a[1] - b[1]; return Math.sqrt(dx * dx + dz * dz); };

/** Bracing nodes a foot can stand on (m above the frame's base). */
export function rungs(defId: string): number[] {
  const h = def(defId).size[1];
  const out: number[] = [];
  for (let k = 0; k < 20; k++) for (const y of [0.25 + 0.7 * k, 0.91 + 0.7 * k]) if (y <= h - 1.2 + 1e-9) out.push(Math.round(y * 100) / 100);
  return [...new Set(out)].sort((a, b) => a - b);
}

export type StanceRef = { upright: string; col: 'l' | 'r'; face: 'f' | 'b'; feet: number };
export const stanceId = (s: StanceRef) => `stance:${s.upright}:${s.col}:${s.face}@${s.feet.toFixed(2)}`;
export function parseStance(id: string | undefined): StanceRef | null {
  const m = /^stance:(.+):([lr]):([fb])@(\d+\.\d\d)$/.exec(id ?? '');
  return m ? { upright: m[1], col: m[2] as 'l' | 'r', face: m[3] as 'f' | 'b', feet: Number(m[4]) } : null;
}

/** World geometry of a stance: body point, feet height, climb foot on the ground. */
export function stanceGeo(u: Entity, s: StanceRef): { body: Vec2; y: number; foot: Vec2; groundY: number; facing: number } {
  const cs = s.col === 'l' ? -1 : 1, fs = s.face === 'f' ? 1 : -1;
  const sp = seatPoint(u, cs, 0);
  const colP: Vec2 = [sp[0], sp[2]];
  const e = rot2([cs, 0], u.pose.yaw), n = rot2([0, 1], u.pose.yaw);
  const body: Vec2 = [colP[0] - e[0] * STANCE_IN + n[0] * fs * STANCE_OFF, colP[1] - e[1] * STANCE_IN + n[1] * fs * STANCE_OFF];
  const foot: Vec2 = [colP[0] + e[0] * FOOT_OUT - n[0] * fs * FOOT_BACK, colP[1] + e[1] * FOOT_OUT - n[1] * fs * FOOT_BACK];
  return { body, y: u.pose.p[1] + s.feet, foot, groundY: u.pose.p[1], facing: datan2(-n[1] * fs, -n[0] * fs) };
}

/** Why a person cannot stand on this stance now (null = they can). */
export function stanceProblem(rt: Runtime, s: StanceRef, actor: string, ignore: string[] = []): Diagnostic | null {
  const w = rt.world;
  const u = w.entities[s.upright];
  const d = (code: string, message: string, subjects: string[]): Diagnostic => ({ code, message, subjects });
  if (!isUpright(u) || !isStanding(u) || u.phase === 'carried' || u.phase === 'raising') return d('stance.no-frame', `${s.upright} is not a standing upright`, [s.upright]);
  if (!rungs(u.def).some((r) => Math.abs(r - s.feet) < 0.005)) return d('stance.no-rung', `${u.id} has no bracing node at ${f2(s.feet)} m (nodes ${rungs(u.def).join(', ')})`, [u.id]);
  if (!isSupported(w, u)) return d('stance.unsupported', `${u.id} is neither held nor stable; nobody climbs it`, [u.id]);
  if (u.support?.kind === 'held') {
    if (u.support.by.includes(actor)) return d('stance.holder', `${actor} is holding ${u.id}; they cannot climb it`, [actor, u.id]);
    if (s.feet > HELD_STANCE_MAX + TOL) return d('stance.held-too-high', `${u.id} is only held (not beam-stable): climbing it above ${HELD_STANCE_MAX} m is refused (asked ${f2(s.feet)} m)`, [u.id]);
  }
  const g = stanceGeo(u, s);
  for (const e of Object.values(w.entities)) {
    if (e.id === actor || e.kind !== 'human') continue;
    const o = parseStance(e.human?.on);
    if (o && o.upright === s.upright && o.col === s.col && o.face === s.face && Math.abs(o.feet - s.feet) < STANCE_SEP - TOL)
      return d('stance.occupied', `${e.id} is on the same face of ${u.id} (column ${s.col}) at ${f2(o.feet)} m; people on one column face keep ${STANCE_SEP} m apart vertically`, [e.id, u.id]);
  }
  // the body (r 0.22 m, feet … feet + 1.75 m) against every other component
  const skip = new Set([u.id, ...ignore]);
  const body = { c: g.body, half: [BODY_R, BODY_R] as Vec2, yaw: u.pose.yaw };
  for (const e of Object.values(w.entities)) {
    if (skip.has(e.id) || e.kind === 'human' || e.kind === 'marker' || e.phase === 'carried') continue;
    const f = entityFootprint(e);
    if (f.y1 <= g.y + 0.02 || f.y0 >= g.y + BODY_H) continue;
    if (obbOverlap(f.obb, body)) return d('stance.body-blocked', `on ${stanceId(s)} ${actor}'s body would be inside ${e.id} (${def(e.def).label})`, [actor, e.id, u.id]);
  }
  return null;
}

// ------------------------------------------------------------------ climb_stance / leave_stance

type CP = { actor: string; upright: string; column: 'l' | 'r'; face: 'f' | 'b'; feet: number };
type CE = { p: CP; id: string; s: StanceRef; phase: 'walk' | 'climb'; children?: Children; path: Vec3[]; t: number; len: number };
const pathLen = (ps: Vec3[]) => ps.slice(1).reduce((a, q, i) => { const d = [q[0] - ps[i][0], q[1] - ps[i][1], q[2] - ps[i][2]]; return a + Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]); }, 0);
function along(ps: Vec3[], s: number): Vec3 {
  for (let i = 1; i < ps.length; i++) {
    const a = ps[i - 1], b = ps[i];
    const l = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2);
    if (s <= l || i === ps.length - 1) { const t = l > 0 ? Math.min(1, s / l) : 1; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    s -= l;
  }
  return ps[ps.length - 1];
}
function climbPath(u: Entity, s: StanceRef): Vec3[] {
  const g = stanceGeo(u, s);
  return [[g.foot[0], g.groundY, g.foot[1]], [g.foot[0], g.y, g.foot[1]], [g.body[0], g.y, g.body[1]]];
}

export const climbStance: ActionDef<CP, null, CE> = {
  verb: 'climb_stance',
  description: 'Climb a standing upright from the ground beside its column onto a bracing node (a stance) on one face; single occupant per column face within 1.9 m; held frames only to 1.0 m.',
  schema: z.strictObject({ actor: z.string().max(80), upright: z.string().max(80), column: z.enum(['l', 'r']), face: z.enum(['f', 'b']), feet: z.number().min(0.1).max(6) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `stance:${p.upright}:${p.column}:${p.face}@${p.feet.toFixed(2)}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = rt.world.entities[p.actor];
    if (a?.kind !== 'human') return fail('entity.unknown', `no person "${p.actor}"`, [p.actor]);
    if (a.human!.on || a.human!.level !== 0) return fail('stance.not-on-ground', `${p.actor} must start on the ground (is on ${a.human!.on ?? `level ${a.human!.level}`})`, [p.actor]);
    const hd = holdingDiagnostic(rt.world, p.actor);
    if (hd) return { ok: false, diagnostic: hd };
    const s: StanceRef = { upright: p.upright, col: p.column, face: p.face, feet: Math.round(p.feet * 100) / 100 };
    const pr = stanceProblem(rt, s, p.actor);
    if (pr) return { ok: false, diagnostic: pr };
    const g = stanceGeo(rt.world.entities[p.upright], s);
    const un = checkStations(rt, [{ actor: p.actor, p: g.foot, level: 0 }]);
    return un ? { ok: false, diagnostic: { ...un, code: 'stance.foot-unreachable' } } : { ok: true, program: null };
  },
  start: (_rt, p, _prog, id) => ({ p, id, s: { upright: p.upright, col: p.column, face: p.face, feet: Math.round(p.feet * 100) / 100 }, phase: 'walk', path: [], t: 0, len: 0 }),
  step(rt, ex, dt) {
    const w = rt.world;
    const a = w.entities[ex.p.actor];
    if (ex.phase === 'walk') {
      if (!ex.children) {
        const u = w.entities[ex.p.upright];
        const g = stanceGeo(u, ex.s);
        const r = walkCrew(rt, ex.id, [{ actor: ex.p.actor, p: g.foot, yaw: datan2(g.body[1] - g.foot[1], g.body[0] - g.foot[0]), level: 0 }]);
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'stance.foot-unreachable' } };
        ex.children = r;
      }
      const st = childrenState(ex.children);
      if (st === 'running') return { status: 'running', phase: 'walk' };
      if (st !== 'done') return { status: 'failed', diagnostic: st };
      const pr = stanceProblem(rt, ex.s, ex.p.actor);
      if (pr) return { status: 'blocked', diagnostic: pr };
      ex.path = climbPath(w.entities[ex.p.upright], ex.s);
      ex.len = pathLen(ex.path);
      ex.phase = 'climb';
      ex.t = 0;
      Object.assign(a.human!, { on: stanceId(ex.s), activity: 'climb-up', speed: undefined });
    }
    ex.t += dt;
    const s = Math.min(ex.len, ex.t * CLIMB_SPEED);
    const q = along(ex.path, s);
    a.pose = { p: q, yaw: stanceGeo(w.entities[ex.p.upright], ex.s).facing };
    if (s < ex.len - 1e-9) return { status: 'running', phase: 'climb' };
    Object.assign(a.human!, { level: levelFor(q[1]), activity: 'stance', task: undefined });
    return { status: 'completed', outputs: { stance: stanceId(ex.s) } };
  },
  cancel(rt, ex) {
    if (ex.phase === 'climb') return { ok: false, diagnostic: { code: 'stance.cancel-unsafe', message: `${ex.p.actor} is climbing ${ex.p.upright}; they finish the climb first`, subjects: [ex.p.actor] } };
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    return { ok: true };
  },
  resumable: true,
};

type LP = { actor: string; to?: { x: number; z: number } };
type LE = { p: LP; id: string; s: StanceRef; path: Vec3[]; t: number; len: number; phase: 'down' | 'clear'; children?: Children };
export const leaveStance: ActionDef<LP, null, LE> = {
  verb: 'leave_stance',
  description: 'Climb down from a frame stance to the climb foot on the ground, then (optionally) walk clear to `to`.',
  schema: z.strictObject({ actor: z.string().max(80), to: z.strictObject({ x: z.number(), z: z.number() }).optional() }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = rt.world.entities[p.actor];
    const s = parseStance(a?.human?.on);
    if (!s) return fail('stance.not-on-stance', `${p.actor} is not on a frame stance`, [p.actor]);
    const hd = holdingDiagnostic(rt.world, p.actor);
    if (hd) return { ok: false, diagnostic: hd };
    return { ok: true, program: null };
  },
  start(rt, p, _prog, id) {
    const a = rt.world.entities[p.actor];
    const s = parseStance(a.human!.on)!;
    const path = climbPath(rt.world.entities[s.upright], s).reverse();
    path[0] = [...a.pose.p];
    return { p, id, s, path, t: 0, len: pathLen(path), phase: 'down' };
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.p.actor];
    if (ex.phase === 'clear') {
      if (!ex.children) {
        const r = walkCrew(rt, ex.id, [{ actor: a.id, p: [ex.p.to!.x, ex.p.to!.z], yaw: a.pose.yaw, level: 0 }]);
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'stance.clear-unreachable' } };
        ex.children = r;
      }
      const st = childrenState(ex.children);
      if (st === 'running') return { status: 'running', phase: 'clear' };
      if (st !== 'done') return { status: 'failed', diagnostic: st };
      a.human!.task = undefined;
      return { status: 'completed' };
    }
    const foot = ex.path[ex.path.length - 1];
    if (ex.t === 0) {
      // the foot must be free before stepping down onto it
      const other = Object.values(rt.world.entities).find((e) => e.id !== a.id && e.kind === 'human' && e.human!.level === 0 && !e.human!.on && dist(xz(e), [foot[0], foot[2]]) < 2 * HUMAN_RADIUS);
      if (other) return { status: 'blocked', diagnostic: { code: 'stance.foot-occupied', message: `${other.id} stands at the foot of ${ex.s.upright} where ${a.id} would step down`, subjects: [other.id, a.id] } };
      a.human!.activity = 'climb-down';
    }
    ex.t += dt;
    const s = Math.min(ex.len, ex.t * CLIMB_SPEED);
    a.pose = { p: along(ex.path, s), yaw: a.pose.yaw };
    if (s < ex.len - 1e-9) return { status: 'running', phase: 'climb-down' };
    Object.assign(a.human!, { on: undefined, level: 0, activity: 'idle', task: undefined });
    if (!ex.p.to) return { status: 'completed' };
    ex.phase = 'clear';
    return { status: 'running', phase: 'clear' };
  },
  cancel(rt, ex) {
    if (ex.phase === 'clear') { for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id); return { ok: true }; }
    return { ok: false, diagnostic: { code: 'stance.cancel-unsafe', message: 'a climb down is finished, not abandoned', subjects: [ex.p.actor] } };
  },
  resumable: true,
};

// ------------------------------------------------------------------ hold_frame / let_go

type HP = { actor: string; item: string; at: { x: number; z: number } };
type HE = { p: HP; id: string; children?: Children };
const HOLD_AT_MAX = 1.0; // m from the frame's footprint (holdersPresent allows 1.2)
function holdProblem(rt: Runtime, p: HP): Diagnostic | null {
  const u = rt.world.entities[p.item];
  if (!isUpright(u) || !isStanding(u)) return { code: 'hold.not-standing', message: `${p.item} is not a standing upright`, subjects: [p.item] };
  if (u.support?.kind !== 'held') return { code: 'hold.not-held', message: `${p.item} is not being held (support ${u.support?.kind}); only a held frame is taken over`, subjects: [p.item] };
  if (u.support.by.includes(p.actor)) return { code: 'hold.already', message: `${p.actor} already holds ${p.item}`, subjects: [p.actor, p.item] };
  const f = entityFootprint(u).obb;
  const l = rot2([p.at.x - f.c[0], p.at.z - f.c[1]], -f.yaw);
  const dx = Math.max(Math.abs(l[0]) - f.half[0], 0), dz = Math.max(Math.abs(l[1]) - f.half[1], 0);
  if (Math.sqrt(dx * dx + dz * dz) > HOLD_AT_MAX) return { code: 'hold.too-far', message: `(${f2(p.at.x)}, ${f2(p.at.z)}) is ${f2(Math.sqrt(dx * dx + dz * dz))} m from ${p.item} (hold within ${HOLD_AT_MAX} m)`, subjects: [p.item] };
  return null;
}
export const holdFrame: ActionDef<HP, null, HE> = {
  verb: 'hold_frame',
  description: 'Walk to a spot within 1 m of a standing, held upright and take hold of it too (the raise crew can then let go).',
  schema: z.strictObject({ actor: z.string().max(80), item: z.string().max(80), at: z.strictObject({ x: z.number(), z: z.number() }) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = rt.world.entities[p.actor];
    if (a?.kind !== 'human') return fail('entity.unknown', `no person "${p.actor}"`, [p.actor]);
    const hd = holdingDiagnostic(rt.world, p.actor);
    if (hd) return { ok: false, diagnostic: hd };
    const pr = holdProblem(rt, p);
    if (pr) return { ok: false, diagnostic: pr };
    const un = checkStations(rt, [{ actor: p.actor, p: [p.at.x, p.at.z], level: 0 }]);
    return un ? { ok: false, diagnostic: { ...un, code: 'hold.unreachable' } } : { ok: true, program: null };
  },
  start: (_rt, p, _prog, id) => ({ p, id }),
  step(rt, ex) {
    const w = rt.world;
    if (!ex.children) {
      const u = w.entities[ex.p.item];
      const r = walkCrew(rt, ex.id, [{ actor: ex.p.actor, p: [ex.p.at.x, ex.p.at.z], yaw: datan2(u.pose.p[2] - ex.p.at.z, u.pose.p[0] - ex.p.at.x), level: 0 }]);
      if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'hold.unreachable' } };
      ex.children = r;
    }
    const st = childrenState(ex.children);
    if (st === 'running') return { status: 'running', phase: 'walk' };
    if (st !== 'done') return { status: 'failed', diagnostic: st };
    const pr = holdProblem(rt, ex.p);
    if (pr) return { status: 'failed', diagnostic: pr };
    const u = w.entities[ex.p.item];
    u.support = { kind: 'held', by: [...(u.support as { by: string[] }).by, ex.p.actor] };
    Object.assign(w.entities[ex.p.actor].human!, { activity: 'support', grip: { entity: u.id, slot: 'hold-frame' }, task: undefined });
    return { status: 'completed' };
  },
  cancel(rt, ex) {
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    return { ok: true };
  },
  resumable: true,
};

type GP = { actor: string; item: string };
export const letGo: ActionDef<GP, null, { p: GP }> = {
  verb: 'let_go',
  description: 'One holder lets go of an upright that stays held by enough others (holdCrew) or is beam-stable.',
  schema: z.strictObject({ actor: z.string().max(80), item: z.string().max(80) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `entity:${p.item}`, mode: 'exclusive' }],
  plan(rt, p) {
    const u = rt.world.entities[p.item];
    if (!isUpright(u) || u.support?.kind !== 'held' || !u.support.by.includes(p.actor)) return fail('hold.not-holding', `${p.actor} is not holding ${p.item}`, [p.actor, p.item]);
    const left = u.support.by.filter((c) => c !== p.actor);
    const need = def(u.def).handling?.holdCrew ?? 1;
    if (left.length < need && !groupStability(rt.world, u).stable)
      return fail('hold.last-holder', `${p.actor} cannot let go of ${u.id}: ${left.length ? `only ${left.join(', ')} would hold it` : 'nobody else holds it'} (needs ${need}) and it is not beam-stable`, [p.actor, u.id]);
    return { ok: true, program: null };
  },
  start: (_rt, p) => ({ p }),
  step(rt, ex) {
    const u = rt.world.entities[ex.p.item];
    const by = (u.support as { by: string[] }).by.filter((c) => c !== ex.p.actor);
    u.support = { kind: 'held', by };
    Object.assign(rt.world.entities[ex.p.actor].human!, { activity: 'idle', grip: undefined, task: undefined });
    return { status: 'completed' };
  },
  cancel: () => ({ ok: true }),
  resumable: true,
};

// ------------------------------------------------------------------ hang_beam

type BP = { beam: string; a: string; b: string; column: 'l' | 'r'; height: number; installers: string[]; givers?: string[]; relay?: string[] };
type Role = 'give' | 'relay' | 'hook';
type Geo = {
  h: number; colB: 'l' | 'r'; yaw: number; L: number; H: number;
  line: Vec2; out: Vec2; axis: Vec2; groundY: number;
  endA: 'end-l' | 'end-r';
  /** hand-off load-centre heights: givers → first aloft receiver, relay → installers. */
  hg: number; hr: number;
  mode: 'ground' | 'aloft';
  giveSt: Vec2[]; hookSt: Vec2[];
};
type BE = {
  p: BP; id: string; g: Geo; phase: 'approach' | 'crouch' | 'lift' | 'raise-give' | 'take-relay' | 'raise-relay' | 'take-hook' | 'raise-hook' | 'slide' | 'hook';
  t: number; yc: number; off: number; holders: { id: string; role: Role; i: number }[]; children?: Children;
};

/** Beam pose with centre height `yc` and lateral offset `off` from the seat line (m). */
function beamPose(g: Geo, yc: number, off: number): Pose {
  return { p: [g.line[0] + g.out[0] * off, yc - g.H / 2, g.line[1] + g.out[1] * off], yaw: g.yaw };
}
/** Grip point (world) of a holder: givers at ∓0.2 L from the middle, relay / installers 0.3 m in from the ends. */
function gripPoint(g: Geo, role: Role, i: number, yc: number, off: number): Vec3 {
  const aSide = g.endA === 'end-r' ? 1 : -1; // local x sign of the beam end at frame a (installer / relay 0)
  const loc = role === 'give' ? (i ? 0.2 : -0.2) * g.L : (i === 0 ? aSide : -aSide) * (g.L / 2 - 0.3);
  const c = beamPose(g, yc, off);
  const d = rot2([loc, 0], g.yaw);
  return [c.p[0] + d[0], yc, c.p[2] + d[1]];
}
function handsAt(g: Geo, role: Role, i: number, yc: number, off: number): { left: Vec3; right: Vec3 } {
  const p = gripPoint(g, role, i, yc, off);
  const d = rot2([0.15, 0], g.yaw);
  return { left: [p[0] - d[0], p[1], p[2] - d[1]], right: [p[0] + d[0], p[1], p[2] + d[1]] };
}

function planHang(rt: Runtime, p: BP): { ok: true; program: Geo } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world;
  const a = w.entities[p.a], b = w.entities[p.b], beam = w.entities[p.beam];
  if (!isBeam(beam)) return fail('hang.not-beam', `${p.beam} is not a pallet-rack beam`, [p.beam]);
  for (const u of [a, b] as (Entity | undefined)[]) {
    if (!isUpright(u) || !isStanding(u!)) return fail('hang.upright-not-standing', `${u?.id ?? '?'} is not a standing upright`, [p.a, p.b]);
    if (!isSupported(w, u!)) return fail('hang.upright-unsupported', `${u!.id} is standing but neither held nor stable`, [u!.id]);
  }
  const L = def(beam.def).size[0], H = def(beam.def).size[1];
  const rel = rot2([b.pose.p[0] - a.pose.p[0], b.pose.p[2] - a.pose.p[2]], -a.pose.yaw);
  const dyaw = angleDelta(a.pose.yaw, b.pose.yaw);
  const flip = Math.abs(dyaw) > Math.PI / 2;
  if (Math.abs(rel[0]) > 0.04 || Math.abs(Math.abs(rel[1]) - L) > 0.06 || Math.abs(flip ? Math.PI - Math.abs(dyaw) : dyaw) > 0.035)
    return fail('hang.misaligned', `${a.id} and ${b.id} are ${f2(Math.abs(rel[1]))} m apart (offset ${f2(rel[0])} m); a ${def(beam.def).label} needs ${f2(L)} m with frames parallel`, [a.id, b.id, beam.id]);
  const h = snapSeat(a, p.height);
  if (h === null) return fail('hang.no-seat', `no seat hole near ${f2(p.height)} m on ${a.id}`, [a.id]);
  const cs = p.column === 'l' ? -1 : 1;
  const colB = (flip ? -cs : cs) as -1 | 1;
  const sa = seatPoint(a, cs, h), sb = seatPoint(b, colB, h);
  const line: Vec2 = [(sa[0] + sb[0]) / 2, (sa[2] + sb[2]) / 2];
  const out = rot2([cs, 0], a.pose.yaw);
  const axisYaw = a.pose.yaw + Math.PI / 2;
  const yaw = wrapAngle(Math.abs(angleDelta(beam.pose.yaw, axisYaw)) > Math.PI / 2 ? axisYaw + Math.PI : axisYaw);
  const axis = rot2([1, 0], yaw);
  const endA = axis[0] * (sa[0] - line[0]) + axis[1] * (sa[2] - line[1]) > 0 ? 'end-r' : 'end-l';
  const groundY = a.pose.p[1];
  // staged beside the line
  const stage: Vec2 = [line[0] + out[0] * LOAD_OUT, line[1] + out[1] * LOAD_OUT];
  const bp: Vec2 = [beam.pose.p[0], beam.pose.p[2]];
  if (beam.support?.kind !== 'ground' || (beam.phase !== 'stored' && beam.phase !== 'staged' && beam.phase !== 'reserved') || dist(bp, stage) > 0.25 || Math.abs(Math.abs(angleDelta(beam.pose.yaw, yaw)) - 0) > 0.06 && Math.abs(Math.abs(angleDelta(beam.pose.yaw, yaw)) - Math.PI) > 0.06)
    return fail('hang.not-staged', `${beam.id} must lie on the ground along its seat line, ${LOAD_OUT} m outside it, at (${f2(stage[0])}, ${f2(stage[1])}) (it is at (${f2(bp[0])}, ${f2(bp[1])}), ${beam.phase}); carry it there first`, [beam.id]);
  const seatY = groundY + h;
  const givers = p.givers ?? [], relay = p.relay ?? [];
  const all = [...p.installers, ...givers, ...relay];
  if (new Set(all).size !== all.length) return fail('crew.duplicate', `hang_beam ${p.beam} lists someone twice`, all);
  if (p.installers.length !== 2) return fail('crew.size', 'hanging a beam needs exactly two installers, one at each frame', p.installers);
  for (const c of all) {
    const e = w.entities[c];
    if (e?.kind !== 'human') return fail('entity.unknown', `no person "${c}"`, [c]);
    const hd = holdingDiagnostic(w, c);
    if (hd) return { ok: false, diagnostic: hd };
  }
  const endPt = (s: number): Vec2 => [stage[0] + axis[0] * s, stage[1] + axis[1] * s];
  const aSide = endA === 'end-r' ? 1 : -1;
  const hookSt: Vec2[] = [endPt(aSide * (L / 2 + 0.35)), endPt(-aSide * (L / 2 + 0.35))];
  const giveSt: Vec2[] = [endPt(-0.2 * L), endPt(0.2 * L)];
  const base = { h, colB: (colB < 0 ? 'l' : 'r') as 'l' | 'r', yaw, L, H, line, out, axis, groundY, endA: endA as 'end-l' | 'end-r', giveSt, hookSt };
  // swept path: rise at the aisle offset, slide onto the line (the two frames it hooks into are exempt)
  const lying = beam.pose;
  const poses = [lying, beamPose({ ...base, hg: 0, hr: 0, mode: 'ground' }, seatY, LOAD_OUT), beamPose({ ...base, hg: 0, hr: 0, mode: 'ground' }, seatY, 0)];
  const hit = sweepPoses(rt, beam, poses, [a.id, b.id]);
  if (hit) return fail('hang.path-blocked', `${beam.id} cannot go up beside its seat line: it would pass through ${hit.o.id} at (${f2(hit.q.p[0])}, ${f2(hit.q.p[1])}, ${f2(hit.q.p[2])})`, [beam.id, hit.o.id]);
  if (h <= GROUND_HANG_MAX) {
    if (givers.length || relay.length) return fail('hang.crew', `a beam at ${f2(h)} m is hung by the two installers from the ground; no givers or relay`, all);
    for (const c of p.installers) if (w.entities[c].human!.on || w.entities[c].human!.level !== 0) return fail('hang.installer-not-on-ground', `${c} must be on the ground to hang a beam at ${f2(h)} m`, [c]);
    return { ok: true, program: { ...base, hg: 0, hr: 0, mode: 'ground' } };
  }
  // aloft: installers on stances of a (installer 0) and b (installer 1), same column, faces toward each other
  const feetOf = (c: string, u: Entity, col: 'l' | 'r', what: string): number | Diagnostic => {
    const s = parseStance(w.entities[c].human!.on);
    const other = u.id === a.id ? b : a;
    const n = rot2([0, 1], u.pose.yaw);
    const face = (other.pose.p[0] - u.pose.p[0]) * n[0] + (other.pose.p[2] - u.pose.p[2]) * n[1] > 0 ? 'f' : 'b';
    if (!s || s.upright !== u.id || s.col !== col || s.face !== face)
      return { code: 'hang.not-aloft', message: `${c} (${what}) must stand on ${u.id}'s bracing at column ${col}, face ${face} (toward ${other.id}); is on ${w.entities[c].human!.on ?? 'the ground'}`, subjects: [c, u.id] };
    return s.feet;
  };
  const fi: number[] = [];
  for (const [k, c] of p.installers.entries()) {
    const r = feetOf(c, k ? b : a, k ? base.colB : p.column, 'installer');
    if (typeof r !== 'number') return { ok: false, diagnostic: r };
    fi.push(groundY + r);
  }
  const fr: number[] = [];
  if (relay.length && relay.length !== 2) return fail('crew.size', 'a relay is two people, one on each frame', relay);
  for (const [k, c] of relay.entries()) {
    const r = feetOf(c, k ? b : a, k ? base.colB : p.column, 'relay');
    if (typeof r !== 'number') return { ok: false, diagnostic: r };
    fr.push(groundY + r);
  }
  const need = def(beam.def).handling?.carryCrew?.[0] ?? 2;
  if (givers.length < need || givers.length > 2) return fail('crew.size', `${need}–2 givers lift a ${def(beam.def).label} from the ground`, givers);
  for (const c of givers) if (w.entities[c].human!.on || w.entities[c].human!.level !== 0) return fail('hang.giver-aloft', `${c} gives from the ground`, [c]);
  const fiMax = Math.max(...fi), fiMin = Math.min(...fi);
  if (seatY > fiMin + STANCE_UP + TOL) return fail('reach.too-high', `the seat at ${f2(h)} m is ${f2(seatY - fiMin)} m above the installers' feet (${f2(fiMin - groundY)} m; reach ${STANCE_UP} m)`, [...p.installers]);
  const first = relay.length ? fr : fi;
  // givers hand up to where the first aloft pair can reach down to it
  const takeLow = Math.max(...first) - STANCE_DOWN;
  const hg = Math.min(groundY + GIVE_MAX - 0.05, Math.max(takeLow + 0.05, groundY + 1.5));
  if (hg < takeLow - TOL || hg > groundY + GIVE_MAX + TOL)
    return fail('hang.gap', `the givers can hand ${beam.id} up to ${f2(GIVE_MAX)} m, but ${relay.length ? 'the relay' : 'the installers'} at ${f2(Math.max(...first) - groundY)} m reach down only to ${f2(takeLow - groundY)} m${relay.length ? '' : ': add a relay lower on the frames'}`, [beam.id, ...(relay.length ? relay : p.installers)]);
  if (hg > Math.min(...first) + STANCE_UP + TOL) return fail('hang.gap', `the hand-off at ${f2(hg - groundY)} m is out of reach above ${relay.length ? 'the relay' : 'the installers'}`, [beam.id]);
  let hr = 0;
  if (relay.length) {
    if (fiMin - Math.max(...fr) < STANCE_SEP - TOL) return fail('stance.occupied', `relay and installers on one column face keep ${STANCE_SEP} m apart vertically`, [...relay, ...p.installers]);
    const lo = fiMax - STANCE_DOWN + 0.05, hi = Math.min(...fr) + STANCE_UP - 0.05;
    if (lo > hi + TOL) return fail('hang.gap', `the relay at ${f2(Math.min(...fr) - groundY)} m can raise ${beam.id} to ${f2(hi - groundY)} m but the installers at ${f2(fiMax - groundY)} m reach down only to ${f2(lo - groundY)} m`, [beam.id, ...relay, ...p.installers]);
    hr = Math.max(lo, hg);
  }
  // reach checks at the hand-off points (horizontal)
  const bodies = p.installers.map((c) => xz(w.entities[c])), rbodies = relay.map((c) => xz(w.entities[c]));
  const g: Geo = { ...base, hg, hr, mode: 'aloft' };
  for (const [k, c] of p.installers.entries()) {
    const gp = gripPoint(g, 'hook', k, seatY, LOAD_OUT);
    if (dist(bodies[k], [gp[0], gp[2]]) > STANCE_ARM + TOL) return fail('hang.too-far', `${c} cannot reach ${beam.id} rising ${LOAD_OUT} m outside the line (${f2(dist(bodies[k], [gp[0], gp[2]]))} m, arm ${STANCE_ARM} m)`, [c, beam.id]);
  }
  for (const [k, c] of relay.entries()) {
    const gp = gripPoint(g, 'relay', k, hr, LOAD_OUT);
    if (dist(rbodies[k], [gp[0], gp[2]]) > STANCE_ARM + TOL) return fail('hang.too-far', `${c} (relay) cannot reach ${beam.id} (${f2(dist(rbodies[k], [gp[0], gp[2]]))} m)`, [c, beam.id]);
  }
  return { ok: true, program: g };
}

export const hangBeam: ActionDef<BP, Geo, BE> = {
  verb: 'hang_beam',
  description: 'Hang a beam staged beside its seat line on the same column of two standing uprights: from the ground (seat ≤ 1.2 m), or handed up by two givers to two installers on the frames\' bracing (optionally through two relay people lower on the frames).',
  schema: z.strictObject({
    beam: z.string().max(80), a: z.string().max(80), b: z.string().max(80), column: z.enum(['l', 'r']), height: z.number().min(0.1).max(8),
    installers: z.array(z.string().max(80)).length(2), givers: z.array(z.string().max(80)).max(2).optional(), relay: z.array(z.string().max(80)).max(2).optional(),
  }),
  reservations: (_w, p) => [...[...p.installers, ...(p.givers ?? []), ...(p.relay ?? [])].map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.beam}`, mode: 'exclusive' }],
  plan(rt, p) {
    const r = planHang(rt, p);
    if (!r.ok) return r;
    const moves = r.program.mode === 'ground'
      ? p.installers.map((c, i) => ({ actor: c, p: r.program.hookSt[i], level: 0 }))
      : (p.givers ?? []).map((c, i) => ({ actor: c, p: r.program.giveSt[i], level: 0 }));
    const un = checkStations(rt, moves);
    return un ? { ok: false, diagnostic: { ...un, code: 'hang.station-unreachable' } } : r;
  },
  start(rt, p, g, id) {
    const beam = rt.world.entities[p.beam];
    beam.phase = 'reserved';
    return { p, id, g, phase: 'approach', t: 0, yc: beam.pose.p[1] + g.H / 2, off: LOAD_OUT, holders: [] };
  },
  step(rt, ex, dt) {
    const w = rt.world;
    const g = ex.g, p = ex.p;
    const beam = w.entities[p.beam];
    const seatY = g.groundY + g.h;
    const setHolders = (hs: { id: string; role: Role; i: number }[], activity: string) => {
      for (const o of ex.holders) if (!hs.some((x) => x.id === o.id)) {
        const hh = w.entities[o.id].human!;
        Object.assign(hh, { activity: hh.on ? 'stance' : 'idle', grip: undefined, hands: undefined });
      }
      ex.holders = hs;
      beam.support = { kind: 'held', by: hs.map((x) => x.id) };
      for (const x of hs) Object.assign(w.entities[x.id].human!, { activity, grip: { entity: beam.id, slot: `hang-${x.role}-${x.i}` } });
    };
    const publish = () => {
      beam.pose = beamPose(g, ex.yc, ex.off);
      for (const x of ex.holders) w.entities[x.id].human!.hands = handsAt(g, x.role, x.i, ex.yc, ex.off);
    };
    const move = (target: number, speed: number) => {
      const d = target - ex.yc;
      const s = Math.min(Math.abs(d), speed * dt);
      ex.yc += Math.sign(d) * s;
      publish();
      return Math.abs(target - ex.yc) < 1e-9;
    };
    const wait = (secs: number) => { ex.t += dt; return ex.t + 1e-9 >= secs; };
    const next = (ph: BE['phase']) => { ex.phase = ph; ex.t = 0; };
    const lifters = g.mode === 'ground' ? p.installers.map((id, i) => ({ id, role: 'hook' as Role, i })) : (p.givers ?? []).map((id, i) => ({ id, role: 'give' as Role, i }));
    switch (ex.phase) {
      case 'approach': {
        if (!ex.children) {
          const st = g.mode === 'ground' ? g.hookSt : g.giveSt;
          const r = walkCrew(rt, ex.id, lifters.map((x, i) => ({ actor: x.id, p: st[i], yaw: datan2(beam.pose.p[2] - st[i][1], beam.pose.p[0] - st[i][0]), level: 0 })));
          if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'hang.station-unreachable' } };
          ex.children = r;
        }
        const s = childrenState(ex.children);
        if (s === 'running') return { status: 'running', phase: 'approach' };
        if (s !== 'done') return { status: 'failed', diagnostic: s };
        const again = planHang(rt, p);
        if (!again.ok) return { status: 'blocked', diagnostic: again.diagnostic };
        ex.g = again.program;
        beam.phase = 'carried';
        setHolders(lifters, 'crouch');
        publish();
        next('crouch');
        return { status: 'running', phase: 'crouch' };
      }
      case 'crouch':
        publish();
        if (wait(CROUCH_S)) { setHolders(ex.holders, 'lift'); next(g.mode === 'ground' ? 'raise-hook' : 'lift'); }
        return { status: 'running', phase: ex.phase };
      case 'lift':
        if (move(g.groundY + 1.0, 1.0 / LIFT_S)) { setHolders(ex.holders, 'reach_up'); next('raise-give'); }
        return { status: 'running', phase: 'lift' };
      case 'raise-give':
        if (move(g.hg, RAISE_GIVE)) next(p.relay?.length ? 'take-relay' : 'take-hook');
        return { status: 'running', phase: 'raise-give' };
      case 'take-relay':
        if (ex.t === 0) { setHolders([...ex.holders, ...p.relay!.map((id, i) => ({ id, role: 'relay' as Role, i }))], 'take'); publish(); }
        if (wait(TAKE_S)) { setHolders(p.relay!.map((id, i) => ({ id, role: 'relay' as Role, i })), 'reach_up'); publish(); next('raise-relay'); }
        return { status: 'running', phase: 'take-relay' };
      case 'raise-relay':
        if (move(g.hr, RAISE_ALOFT)) next('take-hook');
        return { status: 'running', phase: 'raise-relay' };
      case 'take-hook':
        if (ex.t === 0) { setHolders([...ex.holders, ...p.installers.map((id, i) => ({ id, role: 'hook' as Role, i }))], 'take'); publish(); }
        if (wait(TAKE_S)) { setHolders(p.installers.map((id, i) => ({ id, role: 'hook' as Role, i })), 'reach_up'); publish(); next('raise-hook'); }
        return { status: 'running', phase: 'take-hook' };
      case 'raise-hook':
        if (move(seatY, RAISE_ALOFT)) next('slide');
        return { status: 'running', phase: 'raise-hook' };
      case 'slide': {
        ex.off = Math.max(0, ex.off - SLIDE * dt);
        publish();
        if (ex.off <= 1e-9) next('hook');
        return { status: 'running', phase: 'slide' };
      }
      case 'hook': {
        if (ex.t === 0) setHolders(ex.holders, 'hook');
        publish();
        if (!wait(HOOK_S)) return { status: 'running', phase: 'hook' };
        const key = `col${p.column}@${g.h.toFixed(3)}`, keyB = `col${g.colB}@${g.h.toFixed(3)}`;
        const endB = g.endA === 'end-l' ? 'end-r' : 'end-l';
        beam.pose = beamPose(g, seatY, 0);
        beam.phase = 'installed';
        beam.support = { kind: 'connected', to: [p.a, p.b] };
        beam.connections = [{ socket: g.endA, to: p.a, toSocket: key }, { socket: endB, to: p.b, toSocket: keyB }];
        (w.entities[p.a].connections ??= []).push({ socket: key, to: beam.id, toSocket: g.endA });
        (w.entities[p.b].connections ??= []).push({ socket: keyB, to: beam.id, toSocket: endB });
        for (const x of ex.holders) { const hh = w.entities[x.id].human!; Object.assign(hh, { activity: hh.on ? 'stance' : 'idle', grip: undefined, hands: undefined }); }
        for (const c of [...p.installers, ...(p.givers ?? []), ...(p.relay ?? [])]) w.entities[c].human!.task = undefined;
        return { status: 'completed', outputs: { seat: g.h, stable: groupStability(w, w.entities[p.a]).stable } };
      }
    }
    return { status: 'running' };
  },
  cancel(rt, ex) {
    if (ex.phase !== 'approach') return { ok: false, diagnostic: { code: 'hang.cancel-unsafe', message: `${ex.p.beam} is in people's hands; it is hung or set down, not abandoned`, subjects: [ex.p.beam] } };
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    rt.world.entities[ex.p.beam].phase = 'staged';
    return { ok: true };
  },
  resumable: true,
};

// ------------------------------------------------------------------ invariants

/**
 * People on stances: the stance still exists (frame standing and supported; above 1 m only on a stable
 * frame), and outside a climb they are at its body point. W2's frameAccessOk runs for everyone else
 * (its `frame.link-gone` for stance ids is replaced by these checks).
 */
export const stanceAccessOk: Invariant = (rt) => {
  const out = frameAccessOk(rt).filter((d) => !(d.code === 'frame.link-gone' && (d.subjects ?? []).some((s) => parseStance(rt.world.entities[s]?.human?.on))));
  for (const h of Object.values(rt.world.entities)) {
    const s = parseStance(h.human?.on);
    if (!s) continue;
    const u = rt.world.entities[s.upright];
    const bad = (code: string, why: string) => out.push({ code, message: `${h.id} on ${h.human!.on}: ${why}`, subjects: [h.id, s.upright], at: h.pose.p });
    if (!u || !isUpright(u) || !isStanding(u)) { bad('stance.gone', `${s.upright} is not standing`); continue; }
    if (!isSupported(rt.world, u)) bad('stance.unsupported', `${u.id} is neither held nor stable`);
    else if (s.feet > HELD_STANCE_MAX + TOL && u.support?.kind === 'held') bad('stance.held-too-high', `${u.id} is only held; nobody stands on it above ${HELD_STANCE_MAX} m`);
    if (h.human!.activity.startsWith('climb')) continue;
    const g = stanceGeo(u, s);
    if (dist(xz(h), g.body) > 0.02 || Math.abs(h.pose.p[1] - g.y) > 0.02) bad('stance.off', `${h.id} is ${f2(dist(xz(h), g.body))} m / ${f2(h.pose.p[1] - g.y)} m off the stance`);
  }
  return out;
};

/** Hands of everyone holding a hanging beam: published, within their reach every tick. */
export const hangHandsInReach: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  for (const h of Object.values(rt.world.entities)) {
    const slot = h.human?.grip?.slot;
    if (!slot?.startsWith('hang-')) continue;
    const hs = h.human!.hands;
    const bad = (why: string, at: Vec3) => out.push({ code: 'lift.hands-out-of-reach', message: `${h.id} (${slot}, ${h.human!.activity}) holds ${h.human!.grip!.entity}: ${why}`, subjects: [h.human!.grip!.entity, h.id], at });
    if (!hs?.left || !hs.right) { bad('no hand points published', h.pose.p); continue; }
    const feet = h.pose.p[1];
    const aloft = !!parseStance(h.human!.on);
    for (const q of [hs.left, hs.right]) {
      const up = q[1] - feet, horiz = dist(xz(h), [q[0], q[2]]);
      if (aloft) {
        if (up > STANCE_UP + 1e-6 || up < -STANCE_DOWN - 1e-6) bad(`hands ${f2(up)} m from their feet (stance reach −${STANCE_DOWN} … +${STANCE_UP} m)`, q);
        if (horiz > STANCE_ARM + 0.15 + 1e-6) bad(`hands ${f2(horiz)} m out from the body (stance arm ${STANCE_ARM} m)`, q);
      } else {
        if (up > GIVE_MAX + 1e-6) bad(`hands ${f2(up)} m above their floor (max ${GIVE_MAX} m)`, q);
        if (horiz > GROUND_ARM + 0.2 + 1e-6) bad(`hands ${f2(horiz)} m out from the body (arm ${GROUND_ARM} m)`, q);
      }
    }
  }
  return out;
};

export const STANCE_ACTIONS: ActionDef[] = [climbStance, leaveStance, holdFrame, letGo, hangBeam];
