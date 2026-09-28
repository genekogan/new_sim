// Solar (owner feedback 2026-09-28 §9, spec §19), Mars assembly model v1, approximate.
//   install_rail    {actor, rail, onto, at}         a panel rail set on installed 2x4 framing (≥ 2 members
//                                                   under it) or on a deck sheet, then fastened;
//   install_panel   {crew, panel, rails:[a,b], tilt} a panel on two installed rails, tilted about the rails'
//                                                   direction to the reconstruction's tilt (degrees), fastened;
//   place_equipment {actor, item, at, config?}      a battery / charge controller / inverter set down on the
//                                                   ground or a deck and configured (spec §19: identifiable and
//                                                   configurable, no electrical simulation).
// Nothing levitates: a rail / equipment item / low panel is set in place by hand from where it lies (within
// STAGE_NEAR m, same floor — carry it there first); a panel whose rails are above standing reach (2.1 m
// over the crew's floor) must arrive by hand_up (receivers lay it on the rails: handup.ts rests loads on
// installed rails) or off the forklift (hand_up via: 'forklift') — install_panel refuses otherwise.
// Every phase publishes human.activity and human.hands (the shared hand-point schema).
import { z } from 'zod';
import { add2, angleDelta, datan2, dist2, dot2, dsin, rot2, scale2, sub2, type OBB2, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { isPanel, isRail } from '../world/catalog-solar.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { toWorld } from '../carry/formation.ts';
import { holdingDiagnostic } from './rules.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { f2, lerpPose, smooth, spatialOf, sweepPoses } from './access.ts';
import { flatObb, isPlywood, memberTop } from './deck.ts';
import { envelopeGap, nearestOnRect, setHands } from './handup.ts';

const DEG = Math.PI / 180;
export const STAGE_NEAR = 1.0; // m: rails / equipment / a low panel are set in place from within this of their place
export const REACH_UP = 2.1; // m above the floor: standing reach (above it: hand_up or the forklift)
export const REACH_DOWN = 1.0; // m below the floor (a deck edge)
export const PLACE_SPEED = 0.3; // m/s moving a part into place by hand
export const LIFT_CLEAR = 0.08; // m: a part is lifted this far above both its rest and its place while moved
export const STAND_OFF = 0.45; // m from a part's edge to the station of the person placing it
export const BODY_GAP = HUMAN_PROFILE.radius + 0.02; // a part in someone's body band stays this far from them
export const HAND_SPREAD = 0.15;
export const TILT_MAX = 60; // degrees
export const T = { crouch: 0.6, lift: 0.5, setDown: 0.5, fastenRail: 2.0, tilt: 2.0, fastenPanel: 3.0, configure: 1.0 } as const;

const bad = (code: string, message: string, subjects: string[], at?: Vec3) => ({ ok: false as const, diagnostic: { code, message, subjects, ...(at ? { at } : {}) } as Diagnostic });
type Fail = ReturnType<typeof bad>;
const xz = (p: Pose): Vec2 => [p.p[0], p.p[2]];
const size = (e: Entity) => def(e.def).size;
const label = (e: Entity) => `${def(e.def).label} ${e.id}`;
const corners = (o: OBB2): Vec2[] => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => add2(o.c, rot2([a * o.half[0], b * o.half[1]], o.yaw)));

// ---------------------------------------------------------------- set in place by hand (shared)

type Station = { actor: string; p: Vec2; yaw: number; level: number; floor: number };
type Seg = { phase: string; from: Pose; to: Pose; dur: number };
export type PlaceProgram = { item: string; stations: Station[]; segs: Seg[]; finish: { phase: string; dur: number } };
type PlaceExec = { id: string; prog: PlaceProgram; walk?: Children; i: number; t: number; done: boolean };

/** Both hands on the part's top at its point nearest `feet`, spread along that edge, [left, right]. */
export function partHands(e: Entity, q: Pose, feet: Vec3): [Vec3, Vec3] {
  const o = flatObb(q, e);
  const n = nearestOnRect(o, [feet[0], feet[2]]);
  const clamp = (p: Vec2) => nearestOnRect(o, p).q;
  const a = clamp(add2(n.q, scale2(n.t, HAND_SPREAD))), b = clamp(sub2(n.q, scale2(n.t, HAND_SPREAD)));
  const f = sub2(n.q, [feet[0], feet[2]]);
  const left: Vec2 = [f[1], -f[0]];
  const [l, r] = dot2(sub2(a, b), left) >= 0 ? [a, b] : [b, a];
  const y = topAt(e, q, l), y2 = topAt(e, q, r);
  return [[l[0], y, l[1]], [r[0], y2, r[1]]];
}
/** Height of the part's top surface over plan point p (tilted panels: the plane through its top face). */
function topAt(e: Entity, q: Pose, p: Vec2): number {
  const [sx, sy, sz] = size(e);
  if (!q.pitch && !q.roll) return q.p[1] + sy;
  const o = toWorld(q, [0, sy, 0]);
  const ax = toWorld(q, [sx / 2, sy, 0]), az = toWorld(q, [0, sy, sz / 2]);
  // solve p = o + u·(ax − o) + v·(az − o) in plan, height by the same u, v
  const U: Vec2 = [ax[0] - o[0], ax[2] - o[2]], V: Vec2 = [az[0] - o[0], az[2] - o[2]], d: Vec2 = [p[0] - o[0], p[1] - o[2]];
  const det = U[0] * V[1] - U[1] * V[0];
  if (Math.abs(det) < 1e-12) return o[1];
  const u = (d[0] * V[1] - d[1] * V[0]) / det, v = (U[0] * d[1] - U[1] * d[0]) / det;
  return o[1] + u * (ax[1] - o[1]) + v * (az[1] - o[1]);
}

