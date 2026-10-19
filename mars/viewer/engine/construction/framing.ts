// 2x4 roof framing verbs — the layer between the rack skeleton and the roof / ceiling sheets (owner feedback
// 2026-09-28 §7: skeleton → 2x4 framing (top plates, rafters, joists) → stair → floors / walls / roof; evidence
// photo docs/engineering/evidence/2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg). W36.
// Mars assembly model v1, approximate; every rule below is PROVISIONAL (FRAMING.md).
//
//   install_top_plate {part, onto: [frame | beam …], at: {x, z, yaw}, givers, relay?, installers, fasten?, raise}
//   install_rafter    {part, from: plate, to: plate, at, pitch?, …crew}
//   install_blocking  {part, between: [rafter, rafter], on: plate, …crew}
//
// Support rules (checked at plan time; the invariant `framingSupported` re-checks the recorded supports every tick):
// * top plate (a 2x4 lying flat): bears ≥ 1.5 in onto ≥ 2 points — column tops of beam-stable frames that have
//   their TOP BEAMS on both columns (rules.ts frameTopProblem), and / or top faces of installed rack beams — with
//   its underside on them (±1 cm); cantilevers ≤ 24 in beyond its outermost bearing.
// * rafter (a 2x4 on edge): both plates installed and supported, parallel (±1°); it runs from the point `at` m along
//   plate `from` square across to plate `to`, its underside on both plate tops (the pitch is their height difference;
//   `pitch`, when given, must match ±1°); ≥ 1.5 in on each plate and a tail ≤ 12 in beyond each (names the lengths).
// * blocking: between two installed rafters that both bear on plate `on`, square to them (±1°), on the plate top,
//   the gap between the rafters' faces its length +0…2 cm (1 cm of play a side).
// Sheets on rafters need rafters at ≤ 24 in (rules.ts RAFTER_SPACING_MAX; the sheet rule is the year-build's).
//
// Choreography — the hang_beam / pass_up relay pattern, driven like set_part (setpart.ts helpers):
//   givers (1–2, on the floor below) walk to the member where it lies (≤ 7 m from `raise`), crouch, lift it (hands
//   hanging), walk it to `raise` — the plan point where it goes up, OUTSIDE everything above it — and reach up;
//   a relay (0–2, on frame stances or a deck) takes it and raises it; the installers (1–2, on stances or a deck)
//   take it, raise it CLEAR above its supports (tilting it to its pitch), slide it over them to its place, set it
//   down and fasten it (2 s; `fasten` adds helpers). Every hand-off height is searched (1 cm steps) inside both
//   crews' reach: none → `framing.gap` ("add a relay"). Installers who cannot reach the member where it goes →
//   `framing.out-of-reach` naming its height ("use a stance/deck").
// Reach (plan: every 5 cm of every motion; invariant `framingHandsInReach`: every tick, 0.1 m envelope tolerance):
// the body model's envelope (setpart reachGap) and, on a frame stance, stance.ts's rule (hands −0.5…+2.06 m from
// the feet, ≤ 0.8 m out); on a floor, ≤ +2.06 / ≥ −0.5 m, ≤ 0.8 m out. The member keeps clear of everyone's body
// (0.22 m + 2 cm on a stance, 0.28 m + 2 cm on a floor, in their 1.75 m body band); the givers' feet stand on free
// ground ≥ 2r − 0.06 from anyone; the swept path is clear of everything but the supports (access.ts sweepPoses).
// Hands: `human.hands` every tick in set_part's slot format (`setpart-<i>:<lx>:<ly>:<lz>`), so setPartHands()
// rebuilds them from a take and kitPartHandsInReach (if registered) checks them too.
import { z } from 'zod';
import { angleDelta, cross2, dasin, datan2, dcos, dsin, dist2, dot2, hypot, rot2, sub2, wrapAngle, type OBB2, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Invariant, Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose, WorldState } from '../world/types.ts';
import { def, HUMAN_RADIUS } from '../world/catalog.ts';
import { framingRole, type FramingRole } from '../world/catalog-framing.ts';
import { entityFootprint } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { crewCheck, distToObb, f2, fail, lerpPose, smooth, spatialOf, sweepPoses, type Fail } from './access.ts';
import { FRAMING_BEARING_MIN, frameTopProblem, isBeam, isSupported, isUpright, PLATE_OVERHANG_MAX, RAFTER_TAIL_MAX } from './rules.ts';
import { GIVE_MAX, REACH_DOWN, setHands, T } from './handup.ts';
import { gripHands, localToWorld, reachGap, SETPART_SLOT, setPartSlot } from './setpart.ts';
import { BODY_H, BODY_R, parseStance, STANCE_ARM, STANCE_DOWN, STANCE_UP } from './stance.ts';
import { BODY_MODEL, restHands } from '../body/model.ts';
import { relevantEntities } from '../world/relevant.ts';

const SIDE = 0.35; // m: givers stand this far beside the member (its local ±z) at their grip
export const FRAMING_CLEAR = 0.02; // m: slid over its supports this far above them, then set down
const SPEED = { carry: 0.6, raise: 0.5, aloft: 0.3, slide: 0.2, set: 0.1 } as const;
const STAGE = 7.0; // m: the member lies this close to its raise point
const STEP = 0.05; // m: plan sampling of every motion
const TOL = 0.1; // m: per-tick envelope tolerance (as set_part)
const ARM_TOL = 0.01;
const H_TOL = 0.01; // m: a member's underside on a support's top
const ANG = Math.PI / 180; // 1°
const PAIR_MIN = 0.5; // m: two holders' grips at least this far apart
const ONE_HOLDER_MAX = 1.5; // m: one person alone holds a member at most this long (hand_up FREE_END_MAX)
const FASTEN_S = 2.0;
const PEOPLE_GAP = 2 * HUMAN_RADIUS - 0.08 + 0.02; // the human-human invariant's separation + 2 cm
const END_KEEP = 0.75 * 0.0254; // a rafter point stays this far inside a plate's ends

type Role = 'give' | 'relay' | 'install';
const SLOT_BASE: Record<Role, number> = { give: 0, relay: 10, install: 20 };
const size = (e: Entity) => def(e.def).size;
const xzOf = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const at2 = (q: Pose): Vec2 => [q.p[0], q.p[2]];
const axisOf = (q: Pose): Vec2 => rot2([1, 0], q.yaw);
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
const f3 = (x: number) => x.toFixed(3);
/** Grips are whole millimetres: set_part's slot string carries them to 1 mm, so setPartHands() rebuilds the hands exactly. */
const mm = (x: number) => Math.round(x * 1000) / 1000;
const bad = (code: string, message: string, subjects: string[], at?: Vec3): Diagnostic => ({ code, message, subjects, at });
const isRole = (e: Entity | undefined, r: FramingRole) => !!e && framingRole(e.def) === r;
export const isFramingMember = (e?: Entity) => !!e && !!framingRole(e.def);
const label = (e: Entity) => `${def(e.def).label.replace(/ \((flat|on edge)\)$/, '')} ${e.id}`;