function samplesOf(a: Pose, b: Pose): Pose[] {
  const d = Math.sqrt((b.p[0] - a.p[0]) ** 2 + (b.p[1] - a.p[1]) ** 2 + (b.p[2] - a.p[2]) ** 2) + Math.abs(angleDelta(a.yaw, b.yaw)) + Math.abs((b.pitch ?? 0) - (a.pitch ?? 0)) + Math.abs((b.roll ?? 0) - (a.roll ?? 0));
  const n = Math.max(1, Math.ceil(d / 0.05));
  return Array.from({ length: n + 1 }, (_, k) => lerpTilt(a, b, k / n));
}
function lerpTilt(a: Pose, b: Pose, s: number): Pose {
  const q = lerpPose(a, b, s);
  const pitch = (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * s, roll = (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * s;
  return { p: q.p, yaw: q.yaw, ...(pitch ? { pitch } : {}), ...(roll ? { roll } : {}) };
}

/** A person's floor (level y) and level id; people on a beam / riding cannot place parts. */
function floorOf(rt: Runtime, h: Entity): { level: number; y: number } | Diagnostic {
  if (h.human!.on) return { code: 'solar.on-structure', message: `${h.id} stands on ${h.human!.on}; step onto a deck or the ground first`, subjects: [h.id] };
  if (h.human!.riding) return { code: 'solar.riding', message: `${h.id} is riding ${h.human!.riding}`, subjects: [h.id] };
  const g = spatialOf(rt).level(h.human!.level);
  return { level: h.human!.level, y: g ? g.y : h.pose.p[1] };
}

function crewOk(rt: Runtime, crew: string[], verb: string): Fail | null {
  const seen = new Set<string>();
  for (const c of crew) {
    const h = rt.world.entities[c];
    if (!h) return bad('entity.unknown', `no actor "${c}"`, [c]);
    if (h.kind !== 'human' || !h.human) return bad('actor.not-human', `"${c}" is a ${h.kind}, not a person`, [c]);
    if (seen.has(c)) return bad('crew.duplicate', `${c} is listed twice`, [c]);
    seen.add(c);
    const hd = holdingDiagnostic(rt.world, c);
    if (hd) return { ok: false, diagnostic: hd };
    if (h.human.task) return bad('solar.busy', `${c} is busy (${h.human.task}); ${verb} needs them free`, [c]);
  }
  return null;
}

/**
 * Plan setting part `e` from pose `from` to `to` by hand (crew on one floor): stations beside it, the
 * path lift → move → set down (swept against the scene, ignoring `ignore`), hands inside the envelope
 * all along, nobody standing in its path. `finish` is the closing phase (fasten / configure).
 */
function planPlace(rt: Runtime, e: Entity, crew: string[], from: Pose, to: Pose, ignore: string[], finish: { phase: string; dur: number }, code: string): { ok: true; program: PlaceProgram } | Fail {
  const w = rt.world;
  const floors = crew.map((c) => floorOf(rt, w.entities[c]));
  for (const f of floors) if ('code' in f) return { ok: false, diagnostic: f };
  const fl = floors as { level: number; y: number }[];
  if (fl.some((f) => f.level !== fl[0].level)) return bad('crew.split', `the crew must stand on one floor to place ${e.id}`, crew);
  const floor = fl[0].y, level = fl[0].level;
  for (const [what, q] of [['where it lies', from], ['its place', to]] as const) {
    const up = q.p[1] - floor;
    if (up > REACH_UP + 1e-9)
      return bad('solar.too-high', `${label(e)} ${what} is ${f2(up)} m above the crew's floor (standing reach ${REACH_UP} m); hand it up (hand_up) or use the forklift`, [e.id, ...crew], q.p);
    if (up < -REACH_DOWN - 1e-9) return bad('solar.too-low', `${label(e)} ${what} is ${f2(-up)} m below the crew's floor (max ${REACH_DOWN} m)`, [e.id, ...crew], q.p);
  }
  if (dist2(xz(from), xz(to)) > STAGE_NEAR + 1e-9)
    return bad('solar.not-staged', `${label(e)} lies ${f2(dist2(xz(from), xz(to)))} m from its place (${f2(to.p[0])}, ${f2(to.p[2])}); carry it within ${STAGE_NEAR} m first`, [e.id], from.p);
  const yUp = Math.max(from.p[1], to.p[1]) + LIFT_CLEAR;
  const up: Pose = { ...from, p: [from.p[0], yUp, from.p[2]] };
  const over: Pose = { ...to, p: [to.p[0], yUp, to.p[2]] };
  const hit = sweepPoses(rt, e, [up, over], [e.id, ...ignore]) ?? sweepPoses(rt, e, [over, to], [e.id, ...ignore]);
  if (hit) return bad('solar.path-blocked', `${label(e)} cannot be moved into place: it would hit ${hit.o.label ?? hit.o.id} at (${f2(hit.q.p[0])}, ${f2(hit.q.p[1])}, ${f2(hit.q.p[2])})`, [e.id, hit.o.id], hit.q.p);
  const segs: Seg[] = [
    { phase: 'crouch', from, to: from, dur: T.crouch },
    { phase: 'lift', from, to: up, dur: T.lift },
    { phase: 'place', from: up, to: over, dur: Math.max(0.4, dist2(xz(up), xz(over)) / PLACE_SPEED) },
    { phase: 'set_down', from: over, to, dur: T.setDown },
  ];
  const path = segs.flatMap((s) => samplesOf(s.from, s.to));
  // stations: around the place, STAND_OFF out from each side / corner, on the crew's floor
  const g = spatialOf(rt).level(level);
  const o = flatObb(to, e);
  const dirs: Vec2[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
  const others = Object.values(w.entities).filter((x) => x.human && !crew.includes(x.id) && x.human.level === level).map((x) => xz(x.pose));
  // sides / corners, plus spots along the long sides of a long part (a rail: beside it, not only at its middle)
  const long = o.half[0] >= o.half[1] ? 0 : 1;
  const locs: Vec2[] = dirs.map((d) => [d[0] * (o.half[0] + STAND_OFF), d[1] * (o.half[1] + STAND_OFF)]);
  if (o.half[long] > 0.5)
    for (const k of [0.35, -0.35, 0.7, -0.7])
      for (const side of [1, -1]) locs.push(long === 0 ? [k * o.half[0], side * (o.half[1] + STAND_OFF)] : [side * (o.half[0] + STAND_OFF), k * o.half[1]]);
  const cands = locs.map((lp, k) => ({ p: add2(o.c, rot2(lp, o.yaw)), k })).filter(({ p }) => {
    if (!g || clearanceAt(g, p) < HUMAN_PROFILE.radius) return false;
    if (others.some((o) => dist2(o, p) < 2 * HUMAN_PROFILE.radius + 0.04)) return false; // someone else stands there
    const feet: Vec3 = [p[0], floor, p[1]];
    return path.every((q) => {
      const inBand = q.p[1] + size(e)[1] > floor + 0.02 && q.p[1] < floor + HUMAN_PROFILE.height;
      if (inBand && dist2(nearestOnRect(flatObb(q, e), p).q, p) < BODY_GAP) return false;
      return partHands(e, q, feet).every((h) => envelopeGap('crouch', feet, h) <= 0);
    });
  });
  // nearest to where each person is now, ≥ 0.6 m apart, deterministic
  const stations: Station[] = [];
  for (const c of crew) {
    const h = w.entities[c];
    const pick = cands
      .filter((s) => stations.every((t) => dist2(t.p, s.p) >= 0.6))
      .sort((a, b) => dist2(a.p, xz(h.pose)) - dist2(b.p, xz(h.pose)) || a.k - b.k)[0];
    if (!pick) return bad(code, `nobody can stand beside ${label(e)} at (${f2(to.p[0])}, ${f2(to.p[2])}) on level ${level} and reach it all the way into place (hands within reach, not standing in its path)`, [e.id, ...crew], to.p);
    const n = nearestOnRect(o, pick.p).q;
    stations.push({ actor: c, p: pick.p, yaw: datan2(n[1] - pick.p[1], n[0] - pick.p[0]), level, floor });
  }
  const r = checkStations(rt, stations.map((s) => ({ actor: s.actor, p: s.p, level })));
  if (r) return { ok: false, diagnostic: { ...r, code: `${code}-unreachable` } };
  return { ok: true, program: { item: e.id, stations, segs, finish } };
}

function holdAll(rt: Runtime, ex: PlaceExec, activity: string, q: Pose) {
  const e = rt.world.entities[ex.prog.item];
  for (const s of ex.prog.stations) {
    const h = rt.world.entities[s.actor];
    const hands = partHands(e, q, h.pose.p);
    Object.assign(h.human!, { activity, task: ex.id, grip: { entity: e.id, slot: 'place' } });
    setHands(h, hands);
  }
}
function releaseAll(rt: Runtime, crew: string[]) {
  for (const c of crew) {
    const h = rt.world.entities[c];
    Object.assign(h.human!, { activity: 'idle', grip: undefined, task: undefined });
    setHands(h, undefined);
  }
}

/** One tick of the shared placement; 'finished' once the closing phase is done (the caller finalises). */
function stepPlace(rt: Runtime, ex: PlaceExec, dt: number): StepResult | 'finished' {
  const w = rt.world;
  const e = w.entities[ex.prog.item];
  if (!ex.walk) {
    const r = walkCrew(rt, ex.id, ex.prog.stations.map((s) => ({ actor: s.actor, p: s.p, yaw: s.yaw, level: s.level })));
    if ('code' in r) return { status: 'failed', diagnostic: r };
    ex.walk = r;
  }
  const s = ex.i < 0 ? childrenState(ex.walk) : 'done';
  if (typeof s === 'object') return { status: 'failed', diagnostic: s };
  if (s === 'running') return { status: 'running', phase: 'approach' };
  if (ex.i < 0) { ex.i = 0; ex.t = 0; }
  const seg = ex.prog.segs[ex.i];
  ex.t += dt;
  if (seg) {
    const k = Math.min(1, ex.t / seg.dur);
    const q = lerpTilt(seg.from, seg.to, seg.phase === 'place' ? k : smooth(k));
    if (seg.phase === 'lift' && e.phase !== 'carried') {
      e.phase = 'carried';
      e.support = { kind: 'held', by: ex.prog.stations.map((x) => x.actor) };
    }
    if (seg.phase !== 'crouch') e.pose = q;
    holdAll(rt, ex, seg.phase, e.pose);
    if (ex.t >= seg.dur - 1e-9) { ex.i++; ex.t = 0; }
    return { status: 'running', phase: seg.phase };
  }
  holdAll(rt, ex, ex.prog.finish.phase, e.pose);
  if (ex.t < ex.prog.finish.dur - 1e-9) return { status: 'running', phase: ex.prog.finish.phase };
  releaseAll(rt, ex.prog.stations.map((x) => x.actor));
  return 'finished';
}
const cancelPlace = (rt: Runtime, ex: PlaceExec, code: string) => {
  const e = rt.world.entities[ex.prog.item];
  if (e.phase === 'carried') return { ok: false as const, diagnostic: { code, message: `${e.id} is in the crew's hands; it cannot be abandoned mid-air`, subjects: [e.id] } };
  releaseAll(rt, ex.prog.stations.map((x) => x.actor).filter((a) => rt.world.entities[a].human!.task === ex.id));
  return { ok: true as const };
};
const NOT_RESUMABLE = 'solar placement drives child walks and holds a part in the crew\'s hands; its exec is not serialised';

// ---------------------------------------------------------------- install_rail

type RailP = { actor: string; rail: string; onto: string; at: { x: number; z: number; yaw: number } };
type RailProg = PlaceProgram & { supports: string[]; on: string };

/** What an installed rail at plan rect `o` would rest on: a deck sheet, or ≥ 2 installed framing members. */
export function railSupport(rt: Runtime, rail: Entity, o: OBB2, onto: string): { ok: true; y: number; supports: string[]; on: string } | Fail {
  const w = rt.world;
  const m = w.entities[onto];
  const where = `(${f2(o.c[0])}, ${f2(o.c[1])})`;
  if (!m || m.kind !== 'component' || m.phase !== 'installed')
    return bad('solar.rail-no-support', `rail ${rail.id} at ${where} would rest on nothing: ${m ? `${m.id} is ${m.phase ?? 'not a component'}, not installed` : `there is no "${onto}"`}; a rail needs installed 2x4 framing or a deck under it`, [rail.id, onto]);
  if (isPlywood(m)) {
    // the deck: every installed sheet level with `onto` (abutting sheets form one deck)
    const top = memberTop(m);
    const sheets = Object.values(w.entities)
      .filter((x) => isPlywood(x) && x.phase === 'installed' && Math.abs(memberTop(x) - top) <= 0.01)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const pts = [...corners(o), o.c, ...[-0.5, -0.25, 0.25, 0.5].map((k) => add2(o.c, rot2([k * 2 * o.half[0], 0], o.yaw)))];
    const over = Math.max(...pts.map((c) => Math.min(...sheets.map((x) => { const so = flatObb(x.pose, x); return dist2(nearestOnRect(so, c).q, c); }))));
    if (over > 0.01) return bad('solar.rail-no-support', `rail ${rail.id} at ${where} would overhang deck sheet ${m.id} by ${f2(over)} m; a rail rests on the deck along its whole length`, [rail.id, m.id]);
    const under = sheets.filter((x) => rectsOverlap(o, flatObb(x.pose, x))).map((x) => x.id);
    return { ok: true, y: top, supports: under, on: under.includes(m.id) ? m.id : under[0] };
  }
  if (def(m.def).category !== 'timber')
    return bad('solar.rail-no-support', `rail ${rail.id} needs installed 2x4 framing or a deck under it; ${label(m)} is neither`, [rail.id, m.id]);
  const top = memberTop(m);
  const ms = Object.values(w.entities)
    .filter((x) => x.kind === 'component' && def(x.def).category === 'timber' && x.phase === 'installed' && Math.abs(memberTop(x) - top) <= 0.01)
    .filter((x) => rectsOverlap(o, flatObb(x.pose, x)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!ms.some((x) => x.id === m.id)) return bad('solar.rail-no-support', `rail ${rail.id} at ${where} does not cross ${m.id}; it would rest on nothing`, [rail.id, m.id]);
  if (ms.length < 2) return bad('solar.rail-no-support', `rail ${rail.id} at ${where} would rest on ${m.id} alone; it must cross at least two installed framing members`, [rail.id, m.id]);
  return { ok: true, y: top, supports: ms.map((x) => x.id), on: m.id };
}
function rectsOverlap(a: OBB2, b: OBB2): boolean {
  const ax = [rot2([1, 0], a.yaw), rot2([0, 1], a.yaw), rot2([1, 0], b.yaw), rot2([0, 1], b.yaw)];
  const proj = (o: OBB2, n: Vec2) => {
    const r = o.half[0] * Math.abs(dot2(rot2([1, 0], o.yaw), n)) + o.half[1] * Math.abs(dot2(rot2([0, 1], o.yaw), n));
    const c = dot2(o.c, n);
    return [c - r, c + r];
  };
  return ax.every((n) => { const [a0, a1] = proj(a, n), [b0, b1] = proj(b, n); return a1 > b0 + 0.005 && b1 > a0 + 0.005; });
}

export const installRail: ActionDef<RailP, RailProg, PlaceExec & { p: RailP }> = {
  verb: 'install_rail',
  description: `Set a solar panel rail on installed 2x4 framing (crossing ≥ 2 members) or on a deck sheet, and fasten it. The rail must lie within ${STAGE_NEAR} m of its place on the actor's floor (carry it first); its place within standing reach (${REACH_UP} m). Refused when it would rest on nothing.`,
  schema: z.strictObject({
    actor: z.string().max(80),
    rail: z.string().max(80),
    onto: z.string().max(80),
    at: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), yaw: z.number().min(-10).max(10) }),
  }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `entity:${p.rail}`, mode: 'exclusive' }],
  resumable: NOT_RESUMABLE,
  plan(rt, p) {
    const w = rt.world;
    const e = w.entities[p.rail];
    if (!e || !isRail(e.def)) return bad('solar.not-rail', `"${p.rail}" is not a panel rail`, [p.rail]);
    if (e.phase === 'installed') return bad('solar.installed', `${e.id} is already installed`, [e.id]);
    if (e.support?.kind !== 'ground' && e.support?.kind !== 'resting-on') return bad('solar.not-staged', `${e.id} is ${e.phase ?? 'unplaced'} (support ${e.support?.kind ?? 'none'}); it must lie on a floor near its place`, [e.id]);
    const c = crewOk(rt, [p.actor], 'install_rail');
    if (c) return c;
    const o: OBB2 = { c: [p.at.x, p.at.z], half: [size(e)[0] / 2, size(e)[2] / 2], yaw: p.at.yaw };
    const s = railSupport(rt, e, o, p.onto);
    if (!s.ok) return s;
    const to: Pose = { p: [p.at.x, s.y, p.at.z], yaw: p.at.yaw };
    const r = planPlace(rt, e, [p.actor], e.pose, to, [...s.supports, ...(e.support?.kind === 'resting-on' ? [e.support.on] : [])], { phase: 'fasten', dur: T.fastenRail }, 'solar.no-station');
    if (!r.ok) return r;
    return { ok: true, program: { ...r.program, supports: s.supports, on: s.on } };
  },
  start: (rt, p, prog, id) => ({ id, p, prog, i: -1, t: 0, done: false }),
  step(rt, ex, dt) {
    const r = stepPlace(rt, ex, dt);
    if (r !== 'finished') return r;
    const e = rt.world.entities[ex.prog.item];
    const pr = ex.prog as RailProg;
    e.phase = 'installed';
    e.support = { kind: 'resting-on', on: pr.on };
    e.connections = pr.supports.map((m) => ({ socket: 'bears-on', to: m, toSocket: 'rail' }));
    spatialOf(rt);
    return { status: 'completed', outputs: { rail: e.id, at: [...e.pose.p], supports: pr.supports } };
  },
  cancel: (rt, ex) => cancelPlace(rt, ex, 'solar.cancel-unsafe'),
};