// ---------------------------------------------------------------- geometry of supports

/** Underside height of a member at pose q above plan point p (a sloped rafter rises along its roll). */
export function undersideAt(q: Pose, p: Vec2): number {
  const r = q.roll ?? 0;
  if (!r) return q.p[1];
  const s = dot2(sub2(p, at2(q)), axisOf(q));
  return q.p[1] + (s * dsin(r)) / dcos(r); // s·tan(roll)
}

type Bearing = { id: string; region: OBB2; top: number; what: string };
/** The two column tops of a standing frame (3 in square, inside its box ends). */
export function frameCaps(u: Entity): Bearing[] {
  const [d, h, t] = size(u);
  const cap = 1.5 * 0.0254;
  return ([-1, 1] as const).map((cs) => {
    const o = rot2([cs * (d / 2 - cap), 0], u.pose.yaw);
    return { id: u.id, region: { c: [u.pose.p[0] + o[0], u.pose.p[2] + o[1]], half: [cap, t / 2], yaw: u.pose.yaw }, top: u.pose.p[1] + h, what: `the ${cs < 0 ? 'left' : 'right'} column top of frame ${u.id}` };
  });
}
/** The top face of a beam / a flat member. */
function topFace(e: Entity): Bearing {
  const f = entityFootprint(e);
  return { id: e.id, region: f.obb, top: f.y1, what: `the top of ${e.id}` };
}
function project(o: OBB2, ax: Vec2): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = rot2([sx * o.half[0], sz * o.half[1]], o.yaw);
    const d = dot2([o.c[0] + c[0], o.c[1] + c[1]], ax);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return [lo, hi];
}
const overlapOn = (a: OBB2, b: OBB2, ax: Vec2) => { const [a0, a1] = project(a, ax), [b0, b1] = project(b, ax); return Math.min(a1, b1) - Math.max(a0, b0); };
/** How the member at pose q bears on b: bearing length along its axis (m), or why it does not. */
function bearing(e: Entity, q: Pose, b: Bearing): { len: number; along: [number, number] } | string {
  const m = entityFootprint({ ...e, pose: q }).obb;
  const ax = axisOf(q), nx = rot2([0, 1], q.yaw);
  const along = overlapOn(m, b.region, ax), across = overlapOn(m, b.region, nx);
  if (along <= 0.005 || across <= 0.005) return `it would not lie over ${b.what}`;
  const u = undersideAt(q, b.region.c);
  if (Math.abs(u - b.top) > H_TOL) return `its underside would be ${f3(u)} m over ${b.what} at ${f3(b.top)} m`;
  if (along < FRAMING_BEARING_MIN - 1e-6) return `it would bear only ${f3(along)} m on ${b.what} (≥ ${f3(FRAMING_BEARING_MIN)} m)`;
  const c = dot2(at2(q), ax);
  const [r0, r1] = project(b.region, ax);
  return { len: along, along: [r0 - c, r1 - c] };
}

// ---------------------------------------------------------------- support rules

export type Placement = { pose: Pose; supports: string[]; notes?: string };
type Place = (w: WorldState, e: Entity) => Placement | Diagnostic;

/** Top plate: flat on ≥ 2 bearings (frame column tops with top beams, rack beam tops), ≤ 24 in overhang. */
export function placePlate(w: WorldState, e: Entity, onto: string[], at: { x: number; z: number; yaw: number }): Placement | Diagnostic {
  const tops: number[] = [];
  const bearings: Bearing[][] = [];
  for (const id of onto) {
    const s = w.entities[id];
    if (!s) return bad('framing.unknown', `no support "${id}" for top plate ${e.id}`, [e.id, id]);
    if (isUpright(s)) {
      const p = frameTopProblem(w, s);
      if (p) return bad('framing.plate-frame-not-ready', `top plate ${e.id} cannot rest on ${s.id}: ${p} (a plate needs its frames' top beams)`, [e.id, s.id]);
      bearings.push(frameCaps(s));
    } else if (isBeam(s)) {
      if (s.phase !== 'installed') return bad('framing.plate-beam-not-installed', `top plate ${e.id} cannot rest on beam ${s.id}: it is not installed`, [e.id, s.id]);
      for (const c of s.connections ?? []) { const u = w.entities[c.to]; if (isUpright(u) && !isSupported(w, u)) return bad('framing.plate-frame-not-ready', `top plate ${e.id} cannot rest on beam ${s.id}: its frame ${u.id} is neither held nor stable`, [e.id, s.id, u.id]); }
      bearings.push([topFace(s)]);
    } else if (isRole(s, 'top-plate') && s.phase === 'installed') {
      bearings.push([topFace(s)]); // a double top plate on an installed one
    } else return bad('framing.plate-bad-support', `top plate ${e.id} cannot rest on ${s.id} (${def(s.def).label}): a plate rests on frame tops, rack beams or another installed plate`, [e.id, s.id]);
    tops.push(...bearings[bearings.length - 1].map((b) => b.top));
  }
  const pose: Pose = { p: [at.x, Math.max(...tops), at.z], yaw: at.yaw };
  let n = 0;
  let lo = Infinity, hi = -Infinity;
  for (const [i, bs] of bearings.entries()) {
    const hits = bs.map((b) => bearing(e, pose, b));
    const ok = hits.filter((h): h is { len: number; along: [number, number] } => typeof h !== 'string');
    if (!ok.length) return bad('framing.plate-no-bearing', `top plate ${e.id} at (${f2(at.x)}, ${f2(at.z)}) does not bear on ${onto[i]}: ${hits.filter((h): h is string => typeof h === 'string').join('; ')}`, [e.id, onto[i]]);
    n += ok.length;
    for (const h of ok) { lo = Math.min(lo, h.along[0]); hi = Math.max(hi, h.along[1]); }
  }
  if (n < 2) return bad('framing.plate-unsupported', `top plate ${e.id} would bear on ${n} point; it needs two (both column tops of a frame, column tops of two frames, or two beams)`, [e.id, ...onto]);
  const L = size(e)[0];
  const overhang = Math.max(lo + L / 2, L / 2 - hi); // beyond the outermost bearing at either end
  if (overhang > PLATE_OVERHANG_MAX + 1e-6) return bad('framing.plate-overhang', `top plate ${e.id} (${f3(L)} m) would cantilever ${f3(overhang)} m beyond its outermost bearing (max ${f3(PLATE_OVERHANG_MAX)} m)`, [e.id, ...onto]);
  return { pose, supports: [...onto] };
}

/** Rafter: plate to plate, square across from `at` along plate `from`; pitch = the plates' height difference. */
export function placeRafter(w: WorldState, e: Entity, from: string, to: string, at: number, pitch?: number): Placement | Diagnostic {
  const A = w.entities[from], B = w.entities[to];
  for (const [id, P] of [[from, A], [to, B]] as const) {
    if (!P || !isRole(P, 'top-plate')) return bad('framing.not-plate', `rafter ${e.id} spans plate to plate: ${id} is not a top plate`, [e.id, id]);
    if (P.phase !== 'installed') return bad('framing.plate-not-installed', `rafter ${e.id} needs both top plates installed first: ${P.id} is ${P.phase ?? 'not placed'}`, [e.id, P.id]);
    const sp = framingSupportProblem(w, P);
    if (sp) return bad('framing.plate-unsupported', `rafter ${e.id} cannot rest on ${P.id}: ${sp}`, [e.id, P.id]);
  }
  if (Math.abs(wrapAngle(2 * angleDelta(A.pose.yaw, B.pose.yaw))) > 2 * ANG) return bad('framing.plates-not-parallel', `plates ${A.id} and ${B.id} are ${deg(Math.abs(angleDelta(A.pose.yaw, B.pose.yaw)))}° apart; a rafter spans parallel plates`, [e.id, A.id, B.id]);
  const ax = axisOf(A.pose);
  const LA = size(A)[0], LB = size(B)[0];
  if (Math.abs(at) > LA / 2 - END_KEEP) return bad('framing.rafter-off-plate', `rafter ${e.id} at ${f3(at)} m along ${A.id} is off that ${f3(LA)} m plate`, [e.id, A.id]);
  const PA: Vec2 = [A.pose.p[0] + ax[0] * at, A.pose.p[2] + ax[1] * at];
  const sB = dot2(sub2(PA, xzOf(B)), ax);
  if (Math.abs(sB) > LB / 2 - END_KEEP) return bad('framing.rafter-off-plate', `rafter ${e.id} would land ${f3(sB)} m along ${B.id}, off that ${f3(LB)} m plate`, [e.id, B.id]);
  const PB: Vec2 = [B.pose.p[0] + ax[0] * sB, B.pose.p[2] + ax[1] * sB];
  const d = sub2(PB, PA);
  const Sh = hypot(d[0], d[1]);
  if (Sh < 0.2) return bad('framing.plates-too-close', `plates ${A.id} and ${B.id} are ${f3(Sh)} m apart: nothing to span`, [e.id, A.id, B.id]);
  const topA = A.pose.p[1] + size(A)[1], topB = B.pose.p[1] + size(B)[1];
  const roll = datan2(topB - topA, Sh);
  if (pitch !== undefined && Math.abs(pitch - roll) > ANG + 1e-9)
    return bad('framing.pitch-mismatch', `rafter ${e.id}: plates ${A.id} (top ${f3(topA)} m) and ${B.id} (top ${f3(topB)} m) ${f3(Sh)} m apart give a pitch of ${deg(roll)}°, not the ${deg(pitch)}° asked`, [e.id, A.id, B.id]);
  const L = size(e)[0], Lh = L * dcos(roll);
  const wA = size(A)[2], wB = size(B)[2];
  const min = (Sh - wA / 2 - wB / 2 + 2 * FRAMING_BEARING_MIN) / dcos(roll), max = (Sh + wA / 2 + wB / 2 + 2 * RAFTER_TAIL_MAX) / dcos(roll);
  const S = hypot(Sh, topB - topA);
  const why = `plates ${A.id} and ${B.id} are ${f3(S)} m apart centre to centre${Math.abs(roll) > 1e-6 ? ` (pitch ${deg(roll)}°)` : ''}: a rafter there is ${f3(min)}–${f3(max)} m long (≥ 1.5 in on each plate, a tail ≤ 12 in beyond each)`;
  if (Lh < Sh - wA / 2 - wB / 2 + 2 * FRAMING_BEARING_MIN - 1e-6) return bad('framing.rafter-short', `${label(e)} is ${f3(L)} m but ${why}`, [e.id, A.id, B.id]);
  if (Lh > Sh + wA / 2 + wB / 2 + 2 * RAFTER_TAIL_MAX + 1e-6) return bad('framing.rafter-long', `${label(e)} is ${f3(L)} m but ${why}`, [e.id, A.id, B.id]);
  const pose: Pose = { p: [(PA[0] + PB[0]) / 2, (topA + topB) / 2, (PA[1] + PB[1]) / 2], yaw: datan2(d[1], d[0]), ...(Math.abs(roll) > 1e-12 ? { roll } : {}) };
  for (const P of [A, B]) {
    const b = bearing(e, pose, topFace(P));
    if (typeof b === 'string') return bad('framing.rafter-no-bearing', `rafter ${e.id} on ${P.id}: ${b}`, [e.id, P.id]);
  }
  return { pose, supports: [A.id, B.id] };
}

/** Blocking: between two installed rafters on one plate, square to them, on the plate top. */
export function placeBlocking(w: WorldState, e: Entity, between: [string, string], on: string): Placement | Diagnostic {
  const P = w.entities[on];
  if (!P || !isRole(P, 'top-plate') || P.phase !== 'installed') return bad('framing.plate-not-installed', `blocking ${e.id} sits on an installed top plate: ${on} is ${P ? (isRole(P, 'top-plate') ? P.phase : `a ${def(P.def).label}`) : 'unknown'}`, [e.id, on]);
  const R = between.map((id) => w.entities[id]);
  for (const [i, r] of R.entries()) {
    if (!r || !isRole(r, 'rafter') || r.phase !== 'installed') return bad('framing.rafter-not-installed', `blocking ${e.id} goes between two installed rafters: ${between[i]} is ${r ? (isRole(r, 'rafter') ? r.phase : `a ${def(r.def).label}`) : 'unknown'}`, [e.id, between[i]]);
    if (!(r.connections ?? []).some((c) => c.to === on)) return bad('framing.blocking-not-on-plate', `rafter ${r.id} does not rest on plate ${on}`, [e.id, r.id, on]);
  }
  if (Math.abs(wrapAngle(2 * angleDelta(R[0].pose.yaw, R[1].pose.yaw))) > 2 * ANG) return bad('framing.blocking-skew', `rafters ${R[0].id} and ${R[1].id} are not parallel`, [e.id, R[0].id, R[1].id]);
  const pa = axisOf(P.pose), cP = xzOf(P);
  const X: Vec2[] = [];
  for (const r of R) {
    const ra = axisOf(r.pose);
    if (Math.abs(dot2(ra, pa)) > dsin(ANG) + 1e-9) return bad('framing.blocking-skew', `rafter ${r.id} is not square to plate ${P.id} (${deg(dasin(Math.min(1, Math.abs(dot2(ra, pa)))))}° off)`, [e.id, r.id, P.id]);
    // where the rafter's centre line crosses the plate's
    const den = cross2(pa, ra);
    const s = cross2(sub2(xzOf(r), cP), ra) / den;
    X.push([cP[0] + pa[0] * s, cP[1] + pa[1] * s]);
  }
  const span = dist2(X[0], X[1]);
  const t = size(R[0])[2];
  const gap = span - t;
  const L = size(e)[0];
  if (L > gap + 1e-3) return bad('framing.blocking-length', `blocking ${e.id} (${f3(L)} m) does not fit between rafters ${R[0].id} and ${R[1].id}: ${f3(gap)} m between their faces (${f3(span)} m centres)`, [e.id, ...between]);
  if (L < gap - 0.02 - 1e-6) return bad('framing.blocking-length', `blocking ${e.id} (${f3(L)} m) would leave ${f3(gap - L)} m of play between rafters ${R[0].id} and ${R[1].id} (${f3(gap)} m between their faces; max 1 cm a side)`, [e.id, ...between]);
  const c: Vec2 = [(X[0][0] + X[1][0]) / 2, (X[0][1] + X[1][1]) / 2];
  const d = sub2(X[1], X[0]);
  const pose: Pose = { p: [c[0], P.pose.p[1] + size(P)[1], c[1]], yaw: datan2(d[1], d[0]) };
  const b = bearing(e, pose, topFace(P));
  if (typeof b === 'string') return bad('framing.blocking-no-bearing', `blocking ${e.id} on ${P.id}: ${b}`, [e.id, P.id]);
  return { pose, supports: [P.id, R[0].id, R[1].id] };
}