// ---------------------------------------------------------------- install_panel

type PanelP = { crew: string[]; panel: string; rails: string[]; tilt: number; at?: { x: number; z: number } };
type PanelProg = { place: PlaceProgram | null; stations: Station[]; flat: Pose; tilted: Pose; rails: string[]; tiltDeg: number };
type PanelExec = { id: string; p: PanelP; prog: PanelProg; place?: PlaceExec; walk?: Children; phase: 'place' | 'walk' | 'tilt' | 'fasten'; t: number };

/** The panel's tilted pose on rails (top `y`, direction `dir`): tilted `tilt` rad about its local axis ∥ the rails, low edge on the rails. */
export function tiltedPose(panel: Entity, flat: Pose, dir: Vec2, y: number, tilt: number): Pose | null {
  const lx = rot2([1, 0], flat.yaw), lz = rot2([0, 1], flat.yaw);
  const [sx, , sz] = size(panel);
  if (Math.abs(dot2(lx, dir)) > 0.98) return { p: [flat.p[0], y + (sz / 2) * dsin(tilt), flat.p[2]], yaw: flat.yaw, pitch: tilt };
  if (Math.abs(dot2(lz, dir)) > 0.98) return { p: [flat.p[0], y + (sx / 2) * dsin(tilt), flat.p[2]], yaw: flat.yaw, roll: tilt };
  return null;
}