/** Why an installed framing member is not (fully) supported (null = fine): its recorded supports, down to the frames. */
export function framingSupportProblem(w: WorldState, e: Entity, depth = 0): string | null {
  const sup = (e.connections ?? []).filter((c) => c.socket === 'bears-on');
  if (!sup.length) return `${e.id} has no recorded support`;
  for (const c of sup) {
    const s = w.entities[c.to];
    if (!s) return `a support of ${e.id} (${c.to}) no longer exists`;
    if (s.phase !== 'installed') return `${s.id} (under ${e.id}) is not installed`;
    if (isUpright(s)) { const p = frameTopProblem(w, s); if (p) return p; }
    else if (isBeam(s)) { for (const k of s.connections ?? []) { const u = w.entities[k.to]; if (isUpright(u) && !isSupported(w, u)) return `frame ${u.id} (under beam ${s.id}) is neither held nor stable`; } }
    else if (isFramingMember(s) && depth < 4) { const p = framingSupportProblem(w, s, depth + 1); if (p) return p; }
  }
  return null;
}

// ---------------------------------------------------------------- reach

const onStance = (h: Entity) => !!parseStance(h.human?.on);
/** Why a hand is beyond this person's reach standing at `feet` (null = in reach): the stance / floor limits, then the envelope. */
export function handProblem(h: Entity, feet: Vec3, hand: Vec3, tol = 0): string | null {
  const st = onStance(h);
  const up = hand[1] - feet[1], horiz = dist2([hand[0], hand[2]], [feet[0], feet[2]]);
  const upMax = st ? STANCE_UP : GIVE_MAX, downMax = st ? STANCE_DOWN : REACH_DOWN, out = st ? STANCE_ARM : BODY_MODEL.maxHorizontalFromFeet;
  if (up > upMax + 1e-6) return `a hand ${f2(up)} m above their feet (max ${upMax} m${st ? ' on a frame stance' : ''})`;
  if (-up > downMax + 1e-6) return `a hand ${f2(-up)} m below their feet (max ${downMax} m${st ? ': one hand stays on the frame' : ''})`;
  if (horiz > out + (tol ? ARM_TOL : 0) + 1e-6) return `a hand ${f2(horiz)} m out from their feet (max ${out} m)`;
  const g = reachGap(feet, hand);
  if (g > tol + 1e-9) return `a hand ${f2(g)} m beyond their reach envelope`;
  return null;
}
const where = (h: Entity) => (onStance(h) ? `on ${h.human!.on} (feet ${f2(h.pose.p[1])} m)` : `${h.human!.level ? `on the deck at level ${h.human!.level}` : 'on the ground'} (feet ${f2(h.pose.p[1])} m)`);

/** Grip points (local, on the member's underside centre line) nearest each holder's feet at pose q; two grips ≥ PAIR_MIN apart. */
function nearestGrips(e: Entity, q: Pose, feet: Vec3[]): Vec3[] {
  const L = size(e)[0], lim = L / 2 - 0.05;
  const ax = axisOf(q);
  const clamp = (x: number) => Math.max(-lim, Math.min(lim, x));
  const xs = feet.map((f) => clamp(dot2(sub2([f[0], f[2]], at2(q)), ax)));
  if (xs.length === 2) {
    const want = Math.min(PAIR_MIN, 2 * lim);
    if (Math.abs(xs[1] - xs[0]) < want) {
      const m = (xs[0] + xs[1]) / 2, s = xs[0] <= xs[1] ? 1 : -1;
      let a = m - (s * want) / 2, b = m + (s * want) / 2;
      const shift = Math.max(0, Math.max(a, b) - lim) - Math.max(0, -lim - Math.min(a, b));
      a -= shift; b -= shift;
      xs[0] = a; xs[1] = b;
    }
  }
  return xs.map((x) => [mm(x), 0, 0] as Vec3);
}

// ---------------------------------------------------------------- program

type Holder = { actor: string; grip: Vec3 };
type Seg = { phase: string; who: Role; from: Pose; to: Pose; dur: number; take?: boolean };
export type FramingProgram = {
  role: FramingRole; final: Pose; supports: string[]; segs: Seg[]; floor: number; side: number;
  crews: Record<Role, Holder[]>; fasten: string[]; pickup: { actor: string; p: Vec2; yaw: number; level: number }[]; handoffs: number[];
};
export type CrewParams = { givers: string[]; relay?: string[]; installers: string[]; fasten?: string[]; raise: { x: number; z: number } };
type Exec = { id: string; part: string; prog: FramingProgram; walk?: Children; si: number; t: number; holding: Role };

const lvl = (q: Pose): Pose => ({ p: [...q.p] as Vec3, yaw: q.yaw });
const poseAt = (c: Vec2, y: number, yaw: number, roll?: number): Pose => ({ p: [c[0], y, c[1]], yaw, ...(roll ? { roll } : {}) });
const segDur = (a: Pose, b: Pose, v: number, ext: number, min = 0.3) => Math.max(min, (hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) + ext * (Math.abs(angleDelta(a.yaw, b.yaw)) + Math.abs((b.roll ?? 0) - (a.roll ?? 0)))) / v);
function samplesOf(e: Entity, a: Pose, b: Pose): Pose[] {
  const L = size(e)[0];
  const d = hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) + (L / 2) * (Math.abs(angleDelta(a.yaw, b.yaw)) + Math.abs((b.roll ?? 0) - (a.roll ?? 0)));
  const n = Math.max(1, Math.ceil(d / STEP));
  return Array.from({ length: n + 1 }, (_, k) => lerpPose(a, b, k / n));
}
/** Where giver i stands holding the member at pose q (beside the grip, on the raise side). */
const giverFeet = (prog: Pick<FramingProgram, 'side' | 'floor'>, q: Pose, g: Vec3): Vec3 => { const s = localToWorld(lvl(q), [g[0], 0, prog.side * SIDE]); return [s[0], prog.floor, s[2]]; };

function planFraming(rt: Runtime, part: string, c: CrewParams, role: FramingRole, place: Place): { ok: true; program: FramingProgram } | Fail {
  const w = rt.world;
  const e = w.entities[part];
  const P = (code: string, message: string, subjects: string[], at?: Vec3): Fail => fail(`framing.${code}`, message, subjects, at);
  if (!e || e.kind !== 'component') return P('not-part', `no part "${part}"`, [part]);
  if (framingRole(e.def) !== role) return P('wrong-part', `${e.id} (${def(e.def).label}) is not a 2x4 ${role.replace('-', ' ')}`, [e.id]);
  if (e.phase === 'installed') return P('installed', `${e.id} is already installed`, [e.id]);
  if (!(e.phase === 'stored' || e.phase === 'staged') || (e.support?.kind !== 'ground' && e.support?.kind !== 'resting-on'))
    return P('not-staged', `${e.id} must lie on a floor (it is ${e.phase ?? 'unplaced'}, support ${e.support?.kind ?? 'none'})`, [e.id]);
  const relayIds = c.relay ?? [];
  const everyone = [...c.givers, ...relayIds, ...c.installers, ...(c.fasten ?? [])];
  const cc = crewCheck(rt, everyone, 2, 8, `setting ${label(e)}`);
  if (cc) return cc;
  const L = size(e)[0];
  const givers = c.givers.map((a) => w.entities[a]);
  const floor = givers[0].pose.p[1];
  if (givers.some((h) => h.human!.on || Math.abs(h.pose.p[1] - floor) > 0.02)) return P('crew-floor', 'the givers stand together on one floor', c.givers);
  if (Math.abs(e.pose.p[1] - floor) > 0.1) return P('not-staged', `${e.id} lies at ${f2(e.pose.p[1])} m, not on the givers' floor (${f2(floor)} m)`, [e.id]);
  for (const a of [...relayIds, ...c.installers, ...(c.fasten ?? [])]) {
    const h = w.entities[a];
    if (h.human!.on && !onStance(h)) return P('crew-position', `${a} is on ${h.human!.on}; framing crews work from a frame stance, a deck or the floor`, [a]);
    if (h.human!.activity.startsWith('climb')) return P('crew-position', `${a} is still climbing`, [a]);
  }
  // where it goes
  const pl = place(w, e);
  if ('code' in pl) return { ok: false, diagnostic: pl };
  const F = pl.pose;
  for (const [what, ids] of [['givers', c.givers], ['relay', relayIds], ['installers', c.installers]] as const)
    if (ids.length === 1 && L > ONE_HOLDER_MAX + 1e-9) return fail('crew.size', `${label(e)} is ${f3(L)} m: one person alone holds at most ${ONE_HOLDER_MAX} m (${what}: ${ids[0]}); give it two`, [e.id, ...ids]);
  const raise: Vec2 = [c.raise.x, c.raise.z];
  const final2 = at2(F);
  if (dist2(xzOf(e), raise) > STAGE + 1e-9) return P('not-staged', `${e.id} lies ${f2(dist2(xzOf(e), raise))} m from where it goes up (${f2(raise[0])}, ${f2(raise[1])}); carry it within ${STAGE} m first`, [e.id]);
  const who = (a: string) => w.entities[a];
  // installers reach it where it goes (the headline refusal: nobody up there)
  const instGrips = nearestGrips(e, F, c.installers.map((a) => who(a).pose.p));
  for (const [i, a] of c.installers.entries()) {
    const h = who(a);
    for (const hh of gripHands(e, F, instGrips[i], h.pose.p)) {
      const why = handProblem(h, h.pose.p, hh);
      if (why) return P('out-of-reach', `${a} ${where(h)} cannot reach ${label(e)} where it goes, at ${f2(F.p[1])} m (${why}); use a stance/deck`, [e.id, a], hh);
    }
  }
  // the lying pose (a box turned by π is the same box: take the heading nearest the final one)
  const L0: Pose = e.pose.roll || e.pose.pitch ? e.pose : Math.abs(angleDelta(e.pose.yaw, F.yaw)) > Math.PI / 2 ? { ...e.pose, yaw: wrapAngle(e.pose.yaw + Math.PI) } : e.pose;
  const zAx = rot2([0, 1], F.yaw);
  const side = dot2(sub2(raise, final2), zAx) < -1e-6 ? -1 : 1;
  const giverGrips: Vec3[] = c.givers.length === 1 ? [[0, 0, 0]] : [[mm(-L * 0.4), 0, 0], [mm(L * 0.4), 0, 0]];
  const Cc = localToWorld(L0, [0, size(e)[1] / 2, 0]);
  const C: Pose = { p: [Cc[0], floor + BODY_MODEL.restHand.up, Cc[2]], yaw: L0.yaw };
  const R = (y: number): Pose => poseAt(raise, y, F.yaw);
  const base = { side, floor };
  const giver: Holder[] = c.givers.map((a, i) => ({ actor: a, grip: giverGrips[i] }));
  const relayGrips = relayIds.length ? nearestGrips(e, R(floor + 1.5), relayIds.map((a) => who(a).pose.p)) : [];
  const relay: Holder[] = relayIds.map((a, i) => ({ actor: a, grip: relayGrips[i] }));
  const inst: Holder[] = c.installers.map((a, i) => ({ actor: a, grip: instGrips[i] }));
  const crewReach = (crew: Holder[], q: Pose, isGiver: boolean): { a: string; why: string; hand: Vec3 } | null => {
    for (const hdr of crew) {
      const h = who(hdr.actor);
      const feet = isGiver ? giverFeet(base, q, hdr.grip) : h.pose.p;
      for (const hh of gripHands(e, q, hdr.grip, feet)) { const why = handProblem(h, feet, hh); if (why) return { a: hdr.actor, why, hand: hh }; }
    }
    return null;
  };
  // hand-off heights: every 1 cm where both crews reach; the middle of that range
  const scan = (lo: number, hi: number, a: Holder[], aGiver: boolean, b: Holder[]): number | null => {
    const ok: number[] = [];
    for (let k = Math.floor(hi * 100); k >= Math.ceil(lo * 100); k--) { const y = k / 100; if (!crewReach(a, R(y), aGiver) && !crewReach(b, R(y), false)) ok.push(y); }
    return ok.length ? ok[Math.floor(ok.length / 2)] : null;
  };
  const feetY = (ids: Holder[]) => ids.map((x) => who(x.actor).pose.p[1]);
  const next = relay.length ? relay : inst;
  const H1 = scan(floor + 0.3, floor + GIVE_MAX, giver, true, next);
  if (H1 === null) {
    const fy = Math.max(...feetY(next));
    const mayDown = Math.max(...next.map((x) => (onStance(who(x.actor)) ? STANCE_DOWN : REACH_DOWN)));
    return P('gap', `the givers reach up to ${f2(floor + GIVE_MAX)} m at (${f2(raise[0])}, ${f2(raise[1])}) but ${next.map((x) => x.actor).join(' and ')} (feet ${f2(fy)} m) reach down only to ${f2(fy - mayDown)} m there: ${relay.length ? 'put the relay lower' : 'add a relay'}`, [e.id, ...c.givers, ...next.map((x) => x.actor)]);
  }
  const handoffs = [H1];
  if (relay.length) {
    const rf = feetY(relay), lo = Math.max(...rf) - STANCE_DOWN, hi = Math.min(...rf) + GIVE_MAX;
    const H2 = scan(lo, hi, relay, false, inst);
    if (H2 === null) {
      const iy = Math.max(...feetY(inst));
      return P('gap', `the relay (${relay.map((x) => x.actor).join(', ')}) reaches up to ${f2(hi)} m but the installers (feet ${f2(iy)} m) reach down only to ${f2(iy - STANCE_DOWN)} m at (${f2(raise[0])}, ${f2(raise[1])}): add a stance between them or raise the relay`, [e.id, ...relay.map((x) => x.actor), ...inst.map((x) => x.actor)]);
    }
    handoffs.push(H2);
  }
  const Rtop = poseAt(raise, F.p[1] + FRAMING_CLEAR, F.yaw, F.roll);
  const Sl = poseAt(final2, F.p[1] + FRAMING_CLEAR, F.yaw, F.roll);
  const ext = L / 2 + SIDE;
  const R0 = R(floor + BODY_MODEL.restHand.up);
  const segs: Seg[] = [
    { phase: 'crouch', who: 'give', from: L0, to: L0, dur: T.crouch },
    { phase: 'lift', who: 'give', from: L0, to: C, dur: T.lift },
    { phase: 'walk-load', who: 'give', from: C, to: R0, dur: segDur(C, R0, SPEED.carry, ext) },
    { phase: 'reach_up', who: 'give', from: R0, to: R(H1), dur: segDur(R0, R(H1), SPEED.raise, ext) },
  ];
  let last = R(H1);
  if (relay.length) {
    segs.push({ phase: 'take', who: 'relay', from: last, to: last, dur: T.reachDown + T.take, take: true });
    segs.push({ phase: 'reach_up', who: 'relay', from: last, to: R(handoffs[1]), dur: segDur(last, R(handoffs[1]), SPEED.raise, ext) });
    last = R(handoffs[1]);
  }
  segs.push({ phase: 'take', who: 'install', from: last, to: last, dur: T.reachDown + T.take, take: true });
  segs.push({ phase: 'reach_up', who: 'install', from: last, to: Rtop, dur: segDur(last, Rtop, SPEED.aloft, ext) });
  if (dist2(raise, final2) > 1e-6) segs.push({ phase: 'slide', who: 'install', from: Rtop, to: Sl, dur: segDur(Rtop, Sl, SPEED.slide, ext) });
  segs.push({ phase: 'set', who: 'install', from: Sl, to: F, dur: segDur(Sl, F, SPEED.set, 0) });
  const crews: Record<Role, Holder[]> = { give: giver, relay, install: inst };
  // ---- every motion sample: the holders' reach, the givers' ground, everyone's body
  const g0 = spatialOf(rt).level(givers[0].human!.level);
  const humans = relevantEntities(w).filter((h) => h.kind === 'human' && h.human)   // bodies: world/relevant.ts.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const s of segs) {
    if (s.phase === 'crouch') continue;
    // who holds during this segment (a take: both crews, the member still)
    const holders: [Role, Holder[]][] = s.take ? [[s.who === 'relay' ? 'give' : relay.length ? 'relay' : 'give', []], [s.who, crews[s.who]]] : [[s.who, crews[s.who]]];
    if (s.take) holders[0][1] = crews[holders[0][0]];
    for (const q of s.take ? [s.from] : samplesOf(e, s.from, s.to)) {
      const gFeet = new Map<string, Vec3>();
      for (const hdr of giver) gFeet.set(hdr.actor, s.phase === 'lift' ? giverFeet(base, L0, hdr.grip) : giverFeet(base, q, hdr.grip));
      for (const [r, crew] of holders) {
        for (const hdr of crew) {
          const h = who(hdr.actor);
          const feet = r === 'give' ? gFeet.get(hdr.actor)! : h.pose.p;
          for (const hh of gripHands(e, q, hdr.grip, feet)) {
            const why = handProblem(h, feet, hh);
            if (why) return P(r === 'install' ? 'out-of-reach' : `${r === 'give' ? 'giver' : 'relay'}-reach`, `${hdr.actor} ${r === 'give' ? `standing at (${f2(feet[0])}, ${f2(feet[2])})` : where(h)} cannot hold ${label(e)} at (${f2(hh[0])}, ${f2(hh[1])}, ${f2(hh[2])}) (${s.phase}${r === s.who ? '' : ', handing over'}): ${why}${r === 'install' ? '; use a stance/deck nearer it' : ''}`, [e.id, hdr.actor], hh);
          }
        }
      }
      // the givers' ground and room among people, while they hold it
      const giversHold = s.who === 'give' || (s.take && holders[0][0] === 'give');
      if (giversHold) for (const hdr of giver) {
        const f = gFeet.get(hdr.actor)!;
        if (!g0 || (clearanceAt(g0, [f[0], f[2]]) < HUMAN_PROFILE.radius - 0.03 && nearestBlocker(g0, [f[0], f[2]], HUMAN_PROFILE.radius + 0.1) !== e.id))
          return P('no-room', `${hdr.actor} has no room to stand at (${f2(f[0])}, ${f2(f[2])}) holding ${e.id} (${s.phase})`, [e.id, hdr.actor], f);
        for (const o of humans) {
          if (o.id === hdr.actor || o.human!.level !== givers[0].human!.level) continue;
          const of = gFeet.get(o.id) ?? o.pose.p;
          if (Math.abs(of[1] - f[1]) > 1.0) continue;
          if (dist2([of[0], of[2]], [f[0], f[2]]) < PEOPLE_GAP - 1e-9) return P('no-room', `${hdr.actor} holding ${e.id} at (${f2(f[0])}, ${f2(f[2])}) would stand ${f2(dist2([of[0], of[2]], [f[0], f[2]]))} m from ${o.id} (${s.phase})`, [e.id, hdr.actor, o.id], f);
        }
      }
      // the member never passes through anyone's body
      const fp = entityFootprint({ ...e, pose: q });
      for (const o of humans) {
        const feet = gFeet.get(o.id) ?? o.pose.p;
        if (fp.y1 <= feet[1] + 0.05 || fp.y0 >= feet[1] + BODY_H) continue;
        const gap = (onStance(o) ? BODY_R : HUMAN_PROFILE.radius) + 0.02;
        const d = distToObb([feet[0], feet[2]], fp.obb);
        if (d < gap - 1e-9) return P('body', `${label(e)} would pass ${f2(d)} m from ${o.id}'s body ${where(o)} (keeps ${f2(gap)} m) at (${f2(q.p[0])}, ${f2(q.p[1])}, ${f2(q.p[2])}) (${s.phase})`, [e.id, o.id], q.p);
      }
    }
  }
  // fasteners reach it where it goes
  for (const a of c.fasten ?? []) {
    const h = who(a);
    const q = nearestOn(e, F, h.pose.p);
    const why = handProblem(h, h.pose.p, q);
    if (why) return P('fasten-reach', `${a} ${where(h)} cannot fasten ${label(e)} at its place: ${why}`, [e.id, a], q);
  }
  // the swept path (the supports may be touched at the end)
  const path = [L0, C, R0, ...handoffs.map((y) => R(y)), Rtop, Sl, F];
  const hit = sweepPoses(rt, e, path, pl.supports);
  if (hit) return P('path-blocked', `${label(e)} cannot be set in place: it would hit ${hit.o.label ?? hit.o.id} at (${f2(hit.q.p[0])}, ${f2(hit.q.p[1])}, ${f2(hit.q.p[2])})`, [e.id, hit.o.id], hit.q.p);
  const pickup = giver.map((hdr) => { const f = giverFeet(base, L0, hdr.grip); const g = localToWorld(L0, hdr.grip); return { actor: hdr.actor, p: [f[0], f[2]] as Vec2, yaw: datan2(g[2] - f[2], g[0] - f[0]), level: who(hdr.actor).human!.level }; });
  const pk = checkStations(rt, pickup.map((m) => ({ actor: m.actor, p: m.p, level: m.level })));
  if (pk) return { ok: false, diagnostic: { ...pk, code: 'framing.unreachable' } };
  return { ok: true, program: { role, final: F, supports: pl.supports, segs, floor, side, crews, fasten: c.fasten ?? [], pickup, handoffs } };
}