function planPanel(rt: Runtime, p: PanelP): { ok: true; program: PanelProg } | Fail {
  const w = rt.world;
  const e = w.entities[p.panel];
  if (!e || !isPanel(e.def)) return bad('solar.not-panel', `"${p.panel}" is not a solar panel`, [p.panel]);
  if (e.phase === 'installed') return bad('solar.installed', `${e.id} is already installed`, [e.id]);
  const hd = def(e.def).handling!;
  if (p.crew.length < hd.carryCrew[0] || p.crew.length > hd.carryCrew[1]) return bad('crew.size', `${label(e)} is mounted by ${hd.carryCrew[0]}–${hd.carryCrew[1]} people; ${p.crew.length} assigned`, [e.id, ...p.crew]);
  const c = crewOk(rt, p.crew, 'install_panel');
  if (c) return c;
  // ---- the rails
  const [ra, rb] = p.rails;
  if (!ra || !rb || ra === rb) return bad('solar.panel-rails', `${label(e)} needs two different installed rails; got ${p.rails.join(', ') || 'none'}`, [e.id, ...p.rails]);
  const rails = [ra, rb].map((id) => w.entities[id]);
  for (const [i, r] of rails.entries()) {
    if (!r || !isRail(r.def)) return bad('solar.panel-rails', `"${[ra, rb][i]}" is not a panel rail`, [e.id, [ra, rb][i]]);
    if (r.phase !== 'installed') return bad('solar.rail-not-installed', `rail ${r.id} is ${r.phase ?? 'not placed'}, not installed (install_rail first); ${e.id} needs two installed rails`, [e.id, r.id]);
  }
  const dy = Math.abs(angleDelta(rails[0].pose.yaw, rails[1].pose.yaw));
  if (dy > 0.02 && Math.abs(dy - Math.PI) > 0.02) return bad('solar.panel-rails', `rails ${ra} and ${rb} are not parallel`, [ra, rb]);
  const top = memberTop(rails[0]);
  if (Math.abs(memberTop(rails[1]) - top) > 0.01) return bad('solar.panel-rails', `rails ${ra} (${f2(top)} m) and ${rb} (${f2(memberTop(rails[1]))} m) are not level with each other`, [ra, rb]);
  const dir = rot2([1, 0], rails[0].pose.yaw);
  if (!(p.tilt >= 0 && p.tilt <= TILT_MAX)) return bad('solar.tilt', `tilt ${p.tilt}° is outside 0–${TILT_MAX}°`, [e.id]);
  const tilt = p.tilt * DEG;
  // ---- where the panel is: resting on the rails (handed up / off the forks), or low enough to lay on them by hand
  let flat: Pose;
  let place: PlaceProgram | null = null;
  const onRails = e.support?.kind === 'resting-on' && (e.support.on === ra || e.support.on === rb);
  if (e.support?.kind === 'forks') return bad('solar.panel-on-forks', `${e.id} is on the forks of ${e.support.vehicle}; the receivers take it off and lay it on the rails with hand_up (via: 'forklift')`, [e.id]);
  if (onRails) flat = { p: [...e.pose.p] as Vec3, yaw: e.pose.yaw };
  else {
    if (e.support?.kind !== 'ground' && e.support?.kind !== 'resting-on') return bad('solar.not-staged', `${e.id} is ${e.phase} (support ${e.support?.kind ?? 'none'})`, [e.id]);
    const floor = e.pose.p[1];
    if (top - floor > REACH_UP + 1e-9)
      return bad('solar.panel-too-high', `rails ${ra} / ${rb} are ${f2(top - floor)} m above ${e.id} where it lies (standing reach ${REACH_UP} m): hand it up onto the rails (hand_up to them) or bring it on the forklift (hand_up via: 'forklift') first`, [e.id, ra, rb], e.pose.p);
    if (!p.at) return bad('solar.panel-at', `${e.id} lies on the floor: give \`at\` (where on the rails it goes)`, [e.id]);
    flat = { p: [p.at.x, top, p.at.z], yaw: e.pose.yaw };
  }
  const o = flatObb(flat, e);
  for (const r of rails)
    if (!rectsOverlap(o, flatObb(r.pose, r))) return bad('solar.panel-rails', `${label(e)} at (${f2(flat.p[0])}, ${f2(flat.p[2])}) does not span rail ${r.id}; a panel rests on both rails`, [e.id, r.id]);
  const tilted = tiltedPose(e, flat, dir, top, tilt);
  if (!tilted) return bad('solar.panel-skew', `${label(e)} lies askew to rails ${ra} / ${rb} (its edges must be parallel to them to tilt about them)`, [e.id, ra, rb]);
  if (!onRails) {
    const r = planPlace(rt, e, p.crew, e.pose, flat, [ra, rb, ...(e.support?.kind === 'resting-on' ? [e.support.on] : [])], { phase: 'set_down', dur: 0.2 }, 'solar.no-station');
    if (!r.ok) return r;
    place = r.program;
  }
  const hit = sweepPoses(rt, e, samplesOf(flat, tilted), [e.id, ra, rb, ...rails.flatMap((r) => (r.connections ?? []).map((x) => x.to))]);
  if (hit) return bad('solar.path-blocked', `${e.id} cannot be tilted to ${p.tilt}°: its raised edge would hit ${hit.o.label ?? hit.o.id}`, [e.id, hit.o.id], hit.q.p);
  // ---- stations for the tilt: beyond both ends of the tilt axis (they hold the panel's end edges)
  const floors = p.crew.map((cc) => floorOf(rt, w.entities[cc]));
  for (const f of floors) if ('code' in f) return { ok: false, diagnostic: f };
  const fl = floors as { level: number; y: number }[];
  if (fl.some((f) => f.level !== fl[0].level)) return bad('crew.split', `the crew must stand on one floor to mount ${e.id}`, p.crew);
  const up = top - fl[0].y;
  if (up > REACH_UP + 1e-9 || up < -REACH_DOWN - 1e-9)
    return bad('solar.too-high', `rails ${ra} / ${rb} are ${f2(up)} m from the crew's floor (reach −${REACH_DOWN}…${REACH_UP} m); the crew must stand up there (on the deck / roof)`, [e.id, ...p.crew]);
  const along = Math.abs(dot2(rot2([1, 0], flat.yaw), dir)) > 0.98 ? size(e)[0] / 2 : size(e)[2] / 2;
  const g = spatialOf(rt).level(fl[0].level);
  const ends: Vec2[] = [add2(xz(flat), scale2(dir, along + STAND_OFF)), sub2(xz(flat), scale2(dir, along + STAND_OFF))];
  const path = samplesOf(flat, tilted);
  const okAt = (q: Vec2) => {
    if (!g || clearanceAt(g, q) < HUMAN_PROFILE.radius) return false;
    const feet: Vec3 = [q[0], fl[0].y, q[1]];
    return path.every((qq) => partHands(e, qq, feet).every((h) => envelopeGap('crouch', feet, h) <= 0));
  };
  if (!ends.every(okAt)) return bad('solar.no-station', `the crew cannot stand at both ends of ${label(e)} (along rails ${ra} / ${rb}) on level ${fl[0].level} and hold it through the tilt`, [e.id, ...p.crew], flat.p);
  // nearer end to the first crew member
  const h0 = w.entities[p.crew[0]];
  const order = place ? [0, 1] : dist2(ends[0], xz(h0.pose)) <= dist2(ends[1], xz(h0.pose)) ? [0, 1] : [1, 0];
  const stations = p.crew.map((a, i) => {
    const q = ends[order[i]];
    return { actor: a, p: q, yaw: datan2(flat.p[2] - q[1], flat.p[0] - q[0]), level: fl[0].level, floor: fl[0].y };
  });
  const r = checkStations(rt, stations.map((s) => ({ actor: s.actor, p: s.p, level: s.level })));
  if (r) return { ok: false, diagnostic: { ...r, code: 'solar.no-station-unreachable' } };
  return { ok: true, program: { place, stations, flat, tilted, rails: [ra, rb], tiltDeg: p.tilt } };
}

export const installPanel: ActionDef<PanelP, PanelProg, PanelExec> = {
  verb: 'install_panel',
  description: `Mount a solar panel on two installed parallel rails: tilted \`tilt\` degrees (0–${TILT_MAX}) about the rails' direction, low edge on the rails (the tilt legs are implied), fastened by a crew of 2. The panel must already rest on the rails (hand_up onto them, or off the forklift) when they are above standing reach (${REACH_UP} m) of where it lies; below that the crew lays it on the rails at \`at\` from within ${STAGE_NEAR} m.`,
  schema: z.strictObject({
    crew: z.array(z.string().max(80)).min(1).max(4),
    panel: z.string().max(80),
    rails: z.array(z.string().max(80)).min(1).max(2),
    tilt: z.number().min(-90).max(90),
    at: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4) }).optional(),
  }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.panel}`, mode: 'exclusive' }],
  resumable: NOT_RESUMABLE,
  plan: planPanel,
  start: (_rt, p, prog, id) => ({ id, p, prog, ...(prog.place ? { place: { id, prog: prog.place, i: -1, t: 0, done: false } } : {}), phase: prog.place ? 'place' : 'walk', t: 0 }),
  step(rt, ex, dt) {
    const w = rt.world;
    const e = w.entities[ex.p.panel];
    if (ex.phase === 'place') {
      const r = stepPlace(rt, ex.place!, dt);
      if (r !== 'finished') return r;
      e.phase = 'staged';
      e.support = { kind: 'resting-on', on: ex.prog.rails[0] };
      ex.phase = 'walk';
    }
    if (ex.phase === 'walk') {
      if (!ex.walk) {
        const r = walkCrew(rt, ex.id, ex.prog.stations.map((s) => ({ actor: s.actor, p: s.p, yaw: s.yaw, level: s.level })));
        if ('code' in r) return { status: 'failed', diagnostic: r };
        ex.walk = r;
      }
      const s = childrenState(ex.walk);
      if (typeof s === 'object') return { status: 'failed', diagnostic: s };
      if (s === 'running') return { status: 'running', phase: 'approach' };
      ex.phase = 'tilt';
      ex.t = 0;
      e.phase = 'placed';
    }
    ex.t += dt;
    const hold = (activity: string) => {
      for (const st of ex.prog.stations) {
        const h = w.entities[st.actor];
        Object.assign(h.human!, { activity, task: ex.id, grip: { entity: e.id, slot: 'mount' } });
        setHands(h, partHands(e, e.pose, h.pose.p));
      }
    };
    if (ex.phase === 'tilt') {
      e.pose = lerpTilt(ex.prog.flat, ex.prog.tilted, smooth(Math.min(1, ex.t / T.tilt)));
      hold('tilt');
      if (ex.t >= T.tilt - 1e-9) { ex.phase = 'fasten'; ex.t = 0; }
      return { status: 'running', phase: 'tilt' };
    }
    hold('fasten');
    if (ex.t < T.fastenPanel - 1e-9) return { status: 'running', phase: 'fasten' };
    e.pose = { ...ex.prog.tilted, p: [...ex.prog.tilted.p] as Vec3 };
    e.phase = 'installed';
    e.support = { kind: 'resting-on', on: ex.prog.rails[0] };
    e.connections = ex.prog.rails.map((r) => ({ socket: 'bears-on', to: r, toSocket: 'panel' }));
    releaseAll(rt, ex.prog.stations.map((s) => s.actor));
    spatialOf(rt);
    return { status: 'completed', outputs: { panel: e.id, rails: ex.prog.rails, tilt: ex.prog.tiltDeg, at: [...e.pose.p] } };
  },
  cancel(rt, ex) {
    if (ex.place && ex.phase === 'place') return cancelPlace(rt, ex.place, 'solar.cancel-unsafe');
    const e = rt.world.entities[ex.p.panel];
    if (ex.phase === 'tilt' || ex.phase === 'fasten') return { ok: false, diagnostic: { code: 'solar.cancel-unsafe', message: `${e.id} is being tilted / fastened on its rails; it cannot be let go half-mounted`, subjects: [e.id] } };
    return { ok: true };
  },
};

// ---------------------------------------------------------------- place_equipment

type EquipP = { actor: string; item: string; at: { x: number; z: number; yaw: number }; config?: Record<string, number | string | boolean> };
type EquipProg = PlaceProgram & { on: string | null; config: Record<string, number | string | boolean> };

export const placeEquipment: ActionDef<EquipP, EquipProg, PlaceExec & { p: EquipP }> = {
  verb: 'place_equipment',
  description: `Set a battery, charge controller or inverter down on the ground or a deck at \`at\` and configure it (entity \`equipment\`: kind + config, spec §19; no electrical simulation). It must lie within ${STAGE_NEAR} m of its place on the actor's floor (carry it first).`,
  schema: z.strictObject({
    actor: z.string().max(80),
    item: z.string().max(80),
    at: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), yaw: z.number().min(-10).max(10) }),
    config: z.record(z.string().max(40), z.union([z.number(), z.string().max(80), z.boolean()])).optional(),
  }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `entity:${p.item}`, mode: 'exclusive' }],
  resumable: NOT_RESUMABLE,
  plan(rt, p) {
    const w = rt.world;
    const e = w.entities[p.item];
    const eq = e && def(e.def).equipment;
    if (!e || !eq) return bad('solar.not-equipment', `"${p.item}" is not a battery, charge controller or inverter`, [p.item]);
    if (e.support?.kind !== 'ground' && e.support?.kind !== 'resting-on') return bad('solar.not-staged', `${e.id} is ${e.phase ?? 'unplaced'} (support ${e.support?.kind ?? 'none'}); it must lie on a floor near its place`, [e.id]);
    const c = crewOk(rt, [p.actor], 'place_equipment');
    if (c) return c;
    const h = w.entities[p.actor];
    const f = floorOf(rt, h);
    if ('code' in f) return { ok: false, diagnostic: f };
    // the surface under `at` on the actor's floor: the ground, or a deck sheet
    const sp = spatialOf(rt);
    const q: Vec2 = [p.at.x, p.at.z];
    let on: string | null = null;
    if (f.level !== 0) {
      const s = sp.scene.surfaces.find((x) => x.level === f.level && Math.abs(x.y - f.y) < 0.05 && pointIn(x.obb, q, -Math.max(size(e)[0], size(e)[2]) / 2));
      if (!s) return bad('solar.no-surface', `${e.id} at (${f2(q[0])}, ${f2(q[1])}) would not sit on the deck ${p.actor} stands on (level ${f.level}); place it on the ground or fully on a deck`, [e.id, p.actor], [q[0], f.y, q[1]]);
      on = s.id.startsWith('deck:') ? s.id.slice(5) : s.id;
    }
    const to: Pose = { p: [q[0], f.y, q[1]], yaw: p.at.yaw };
    const r = planPlace(rt, e, [p.actor], e.pose, to, [...(on ? [on] : []), ...(e.support?.kind === 'resting-on' ? [e.support.on] : [])], { phase: 'configure', dur: T.configure }, 'solar.no-station');
    if (!r.ok) return r;
    const cfg: Record<string, number | string | boolean> = { ...eq.defaults, ...(p.config ?? {}) };
    return { ok: true, program: { ...r.program, on, config: Object.fromEntries(Object.keys(cfg).sort().map((k) => [k, cfg[k]])) } };
  },
  start: (_rt, p, prog, id) => ({ id, p, prog, i: -1, t: 0, done: false }),
  step(rt, ex, dt) {
    const r = stepPlace(rt, ex, dt);
    if (r !== 'finished') return r;
    const e = rt.world.entities[ex.prog.item];
    const pr = ex.prog as EquipProg;
    e.phase = 'placed';
    e.support = pr.on ? { kind: 'resting-on', on: pr.on } : { kind: 'ground' };
    e.equipment = { kind: def(e.def).equipment!.kind, config: { ...pr.config } };
    spatialOf(rt);
    return { status: 'completed', outputs: { item: e.id, at: [...e.pose.p], on: pr.on ?? 'ground', equipment: e.equipment } };
  },
  cancel: (rt, ex) => cancelPlace(rt, ex, 'solar.cancel-unsafe'),
};
function pointIn(o: OBB2, p: Vec2, margin: number): boolean {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return Math.abs(l[0]) <= o.half[0] + margin + 1e-9 && Math.abs(l[1]) <= o.half[1] + margin + 1e-9;
}

export const SOLAR_ACTIONS: ActionDef[] = [installRail, installPanel, placeEquipment];