/** Nearest point of the member's box (corners, edge midpoints, centre) to someone's feet at shoulder level. */
function nearestOn(e: Entity, q: Pose, feet: Vec3): Vec3 {
  const [L, H, W] = size(e);
  let best: Vec3 = localToWorld(q, [0, H / 2, 0]), bd = Infinity;
  for (const x of [-L / 2, -L / 4, 0, L / 4, L / 2]) for (const y of [0, H / 2, H]) for (const zz of [-W / 2, 0, W / 2]) {
    const p = localToWorld(q, [x, y, zz]);
    const d = dist2([p[0], p[2]], [feet[0], feet[2]]) + Math.abs(p[1] - feet[1] - 1.3) * 0.01;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------- execution

function approach(h: Entity, grip: [Vec3, Vec3], k: number | undefined): [Vec3, Vec3] {
  if (k === undefined || k >= 1) return grip;
  const r = restHands(h), s = smooth(k);
  const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  return [mix(r[0], grip[0]), mix(r[1], grip[1])];
}
function hold(rt: Runtime, ex: Exec, role: Role, activity: string, q: Pose, k?: number, lift?: boolean) {
  const e = rt.world.entities[ex.part];
  for (const [i, hdr] of ex.prog.crews[role].entries()) {
    const h = rt.world.entities[hdr.actor];
    if (role === 'give') { const f = giverFeet(ex.prog, lift ? ex.prog.segs[0].from : q, hdr.grip); h.pose.p = [f[0], h.pose.p[1], f[2]]; }
    const hands = gripHands(e, q, hdr.grip, h.pose.p);
    const c: Vec2 = [(hands[0][0] + hands[1][0]) / 2, (hands[0][2] + hands[1][2]) / 2];
    if (dist2(c, xzOf(h)) > 0.05) h.pose.yaw = datan2(c[1] - h.pose.p[2], c[0] - h.pose.p[0]);
    Object.assign(h.human!, { activity, task: ex.id, grip: { entity: e.id, slot: setPartSlot(SLOT_BASE[role] + i, hdr.grip) }, speed: undefined });
    setHands(h, approach(h, hands, k));
  }
}
function release(rt: Runtime, ids: string[]) {
  for (const a of ids) {
    const h = rt.world.entities[a];
    if (!h?.human) continue;
    Object.assign(h.human, { activity: onStance(h) ? 'stance' : 'idle', grip: undefined, task: undefined });
    setHands(h, undefined);
  }
}
const eased = (s: Seg) => s.phase === 'lift' || s.phase === 'set' || s.phase === 'reach_up';
const segPose = (s: Seg, k: number): Pose => (s.phase === 'crouch' || s.take ? s.from : lerpPose(s.from, s.to, eased(s) ? smooth(k) : k));
const prevRole = (prog: FramingProgram, s: Seg): Role => (s.who === 'relay' ? 'give' : prog.crews.relay.length ? 'relay' : 'give');

function stepFraming(rt: Runtime, ex: Exec, dt: number): StepResult {
  const w = rt.world;
  const e = w.entities[ex.part];
  const prog = ex.prog;
  if (!ex.walk) {
    const r = walkCrew(rt, ex.id, prog.pickup.map((m) => ({ actor: m.actor, p: m.p, yaw: m.yaw, level: m.level })));
    if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'framing.unreachable' } };
    ex.walk = r;
    for (const hdr of [...prog.crews.relay, ...prog.crews.install]) Object.assign(w.entities[hdr.actor].human!, { activity: 'wait', task: ex.id });
  }
  if (ex.si < 0) {
    const s = childrenState(ex.walk);
    if (typeof s === 'object') return { status: 'failed', diagnostic: s };
    if (s === 'running') return { status: 'running', phase: 'approach' };
    ex.si = 0;
    ex.t = 0;
    e.pose = { ...prog.segs[0].from, p: [...prog.segs[0].from.p] as Vec3 };
  }
  if (ex.si < prog.segs.length) {
    const seg = prog.segs[ex.si];
    ex.t += dt;
    const k = seg.dur > 0 ? Math.min(1, ex.t / seg.dur) : 1;
    const q = segPose(seg, k);
    if (seg.phase === 'lift' && e.phase !== 'carried') { e.phase = 'carried'; e.support = { kind: 'held', by: prog.crews.give.map((x) => x.actor) }; }
    if (seg.phase !== 'crouch') e.pose = q;
    if (seg.take) {
      const prev = prevRole(prog, seg);
      if (e.support?.kind === 'held' && e.support.by.length === prog.crews[prev].length) e.support = { kind: 'held', by: [...e.support.by, ...prog.crews[seg.who].map((x) => x.actor)] };
      hold(rt, ex, prev, 'reach_up', e.pose);
      const kr = Math.min(1, ex.t / T.reachDown);
      hold(rt, ex, seg.who, kr < 1 ? 'reach_down' : 'take', e.pose, kr);
    } else hold(rt, ex, seg.who, seg.phase, e.pose, seg.phase === 'crouch' ? k : undefined, seg.phase === 'lift' || seg.phase === 'crouch');
    if (ex.t < seg.dur - 1e-9) return { status: 'running', phase: seg.phase };
    if (seg.take) {
      const prev = prevRole(prog, seg);
      release(rt, prog.crews[prev].map((x) => x.actor));
      e.support = { kind: 'held', by: prog.crews[seg.who].map((x) => x.actor) };
      ex.holding = seg.who;
    }
    ex.si++;
    ex.t = 0;
    if (ex.si < prog.segs.length) return { status: 'running', phase: seg.phase };
    e.pose = { ...prog.final, p: [...prog.final.p] as Vec3 };
  }
  // fastening: the installers keep hold; helpers screw it where it is nearest them
  ex.t += dt;
  hold(rt, ex, 'install', 'fasten', e.pose);
  for (const a of prog.fasten) {
    const h = w.entities[a];
    const q = nearestOn(e, prog.final, h.pose.p);
    Object.assign(h.human!, { activity: 'fasten', task: ex.id, grip: { entity: e.id, slot: 'fasten' } });
    setHands(h, [q, q]);
  }
  if (ex.t < FASTEN_S - 1e-9) return { status: 'running', phase: 'fasten' };
  e.phase = 'installed';
  e.support = { kind: 'resting-on', on: prog.supports[0] };
  e.connections = prog.supports.map((s) => ({ socket: 'bears-on', to: s, toSocket: 'framing' }));
  release(rt, [...prog.crews.install.map((x) => x.actor), ...prog.fasten]);
  spatialOf(rt);
  return { status: 'completed', outputs: { part: e.id, supports: prog.supports, pose: prog.final, handoffs: prog.handoffs } };
}

// ---------------------------------------------------------------- verbs

const id = z.string().max(80);
const crewShape = {
  givers: z.array(id).min(1).max(2),
  relay: z.array(id).min(1).max(2).optional(),
  installers: z.array(id).min(1).max(2),
  fasten: z.array(id).min(1).max(2).optional(),
  raise: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4) }),
};
type TopPlateP = CrewParams & { part: string; onto: string[]; at: { x: number; z: number; yaw: number } };
type RafterP = CrewParams & { part: string; from: string; to: string; at: number; pitch?: number };
type BlockingP = CrewParams & { part: string; between: [string, string]; on: string };

function framingVerb<P extends CrewParams & { part: string }>(verb: string, role: FramingRole, schema: z.ZodType<P>, place: (p: P) => Place, description: string): ActionDef<P, FramingProgram, Exec> {
  return {
    verb,
    description,
    schema,
    reservations: (_w, p) => [...[...new Set([...p.givers, ...(p.relay ?? []), ...p.installers, ...(p.fasten ?? [])])].map((a) => ({ resource: `actor:${a}`, mode: 'exclusive' as const })), { resource: `entity:${p.part}`, mode: 'exclusive' }],
    resumable: 'a framing lift drives child walks and holds a member in the air; its exec is not serialised',
    plan: (rt, p) => planFraming(rt, p.part, p, role, place(p)),
    start: (_rt, p, prog, xid) => ({ id: xid, part: p.part, prog, si: -1, t: 0, holding: 'give' }),
    step: stepFraming,
    cancel(rt, ex) {
      const e = rt.world.entities[ex.part];
      if (e?.phase === 'carried') return { ok: false, diagnostic: { code: 'framing.cancel-unsafe', message: `${e.id} is in the crew's hands; it cannot be abandoned mid-air`, subjects: [e.id] } };
      for (const r of ex.walk?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
      const all = [...ex.prog.crews.give, ...ex.prog.crews.relay, ...ex.prog.crews.install].map((x) => x.actor);
      release(rt, [...all, ...ex.prog.fasten].filter((a) => rt.world.entities[a]?.human?.task === ex.id));
      return { ok: true };
    },
  };
}

export const installTopPlate = framingVerb<TopPlateP>('install_top_plate', 'top-plate',
  z.strictObject({ part: id, onto: z.array(id).min(1).max(4), at: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), yaw: z.number().min(-10).max(10) }), ...crewShape }) as unknown as z.ZodType<TopPlateP>,
  (p) => (w, e) => placePlate(w, e, p.onto, p.at),
  'Lay a 2x4 top plate flat on frame column tops (one frame across its columns, or along a column line across two frames) or on top rack beams, centred at `at`. Givers on the ground raise it at `raise` (outside the structure), an optional relay on the bracing takes it higher, installers on frame stances / a deck slide it over its supports, set and fasten it. Refused when a frame lacks its top beams, when it bears on < 2 points, or when nobody can reach it (framing.out-of-reach: use a stance/deck).');
export const installRafter = framingVerb<RafterP>('install_rafter', 'rafter',
  z.strictObject({ part: id, from: id, to: id, at: z.number().min(-20).max(20), pitch: z.number().min(-1.4).max(1.4).optional(), ...crewShape }) as unknown as z.ZodType<RafterP>,
  (p) => (w, e) => placeRafter(w, e, p.from, p.to, p.at, p.pitch),
  'Set a 2x4 rafter on edge from plate `from` (at `at` m along it) square across to plate `to`, its underside on both plate tops (pitch = their height difference; `pitch` in radians is checked ±1°). Both plates must be installed; the rafter must bear ≥ 1.5 in on each and overhang ≤ 12 in (names the lengths). It goes up by the givers → relay → installers hand-up at `raise` and is slid over the plates.');
export const installBlocking = framingVerb<BlockingP>('install_blocking', 'blocking',
  z.strictObject({ part: id, between: z.tuple([id, id]), on: id, ...crewShape }) as unknown as z.ZodType<BlockingP>,
  (p) => (w, e) => placeBlocking(w, e, p.between, p.on),
  'Fit a short 2x4 block on edge between two installed rafters, on the plate they both rest on (square to them; its length must fit their gap with ≤ 1 cm play a side). Same hand-up as the rafter.');
export const FRAMING_ACTIONS: ActionDef[] = [installTopPlate, installRafter, installBlocking] as unknown as ActionDef[];

// ---------------------------------------------------------------- invariants

/** Everyone holding a framing member: hands published and within their reach (stance / floor limits, envelope + 0.1 m) every tick. */
export const framingHandsInReach: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  const ents = rt.world.entities;
  for (const h of relevantEntities(rt.world)) {   // bodies only
    const g = h.human?.grip;
    if (!g || !g.slot.startsWith(SETPART_SLOT) || !isFramingMember(ents[g.entity])) continue;
    const hs = h.human!.hands;
    if (!hs?.left || !hs.right) { out.push(bad('framing.hands-missing', `${h.id} holds ${g.entity} without hand points`, [g.entity, h.id], h.pose.p)); continue; }
    for (const q of [hs.left, hs.right]) {
      const why = handProblem(h, h.pose.p, q, TOL);
      if (why) out.push(bad('framing.hands-out-of-reach', `${h.id} (${h.human!.activity}) holds ${g.entity}: ${why}`, [g.entity, h.id], q));
    }
  }
  return out;
};
/** Installed framing members keep their supports (plates on stable frames with top beams, rafters on installed plates…) at the end of every tick. */
export const framingSupported: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  for (const e of relevantEntities(rt.world)) {   // a phase only
    if (e.phase !== 'installed' || !isFramingMember(e)) continue;
    const p = framingSupportProblem(rt.world, e);
    if (p) out.push(bad('framing.unsupported', `${label(e)} is installed but unsupported: ${p}`, [e.id], e.pose.p));
  }
  return out;
};
export const FRAMING_INVARIANTS: Invariant[] = [framingHandsInReach, framingSupported];
