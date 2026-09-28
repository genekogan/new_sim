// set_part — the placement engine behind the year-build phase B verbs (owner feedback 2026-09-28 §7; W13):
// install_stringer, install_stair_part (treads, risers, posts, handrails; this file) and install_wall
// (wall.ts). Mars assembly model v1, approximate. Nothing moves without hands on it:
//
//   {part, to: pose, lift: [{actor, grip, at}], take?: [{actor, grip}], handoff?, from?, fasten: [actor]}
//
// * `lift` (1–2): people on a floor (the ground, a deck) walk to the part where it lies (staged ≤ 3 m from
//   where it goes, on their floor), crouch, lift it (hands at the local `grip` points, hands hanging), carry it
//   to its pre pose (`to` + `from`) and set it in place, their feet following the grips so they end at `at`.
// * `take` (optional, 1–2): people already standing on a deck above (kneeling at its edge) take it from the
//   lift crew `handoff` m below its place (the lift crew's overhead reach) and raise it into place.
// * `fasten`: who screws / bolts it (each within reach of the part: ≤ 0.8 m horizontally, −0.5…2.06 m
//   vertically from their feet); 2 s each, in parallel.
// Reach (plan time, every sample of the path; the invariant `kitPartHandsInReach` per tick): each hand
// within the body model's envelope (any of the crouch / reach_up / kneeling postures), standing holders'
// hands ≤ floor + 2.06 m, kneeling holders' ≥ feet − 0.5 m and ≤ 0.8 m out at the take. A held part in a
// holder's body band keeps 0.25 m from their feet. The swept path must be clear except the supports
// (notched parts may share their notch with a Kit frame, access.ts). Support rules are per role and
// PROVISIONAL (they stand in for how Mars fastens these; see YEAR_BUILD.md "Phase B material rules").
// Hands: `human.hands` every tick, `human.grip.slot` = `setpart-<i>:<lx>:<ly>:<lz>` (local grip), so
// `setPartHands()` rebuilds them from a take.
import { z } from 'zod';
import { angleDelta, dcos, dist2, dsin, datan2, obbOverlap, rot2, wrapAngle, type OBB2, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Invariant, Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose, WorldState } from '../world/types.ts';
import type { Link, Surface } from '../spatial/types.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { def } from '../world/catalog.ts';
import { entityCorners, entityFootprint } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { crewCheck, f2, fail, lerpPose, smooth, spatialOf, sweepPoses, type Fail } from './access.ts';
import { isKitUpright, isStanding, isSupported } from './rules.ts';
import { envelopeGap, GIVE_MAX, REACH_DOWN, setHands, T } from './handup.ts';
import { BODY_MODEL, restHands } from '../body/model.ts';
import { flatObb, isPlywood } from './deck.ts';
import { deckSurfaces } from './contributor.ts';
import type { Contributor } from '../spatial/service.ts';

export const SETPART_SLOT = 'setpart-';
const HAND_SPREAD = 0.15;
const BODY_CLEAR = 0.25; // a held part in a holder's body band stays this far from their feet
const FASTEN_S = 2.0;
const SPEED = { carry: 0.6, set: 0.3, raise: 0.5 } as const;
const STAGE = 7.0; // m: the part lies this close to where it goes (carried there first; walked in by its crew)
const STEP = 0.05;
const TOL = 0.1; // per-tick envelope tolerance (as hand_up's)

// ---- geometry ----
/** A local point of an entity's box (x along its length, y up from its base, z across) in world coordinates (entityCorners' transform). */
export function localToWorld(q: Pose, v: Vec3): Vec3 {
  const cr = dcos(q.roll ?? 0), sr = dsin(q.roll ?? 0), cp = dcos(q.pitch ?? 0), sp = dsin(q.pitch ?? 0), cy = dcos(q.yaw), sy = dsin(q.yaw);
  let X = v[0] * cr - v[1] * sr, Y = v[0] * sr + v[1] * cr, Z = v[2];
  const Y2 = Y * cp - Z * sp, Z2 = Y * sp + Z * cp;
  Y = Y2; Z = Z2;
  const X3 = X * cy - Z * sy, Z3 = X * sy + Z * cy;
  return [q.p[0] + X3, q.p[1] + Y, q.p[2] + Z3];
}
/** Both hands of a holder gripping local point g: ± HAND_SPREAD along the part's local x (its length), ordered left / right for them. */
export function gripHands(e: Entity, q: Pose, g: Vec3, feet: Vec3): [Vec3, Vec3] {
  const L = def(e.def).size[0];
  const a = localToWorld(q, [Math.max(-L / 2, g[0] - HAND_SPREAD), g[1], g[2]]);
  const b = localToWorld(q, [Math.min(L / 2, g[0] + HAND_SPREAD), g[1], g[2]]);
  const c: Vec2 = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];
  const f: Vec2 = [c[0] - feet[0], c[1] - feet[2]];
  const left: Vec2 = [f[1], -f[0]];
  return (a[0] - b[0]) * left[0] + (a[2] - b[2]) * left[1] >= 0 ? [a, b] : [b, a];
}
export const setPartSlot = (i: number, g: Vec3) => `${SETPART_SLOT}${i}:${g[0].toFixed(3)}:${g[1].toFixed(3)}:${g[2].toFixed(3)}`;
/** Hand points of `holder` on `part` at pose q from a set_part slot (null for other slots). */
export function setPartHands(part: Entity, q: Pose, holder: Entity, slot: string): [Vec3, Vec3] | null {
  const m = /^setpart-\d+:(-?[\d.]+):(-?[\d.]+):(-?[\d.]+)$/.exec(slot);
  return m ? gripHands(part, q, [Number(m[1]), Number(m[2]), Number(m[3])], holder.pose.p) : null;
}
/** Smallest envelope gap of a hand over the postures a holder may take (crouch, reach up, kneeling / bent over). */
export function reachGap(feet: Vec3, hand: Vec3): number {
  return Math.min(envelopeGap('crouch', feet, hand), envelopeGap('reach_up', feet, hand), envelopeGap('lay', feet, hand));
}
function samples(e: Entity, a: Pose, b: Pose): Pose[] {
  const L = def(e.def).size[0];
  const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
  const rot = Math.abs(b.yaw - a.yaw) + Math.abs((b.roll ?? 0) - (a.roll ?? 0)) + Math.abs((b.pitch ?? 0) - (a.pitch ?? 0));
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + (L / 2) * rot;
  const n = Math.max(1, Math.ceil(d / STEP));
  return Array.from({ length: n + 1 }, (_, k) => lerpPose(a, b, k / n));
}
const dur = (a: Pose, b: Pose, v: number, min = 0.3) => {
  const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
  return Math.max(min, Math.sqrt(dx * dx + dy * dy + dz * dz) / v);
};
const shift = (q: Pose, d: Vec3): Pose => ({ ...q, p: [q.p[0] + d[0], q.p[1] + d[1], q.p[2] + d[2]] });

// ---- support rules (per role) ----
export type Support = { kind: 'connected' | 'resting-on'; supports: string[]; sockets?: string[] };
export type SupportRule = (w: WorldState, e: Entity, to: Pose, p?: SP, feetOf?: (actor: string) => Vec3) => Support | Diagnostic;
const bad = (code: string, message: string, subjects: string[]): Diagnostic => ({ code, message, subjects });
const installed = (w: WorldState, pred: (e: Entity) => boolean) => Object.values(w.entities).filter((x) => x.phase === 'installed' && pred(x)).sort((a, b) => (a.id < b.id ? -1 : 1));
const worldBox = (e: Entity, q: Pose) => { const cs = entityCorners({ ...e, pose: q }); return { lo: [0, 1, 2].map((k) => Math.min(...cs.map((c) => c[k]))), hi: [0, 1, 2].map((k) => Math.max(...cs.map((c) => c[k]))) }; };

/** Stringer: its lowest corner on the ground (within 3 cm), its top end against a standing, supported reconstruction frame (≤ 3 cm). */
export const stringerRule: SupportRule = (w, e, to) => {
  const cs = entityCorners({ ...e, pose: to });
  const low = Math.min(...cs.map((c) => c[1]));
  if (low > 0.03 || low < -0.03) return bad('stair.stringer-foot', `stringer ${e.id}'s foot would be ${f2(low)} m above the ground (it stands on it)`, [e.id]);
  const f = entityFootprint({ ...e, pose: to });
  const frames = installed(w, (x) => isKitUpright(x) && isStanding(x)).filter((u) => obbOverlap(f.obb, entityFootprint(u).obb, 0.03));
  if (!frames.length) return bad('stair.no-top-support', `stringer ${e.id}'s top end has no standing reconstruction frame within 3 cm to be bolted to`, [e.id]);
  const u = frames[0];
  if (!isSupported(w, u)) return bad('stair.top-unsupported', `frame ${u.id} (the stringer's top support) is neither held nor stable`, [e.id, u.id]);
  return { kind: 'connected', supports: [u.id] };
};
const STRINGER = (x: Entity) => x.def === 'stair-stringer-kit8';
const TREAD = (x: Entity) => x.def.startsWith('stair-tread-board-kit');
/** Tread board: bears on ≥ 2 installed, supported stringers under it (its underside above their top edge, on cleats / notches: implied). */
export const treadRule: SupportRule = (w, e, to) => {
  const o = flatObb(to, e);
  const under = installed(w, STRINGER).filter((s) => obbOverlap(o, entityFootprint(s).obb, -0.005) && worldBox(s, s.pose).lo[1] < to.p[1]);
  if (under.length < 2) return bad('stair.tread-unsupported', `tread board ${e.id} would bear on ${under.length} installed stringer(s); it needs two`, [e.id, ...under.map((s) => s.id)]);
  for (const s of under) { const p = supportOf(w, s); if (p) return bad('stair.tread-unsupported', `tread board ${e.id}: ${p}`, [e.id, s.id]); }
  return { kind: 'resting-on', supports: under.map((s) => s.id) };
};
/** Riser: stands on an installed tread board (its bottom on the board's top, overlapping it). */
export const riserRule: SupportRule = (w, e, to) => {
  const f = entityFootprint({ ...e, pose: to }).obb;
  const on = installed(w, TREAD).filter((t) => Math.abs(t.pose.p[1] + def(t.def).size[1] - to.p[1]) < 0.01 && obbOverlap(f, flatObb(t.pose, t), -0.001));
  if (!on.length) return bad('stair.riser-unsupported', `riser ${e.id} would stand on no installed tread board`, [e.id]);
  return { kind: 'resting-on', supports: [on[0].id] };
};
/** Post: bolted to the end of an installed tread board (its inner face ≤ 1 cm from the board's end, overlapping it in height and along the stair). */
export const postRule: SupportRule = (w, e, to) => {
  const pb = worldBox(e, to);
  const hit = installed(w, TREAD).filter((t) => {
    const tb = worldBox(t, t.pose);
    const gapX = Math.max(tb.lo[0] - pb.hi[0], pb.lo[0] - tb.hi[0]);
    const gapZ = Math.max(tb.lo[2] - pb.hi[2], pb.lo[2] - tb.hi[2]);
    return Math.max(gapX, gapZ) <= 0.01 && Math.min(gapX, gapZ) < -0.01 && tb.lo[1] < pb.hi[1] && tb.hi[1] > pb.lo[1];
  });
  if (!hit.length) return bad('stair.post-unsupported', `post ${e.id} would touch no installed tread board end to be bolted to`, [e.id]);
  return { kind: 'connected', supports: [hit[0].id] };
};
/** Handrail: its underside on ≥ 2 installed posts' tops (≤ 5 cm). */
export const handrailRule: SupportRule = (w, e, to) => {
  const f = entityFootprint({ ...e, pose: to }).obb;
  const L = def(e.def).size[0];
  const posts = installed(w, (x) => x.def === 'stair-post-kit').filter((p) => {
    if (!obbOverlap(f, entityFootprint(p).obb, 0.01)) return false;
    const top = worldBox(p, p.pose).hi[1];
    // the rail's underside above the post: along its length at the post's position
    const pc: Vec2 = [p.pose.p[0], p.pose.p[2]];
    const ax = rot2([1, 0], to.yaw);
    const s = (pc[0] - to.p[0]) * ax[0] + (pc[1] - to.p[2]) * ax[1];
    const c = dcos(to.roll ?? 0), sn = dsin(to.roll ?? 0);
    const t = s / (c || 1);
    if (Math.abs(t) > L / 2) return false;
    const under = to.p[1] + t * sn;
    return Math.abs(under - top) <= 0.05;
  });
  if (posts.length < 2) return bad('stair.handrail-unsupported', `handrail ${e.id} would rest on ${posts.length} installed post(s); it needs two`, [e.id, ...posts.map((p) => p.id)]);
  return { kind: 'resting-on', supports: posts.map((p) => p.id) };
};
/** Why an installed stair part is not (fully) supported ([] = fine), for the invariant and the stair link. */
export function supportOf(w: WorldState, e: Entity): string | null {
  const sup = (e.connections ?? []).filter((c) => c.socket === 'bears-on').map((c) => w.entities[c.to]);
  if (!sup.length) return `${e.id} has no recorded support`;
  for (const s of sup) {
    if (!s) return `a support of ${e.id} no longer exists`;
    if (s.phase !== 'installed') return `${s.id} (under ${e.id}) is not installed`;
    if (isKitUpright(s) && !isSupported(w, s)) return `frame ${s.id} (under ${e.id}) is neither held nor stable`;
  }
  return null;
}

// ---- plan ----
export type SP = {
  part: string;
  to: { x: number; y: number; z: number; yaw: number; roll?: number; pitch?: number };
  /** `at`: where they stand once it is in place (world; their feet keep that offset from the grip while carrying),
   *  or `stand`: a point in the part's own frame (grip + offset) whose ground projection they stand on (it turns with the part). */
  lift: { actor: string; grip: [number, number, number]; at?: { x: number; z: number }; stand?: [number, number, number] }[];
  take?: { actor: string; grip: [number, number, number] }[];
  handoff?: number;
  from?: { x: number; y: number; z: number };
  fasten: string[];
};
type Seg = { phase: string; who: 'lift' | 'take'; from: Pose; to: Pose; dur: number; follow: boolean };
export type SetProgram = { final: Pose; support: Support; segs: Seg[]; pickup: { actor: string; p: Vec2; yaw: number; level: number }[]; delta: Vec2[]; fasten: string[]; floor: number };

export function planSetPart(rt: Runtime, p: SP, rule: SupportRule, what: string, prefix: string): { ok: true; program: SetProgram } | Fail {
  const w = rt.world;
  const e = w.entities[p.part];
  if (!e || e.kind !== 'component' || !def(e.def).handling) return fail(`${prefix}.not-part`, `${p.part} is not a part that can be set in place`, [p.part]);
  if (e.phase === 'installed') return fail(`${prefix}.installed`, `${e.id} is already installed`, [e.id]);
  if (!(e.phase === 'stored' || e.phase === 'staged') || (e.support?.kind !== 'ground' && e.support?.kind !== 'resting-on'))
    return fail(`${prefix}.not-staged`, `${e.id} must lie staged on a floor (it is ${e.phase ?? 'unplaced'}, support ${e.support?.kind ?? 'none'})`, [e.id]);
  const take = p.take ?? [];
  const everyone = [...new Set([...p.lift.map((l) => l.actor), ...take.map((t) => t.actor), ...p.fasten])];
  const cc = crewCheck(rt, everyone, 1, 6, `setting ${what} ${e.id}`);
  if (cc) return cc;
  const hd = def(e.def).handling!;
  if (p.lift.length < Math.min(2, hd.carryCrew[0]) || p.lift.length > 2) return fail('crew.size', `${def(e.def).label} ${e.id} is lifted by ${hd.carryCrew[0]}–2 people; ${p.lift.length} assigned`, p.lift.map((l) => l.actor));
  if (take.length && !p.handoff) return fail(`${prefix}.handoff`, 'a take crew needs a hand-off height (`handoff` m below the place)', take.map((t) => t.actor));
  const final: Pose = { p: [p.to.x, p.to.y, p.to.z], yaw: p.to.yaw, ...(p.to.roll !== undefined ? { roll: p.to.roll } : {}), ...(p.to.pitch !== undefined ? { pitch: p.to.pitch } : {}) };
  const lifters = p.lift.map((l) => w.entities[l.actor]);
  const floor = lifters[0].pose.p[1];
  // where each crew member stands once it is in place (the lift crew at their stations, everyone else where they are)
  const standAt = (l: SP['lift'][number], q: Pose, delta?: Vec2): Vec3 => {
    if (l.stand) { const s = localToWorld(q, [l.grip[0] + l.stand[0], l.grip[1] + l.stand[1], l.grip[2] + l.stand[2]]); return [s[0], floor, s[2]]; }
    const g = localToWorld(q, l.grip);
    return [g[0] + (delta?.[0] ?? 0), floor, g[2] + (delta?.[1] ?? 0)];
  };
  for (const l of p.lift) if (!l.at && !l.stand) return fail(`${prefix}.station`, `${l.actor} needs \`at\` or \`stand\``, [l.actor]);
  const feetOf = (a: string): Vec3 => { const l = p.lift.find((x) => x.actor === a); const h = w.entities[a]; return l ? (l.stand ? standAt(l, final) : [l.at!.x, floor, l.at!.z]) : [...h.pose.p] as Vec3; };
  const sup = rule(w, e, final, p, feetOf);
  if ('code' in sup) return { ok: false, diagnostic: sup };
  if (lifters.some((h) => h.human!.on || Math.abs(h.pose.p[1] - floor) > 0.02)) return fail(`${prefix}.crew-floor`, 'the lift crew stands together on one floor', p.lift.map((l) => l.actor));
  if (Math.abs(e.pose.p[1] - floor) > 0.1) return fail(`${prefix}.not-staged`, `${e.id} lies at ${f2(e.pose.p[1])} m, not on the lift crew's floor (${f2(floor)} m)`, [e.id]);
  // poses: lying L, carried C (grips at hands-hanging height), pre P (= final + from), hand-off H (= final − handoff), final F
  // a lying board / sheet is the same box turned by π: take the heading nearest where it goes (no half turn in the air)
  // (on its face, pitch ±π/2 about the base-centre origin: (yaw + π, −pitch) is the same box)
  const flatOrFace = !e.pose.roll && (!e.pose.pitch || Math.abs(Math.abs(e.pose.pitch) - Math.PI / 2) < 1e-6);
  const L0: Pose = flatOrFace && Math.abs(angleDelta(e.pose.yaw, final.yaw)) > Math.PI / 2 ? { ...e.pose, yaw: wrapAngle(e.pose.yaw + Math.PI), ...(e.pose.pitch ? { pitch: -e.pose.pitch } : {}) } : e.pose;
  // lifted: turned level in its own heading (off its face / edge, as the carry laid it) about its centre line, the
  // lowest grip at hands-hanging height
  const H0 = def(e.def).size[1];
  const cl = localToWorld(L0, [0, H0 / 2, 0]);
  const lowLocal = Math.min(...p.lift.map((l) => l.grip[1]));
  const C: Pose = { p: [cl[0], floor + BODY_MODEL.restHand.up - lowLocal, cl[2]], yaw: L0.yaw, pitch: 0, roll: 0 };
  const from = p.from ?? { x: 0, y: 0, z: 0 };
  const P = shift(final, [from.x, from.y, from.z]);
  const H = take.length ? shift(final, [0, -p.handoff!, 0]) : null;
  if (dist2([C.p[0], C.p[2]], [P.p[0], P.p[2]]) > STAGE + 1e-9 && dist2([L0.p[0], L0.p[2]], [final.p[0], final.p[2]]) > STAGE + 1e-9)
    return fail(`${prefix}.not-staged`, `${e.id} lies ${f2(dist2([L0.p[0], L0.p[2]], [final.p[0], final.p[2]]))} m from where it goes (carry it within ${STAGE} m first)`, [e.id]);
  // lift crew feet follow their grips: delta = station − grip (horizontal) at the place (at H with a take crew, else F)
  const place = H ?? final;
  const delta: Vec2[] = p.lift.map((l) => { if (!l.at) return [0, 0]; const g = localToWorld(place, l.grip); return [l.at.x - g[0], l.at.z - g[2]]; });
  const feetAt = (i: number, q: Pose): Vec3 => standAt(p.lift[i], q, delta[i]);
  // a sheet that stands (a wall panel): tipped up where it was lifted, then walked in upright
  const standing = Math.abs(Math.abs(final.roll ?? 0) - Math.PI / 2) < 0.05 || Math.abs(Math.abs(final.pitch ?? 0) - Math.PI / 2) < 0.05;
  const Up: Pose | null = standing ? { ...P, p: [C.p[0] + (P.p[0] - final.p[0]) * 0, C.p[1], C.p[2]] } : null;
  if (Up) {
    // same heading / tilt as P, its lowest grip at hands-hanging height, over where it was lifted
    const g = Math.min(...p.lift.map((l) => localToWorld({ ...P, p: [0, 0, 0] }, l.grip)[1]));
    Up.p = [C.p[0], floor + BODY_MODEL.restHand.up + 0.3 - g, C.p[2]];
  }
  const segs: Seg[] = [
    { phase: 'crouch', who: 'lift', from: L0, to: L0, dur: T.crouch, follow: false },
    { phase: 'lift', who: 'lift', from: L0, to: C, dur: T.lift, follow: false },
    ...(Up ? [{ phase: 'tip', who: 'lift' as const, from: C, to: Up, dur: 2.0, follow: true }] : []),
    { phase: 'walk-load', who: 'lift', from: Up ?? C, to: P, dur: dur(Up ?? C, P, SPEED.carry), follow: true },
  ];
  if (H) {
    segs.push({ phase: 'reach_up', who: 'lift', from: P, to: H, dur: dur(P, H, SPEED.raise), follow: true });
    segs.push({ phase: 'reach_down', who: 'take', from: H, to: H, dur: T.reachDown, follow: false });
    segs.push({ phase: 'take', who: 'take', from: H, to: H, dur: T.take, follow: false });
    segs.push({ phase: 'set', who: 'take', from: H, to: final, dur: dur(H, final, SPEED.raise), follow: false });
  } else segs.push({ phase: 'set', who: 'lift', from: P, to: final, dur: dur(P, final, SPEED.set), follow: true });
  // ---- reach, room and body clearance along the path
  const g0 = spatialOf(rt).level(lifters[0].human!.level);
  const th = def(e.def).size;
  for (const s of segs.slice(1)) {
    if (s.phase === 'reach_down' || s.phase === 'take') continue;
    for (const q of samples(e, s.from, s.to)) {
      if (s.who === 'lift') {
        for (const [i, l] of p.lift.entries()) {
          const f = s.follow ? feetAt(i, q) : [lifters[i].pose.p[0], floor, lifters[i].pose.p[2]] as Vec3;
          if (s.phase === 'lift') { const f0 = feetAt(i, L0); f[0] = f0[0]; f[2] = f0[2]; }
          // room to stand (the part's own lying spot does not count: it is in their hands by then)
          if (s.follow && (!g0 || (clearanceAt(g0, [f[0], f[2]]) < HUMAN_PROFILE.radius - 0.03 && nearestBlocker(g0, [f[0], f[2]], HUMAN_PROFILE.radius + 0.1) !== e.id)))
            return fail(`${prefix}.no-room`, `${l.actor} has no room to stand at (${f2(f[0])}, ${f2(f[2])}) holding ${e.id} (${s.phase})`, [e.id, l.actor], f);
          for (const hh of gripHands(e, q, l.grip, f)) {
            const gap = reachGap(f, hh);
            if (gap > 1e-9) return fail(`${prefix}.out-of-reach`, `${l.actor} standing at (${f2(f[0])}, ${f2(f[2])}) cannot hold ${e.id} at (${f2(hh[0])}, ${f2(hh[1])}, ${f2(hh[2])}) (${s.phase}): a hand ${f2(gap)} m beyond reach`, [e.id, l.actor], hh);
            if (hh[1] - floor > GIVE_MAX + 1e-9) return fail(`${prefix}.too-high`, `${l.actor} would hold ${e.id} ${f2(hh[1] - floor)} m above their floor (standing reach ${GIVE_MAX} m)${take.length ? '' : '; hand it to people on the deck above (take)'}`, [e.id, l.actor], hh);
          }
        }
      } else {
        for (const t of take) {
          const h = w.entities[t.actor];
          for (const hh of gripHands(e, q, t.grip, h.pose.p)) {
            const gap = reachGap(h.pose.p, hh);
            if (gap > 1e-9) return fail(`${prefix}.out-of-reach`, `${t.actor} cannot set ${e.id} from where they kneel (${f2(h.pose.p[0])}, ${f2(h.pose.p[1])}, ${f2(h.pose.p[2])}): a hand ${f2(gap)} m beyond reach`, [e.id, t.actor], hh);
          }
        }
      }
    }
  }
  if (H) for (const t of take) {
    const h = w.entities[t.actor];
    for (const hh of gripHands(e, H, t.grip, h.pose.p)) {
      if (h.pose.p[1] - hh[1] > REACH_DOWN + 1e-9) return fail(`${prefix}.too-high`, `${t.actor} would reach ${f2(h.pose.p[1] - hh[1])} m below their feet for ${e.id} at the hand-off (max ${REACH_DOWN} m)`, [e.id, t.actor], hh);
      if (dist2([hh[0], hh[2]], [h.pose.p[0], h.pose.p[2]]) > BODY_MODEL.maxHorizontalFromFeet + 1e-9) return fail(`${prefix}.out-of-reach`, `${t.actor}'s hands would be ${f2(dist2([hh[0], hh[2]], [h.pose.p[0], h.pose.p[2]]))} m out at the hand-off (kneeling: max ${BODY_MODEL.maxHorizontalFromFeet} m)`, [e.id, t.actor], hh);
      if (gripHands(e, H, t.grip, h.pose.p).length && reachGap(h.pose.p, hh) > 1e-9) return fail(`${prefix}.out-of-reach`, `${t.actor} cannot reach ${e.id} at the hand-off`, [e.id, t.actor], hh);
    }
  }
  // body band clearance for the lift crew (the part never passes through them)
  for (const s of segs.filter((x) => x.who === 'lift' && x.follow))
    for (const q of samples(e, s.from, s.to)) {
      const b = worldBox(e, q);
      if (b.hi[1] < floor + 0.3 || b.lo[1] > floor + HUMAN_PROFILE.height) continue;
      const fp = entityFootprint({ ...e, pose: q }).obb;
      for (const [i, l] of p.lift.entries()) {
        const f = feetAt(i, q);
        const lp = rot2([f[0] - fp.c[0], f[2] - fp.c[1]], -fp.yaw);
        const dx = Math.max(0, Math.abs(lp[0]) - fp.half[0]), dz = Math.max(0, Math.abs(lp[1]) - fp.half[1]);
        if (Math.sqrt(dx * dx + dz * dz) < BODY_CLEAR - 1e-9) return fail(`${prefix}.body`, `${e.id} would pass through ${l.actor} at (${f2(f[0])}, ${f2(f[2])}) (${s.phase})`, [e.id, l.actor], f);
      }
    }
  // fasteners reach the part at its place
  for (const a of p.fasten) {
    const h = w.entities[a];
    const lift = p.lift.findIndex((l) => l.actor === a);
    const feet: Vec3 = lift >= 0 ? feetAt(lift, final) : h.pose.p;
    const q = nearestPoint(e, final, feet);
    const dh = dist2([q[0], q[2]], [feet[0], feet[2]]), up = q[1] - feet[1];
    if (dh > BODY_MODEL.maxHorizontalFromFeet + 1e-9 || up > GIVE_MAX + 1e-9 || up < -REACH_DOWN - 1e-9)
      return fail(`${prefix}.fasten-reach`, `${a} cannot fasten ${e.id} from (${f2(feet[0])}, ${f2(feet[1])}, ${f2(feet[2])}): its nearest point is ${f2(dh)} m away and ${f2(up)} m above their feet (≤ ${BODY_MODEL.maxHorizontalFromFeet} m, −${REACH_DOWN}…${GIVE_MAX} m)`, [e.id, a], q);
  }
  // nobody else stands where it goes (in its body band)
  {
    const f = entityFootprint({ ...e, pose: final });
    const everyone = new Set(everyoneIds(p));
    for (const h of Object.values(w.entities).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (h.kind !== 'human' || everyone.has(h.id) || h.human?.on) continue;
      if (f.y1 <= h.pose.p[1] + 0.22 || f.y0 >= h.pose.p[1] + HUMAN_PROFILE.height) continue;
      const lp = rot2([h.pose.p[0] - f.obb.c[0], h.pose.p[2] - f.obb.c[1]], -f.obb.yaw);
      const dx = Math.max(0, Math.abs(lp[0]) - f.obb.half[0]), dz = Math.max(0, Math.abs(lp[1]) - f.obb.half[1]);
      if (Math.sqrt(dx * dx + dz * dz) < HUMAN_PROFILE.radius) return fail(`${prefix}.site-occupied`, `${h.id} stands where ${e.id} goes (at (${f2(h.pose.p[0])}, ${f2(h.pose.p[2])}))`, [e.id, h.id], h.pose.p);
    }
  }
  // ---- swept path (supports may be touched at the end; the part's own lying spot is skipped)
  const path = [C, ...(Up ? [Up] : []), P, ...(H ? [H] : []), final];
  const ignore = [...sup.supports];
  const hit = sweepPoses(rt, e, path, ignore);
  if (hit) return fail(`${prefix}.path-blocked`, `${e.id} cannot be ${what === 'wall panel' ? 'stood' : 'set'} in place: it would hit ${hit.o.label ?? hit.o.id} at (${f2(hit.q.p[0])}, ${f2(hit.q.p[1])}, ${f2(hit.q.p[2])})`, [e.id, hit.o.id], hit.q.p);
  const pickup = p.lift.map((l, i) => { const f = feetAt(i, L0); const g = localToWorld(L0, l.grip); return { actor: l.actor, p: [f[0], f[2]] as Vec2, yaw: datan2(g[2] - f[2], g[0] - f[0]), level: lifters[i].human!.level }; });
  const pk = checkStations(rt, pickup.map((m) => ({ actor: m.actor, p: m.p, level: m.level })));
  if (pk) return { ok: false, diagnostic: { ...pk, code: `${prefix}.unreachable` } };
  void th;
  return { ok: true, program: { final, support: sup, segs, pickup, delta, fasten: p.fasten, floor } };
}

const everyoneIds = (p: SP) => [...p.lift.map((l) => l.actor), ...(p.take ?? []).map((t) => t.actor), ...p.fasten];

/** Nearest point of the part's box surface (sampled on its corners / edge midpoints / centre) to a person's feet. */
function nearestPoint(e: Entity, q: Pose, feet: Vec3): Vec3 {
  const [L, H, W] = def(e.def).size;
  let best: Vec3 = localToWorld(q, [0, H / 2, 0]), bd = Infinity;
  for (const x of [-L / 2, -L / 4, 0, L / 4, L / 2]) for (const y of [0, H / 2, H]) for (const zz of [-W / 2, 0, W / 2]) {
    const p = localToWorld(q, [x, y, zz]);
    const d = dist2([p[0], p[2]], [feet[0], feet[2]]) + Math.abs(p[1] - feet[1] - 1.0) * 0.01;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ---- execution ----
type Exec = { id: string; p: SP; prog: SetProgram; walk?: Children; si: number; t: number; holders: 'lift' | 'take'; fastened: number };

function approachHands(h: Entity, grip: [Vec3, Vec3], k: number | undefined): [Vec3, Vec3] {
  if (k === undefined || k >= 1) return grip;
  const r = restHands(h), s = smooth(k);
  const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  return [mix(r[0], grip[0]), mix(r[1], grip[1])];
}
function hold(rt: Runtime, ex: Exec, who: 'lift' | 'take', activity: string, q: Pose, move: boolean, k?: number) {
  const e = rt.world.entities[ex.p.part];
  const list = who === 'lift' ? ex.p.lift : ex.p.take ?? [];
  for (const [i, l] of list.entries()) {
    const h = rt.world.entities[l.actor];
    if (move && who === 'lift') {
      const ll = l as SP['lift'][number];
      if (ll.stand) { const s = localToWorld(q, [ll.grip[0] + ll.stand[0], ll.grip[1] + ll.stand[1], ll.grip[2] + ll.stand[2]]); h.pose.p = [s[0], h.pose.p[1], s[2]]; }
      else { const g = localToWorld(q, l.grip); h.pose.p = [g[0] + ex.prog.delta[i][0], h.pose.p[1], g[2] + ex.prog.delta[i][1]]; }
    }
    const slot = setPartSlot(who === 'lift' ? i : 10 + i, l.grip);
    const hands = gripHands(e, q, l.grip, h.pose.p);
    const c: Vec2 = [(hands[0][0] + hands[1][0]) / 2, (hands[0][2] + hands[1][2]) / 2];
    if (dist2(c, [h.pose.p[0], h.pose.p[2]]) > 0.05) h.pose.yaw = datan2(c[1] - h.pose.p[2], c[0] - h.pose.p[0]);
    Object.assign(h.human!, { activity, task: ex.id, grip: { entity: e.id, slot } });
    setHands(h, approachHands(h, hands, k));
  }
}
function release(rt: Runtime, ids: string[]) {
  for (const a of ids) {
    const h = rt.world.entities[a];
    if (!h?.human) continue;
    Object.assign(h.human, { activity: 'idle', grip: undefined, task: undefined });
    setHands(h, undefined);
  }
}
const ease = (s: Seg) => s.phase === 'lift' || s.phase === 'set' || s.phase === 'reach_up';

export function stepSetPart(rt: Runtime, ex: Exec, dt: number): StepResult {
  const w = rt.world;
  const e = w.entities[ex.p.part];
  const prog = ex.prog;
  if (!ex.walk) {
    const r = walkCrew(rt, ex.id, prog.pickup.map((m) => ({ actor: m.actor, p: m.p, yaw: m.yaw, level: m.level })));
    if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'setpart.unreachable' } };
    ex.walk = r;
    for (const t of ex.p.take ?? []) Object.assign(w.entities[t.actor].human!, { activity: 'wait', task: ex.id });
  }
  if (ex.si < 0) {
    const s = childrenState(ex.walk);
    if (typeof s === 'object') return { status: 'failed', diagnostic: s };
    if (s === 'running') return { status: 'running', phase: 'approach' };
    ex.si = 0;
    ex.t = 0;
    e.pose = { ...prog.segs[0].from, p: [...prog.segs[0].from.p] as Vec3 }; // the same box, described as the plan does
  }
  if (ex.si < prog.segs.length) {
    const seg = prog.segs[ex.si];
    ex.t += dt;
    const k = seg.dur > 0 ? Math.min(1, ex.t / seg.dur) : 1;
    const q = seg.phase === 'crouch' || seg.phase === 'reach_down' || seg.phase === 'take' ? seg.from : lerpPose(seg.from, seg.to, ease(seg) ? smooth(k) : k);
    if (seg.phase === 'lift' && e.phase !== 'carried') {
      e.phase = 'carried';
      e.support = { kind: 'held', by: ex.p.lift.map((l) => l.actor) };
    }
    if (seg.phase !== 'crouch') e.pose = q;
    if (seg.who === 'take') {
      if (ex.holders === 'lift') hold(rt, ex, 'lift', 'reach_up', e.pose, false);
      if (seg.phase === 'reach_down' && e.support?.kind === 'held' && !e.support.by.includes(ex.p.take![0].actor))
        e.support = { kind: 'held', by: [...e.support.by, ...ex.p.take!.map((t) => t.actor)] };
      hold(rt, ex, 'take', seg.phase, e.pose, false, seg.phase === 'reach_down' ? k : undefined);
    } else hold(rt, ex, 'lift', seg.phase, e.pose, seg.follow, seg.phase === 'crouch' ? k : undefined);
    if (ex.t < seg.dur - 1e-9) return { status: 'running', phase: seg.phase };
    if (seg.phase === 'take') {
      release(rt, ex.p.lift.map((l) => l.actor));
      ex.holders = 'take';
      e.support = { kind: 'held', by: ex.p.take!.map((t) => t.actor) };
    }
    ex.si++;
    ex.t = 0;
    if (ex.si < prog.segs.length) return { status: 'running', phase: seg.phase };
    e.pose = { ...prog.final, p: [...prog.final.p] as Vec3 };
  }
  // fastening (the holders keep hold until it is fastened; whoever screws it holds it too)
  ex.t += dt;
  if (e.support?.kind === 'held') { const by = [...new Set([...e.support.by, ...prog.fasten])].sort(); if (by.length !== e.support.by.length) e.support = { kind: 'held', by }; }
  for (const a of prog.fasten) {
    const h = w.entities[a];
    const q = nearestPoint(e, prog.final, h.pose.p);
    Object.assign(h.human!, { activity: 'fasten', task: ex.id, grip: h.human!.grip?.entity === e.id ? h.human!.grip : { entity: e.id, slot: 'fasten' } });
    if (!h.human!.grip?.slot.startsWith(SETPART_SLOT)) setHands(h, [q, q]);
  }
  if (ex.t < FASTEN_S - 1e-9) return { status: 'running', phase: 'fasten' };
  e.phase = 'installed';
  e.support = prog.support.kind === 'connected' ? { kind: 'connected', to: prog.support.supports } : { kind: 'resting-on', on: prog.support.supports[0] };
  e.connections = prog.support.supports.map((s, i) => ({ socket: 'bears-on', to: s, toSocket: prog.support.sockets?.[i] ?? 'part' }));
  release(rt, [...new Set([...ex.p.lift.map((l) => l.actor), ...(ex.p.take ?? []).map((t) => t.actor), ...prog.fasten])]);
  spatialOf(rt);
  return { status: 'completed', outputs: { part: e.id, supports: prog.support.supports } };
}

const vec3 = z.tuple([z.number().min(-20).max(20), z.number().min(-20).max(20), z.number().min(-20).max(20)]);
export const setPartSchema = z.strictObject({
  part: z.string().max(80),
  to: z.strictObject({ x: z.number().min(-1e4).max(1e4), y: z.number().min(-10).max(50), z: z.number().min(-1e4).max(1e4), yaw: z.number().min(-10).max(10), roll: z.number().min(-4).max(4).optional(), pitch: z.number().min(-4).max(4).optional() }),
  lift: z.array(z.strictObject({ actor: z.string().max(80), grip: vec3, at: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4) }).optional(), stand: vec3.optional() })).min(1).max(2),
  take: z.array(z.strictObject({ actor: z.string().max(80), grip: vec3 })).min(1).max(2).optional(),
  handoff: z.number().min(0.01).max(3).optional(),
  from: z.strictObject({ x: z.number().min(-10).max(10), y: z.number().min(-10).max(10), z: z.number().min(-10).max(10) }).optional(),
  fasten: z.array(z.string().max(80)).min(1).max(3),
});

/** A set_part verb for one family of parts with its support rule. */
export function setPartVerb(verb: string, what: string, rule: SupportRule, accepts: (defId: string) => boolean, description: string): ActionDef<SP, SetProgram, Exec> {
  const prefix = verb.replace(/^install_/, '').replace(/_/g, '-');
  return {
    verb,
    description,
    schema: setPartSchema,
    reservations: (_w, p) => [...[...new Set([...p.lift.map((l) => l.actor), ...(p.take ?? []).map((t) => t.actor), ...p.fasten])].map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.part}`, mode: 'exclusive' }],
    resumable: 'set_part drives child walks and holds a part in the air; its exec is not serialised',
    plan(rt, p) {
      const e = rt.world.entities[p.part];
      if (e && !accepts(e.def)) return fail(`${prefix}.wrong-part`, `${e.id} (${def(e.def).label}) is not a ${what}`, [e.id]);
      return planSetPart(rt, p, rule, what, prefix);
    },
    start: (_rt, p, prog, id) => ({ id, p, prog, si: -1, t: 0, holders: 'lift', fastened: 0 }),
    step: stepSetPart,
    cancel(rt, ex) {
      const e = rt.world.entities[ex.p.part];
      if (e?.phase === 'carried') return { ok: false, diagnostic: { code: `${prefix}.cancel-unsafe`, message: `${e.id} is in the crew's hands; it cannot be abandoned mid-air`, subjects: [e.id] } };
      for (const r of ex.walk?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
      release(rt, [...ex.p.lift.map((l) => l.actor), ...(ex.p.take ?? []).map((t) => t.actor), ...ex.p.fasten].filter((a) => rt.world.entities[a]?.human?.task === ex.id));
      return { ok: true };
    },
  };
}

export const installStringer = setPartVerb('install_stringer', 'stair stringer', stringerRule, (d) => d === 'stair-stringer-kit8',
  'Set a 2x12 stair stringer: its foot on the ground, its top end bolted to the end frame of the rack (the Kit stair, year builds). Lift crew on the ground, optional take crew on the deck above; refused when the top has no standing, supported frame to bear on.');
const stairRule: SupportRule = (w, e, to) => (TREAD(e) ? treadRule : e.def === 'stair-riser-kit' ? riserRule : e.def === 'stair-post-kit' ? postRule : handrailRule)(w, e, to);
export const installStairPart = setPartVerb('install_stair_part', 'stair part (tread board, riser, rail post, handrail)', stairRule, (d) => TREAD({ def: d } as Entity) || ['stair-riser-kit', 'stair-post-kit', 'stair-handrail-kit'].includes(d),
  'Set a Kit-stair part: a 2x10 tread board on two installed stringers, a riser on the tread below, a rail post bolted to a tread end, a handrail on two posts. Refused when what it bears on is not installed.');

// ---- the Kit stair as a walkable link (usable only when every stringer and tread board is in and the landing deck exists) ----
export type KitStair = { id: string; stringers: string[]; treads: string[][]; tops: number[]; foot: Vec2; dir: Vec2; width: number; topY: number; baseY: number; going: number; heading: number };

/** Walkable link of a Kit stair given the installed parts and the walkable surfaces (reason when not usable). */
export function kitStairLink(w: WorldState, st: KitStair, surfaces: Surface[]): Link {
  const reasons: string[] = [];
  const missS = st.stringers.filter((id) => w.entities[id]?.phase !== 'installed');
  if (missS.length) reasons.push(`${missS.length} stringer${missS.length === 1 ? '' : 's'} missing`);
  const missT = st.treads.map((b, i) => (b.every((id) => w.entities[id]?.phase === 'installed') ? 0 : i + 1)).filter((i) => i > 0);
  if (missT.length) reasons.push(`${missT.length === 1 ? 'tread' : 'treads'} ${missT.join(', ')} missing`);
  for (const id of [...st.stringers, ...st.treads.flat()]) { const e = w.entities[id]; if (e?.phase === 'installed') { const p = supportOf(w, e); if (p) { reasons.push(p); break; } } }
  const n = st.treads.length;
  const run = st.going * n;
  const from: Vec2 = [st.foot[0] - st.dir[0] * 0.45, st.foot[1] - st.dir[1] * 0.45];
  const to: Vec2 = [st.foot[0] + st.dir[0] * (run + 0.45), st.foot[1] + st.dir[1] * (run + 0.45)];
  const landing = surfaces.find((s) => s.level > 0 && Math.abs(s.y - st.topY) <= 0.1 && pointIn(to, s));
  if (!landing) reasons.push('no landing at top');
  const bottom = surfaces.find((s) => Math.abs(s.y - st.baseY) <= 0.08 && pointIn(from, s));
  if (!bottom) reasons.push('no floor at the foot');
  const path: Vec3[] = [[from[0], st.baseY, from[1]], [st.foot[0], st.baseY, st.foot[1]]];
  for (let i = 1; i <= n; i++) path.push([st.foot[0] + st.dir[0] * (i - 0.5) * st.going, st.tops[i - 1], st.foot[1] + st.dir[1] * (i - 0.5) * st.going]);
  const ly = landing?.y ?? st.topY;
  path.push([st.foot[0] + st.dir[0] * run, ly, st.foot[1] + st.dir[1] * run], [to[0], ly, to[1]]);
  return {
    id: st.id, kind: 'stairs',
    from: { level: bottom?.level ?? 0, p: from, y: st.baseY },
    to: { level: landing?.level ?? Math.round(st.topY / 0.5), p: to, y: ly },
    width: st.width, heading: st.heading, path, usable: reasons.length === 0, reason: reasons.length ? reasons.join('; ') : undefined,
  };
}
const pointIn = (p: Vec2, s: Surface) => { const l = rot2([p[0] - s.obb.c[0], p[1] - s.obb.c[1]], -s.obb.yaw); return Math.abs(l[0]) <= s.obb.half[0] + 1e-6 && Math.abs(l[1]) <= s.obb.half[1] + 1e-6; };

// ---- invariant: set_part holders' hands in reach every tick ----
export const kitPartHandsInReach: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  const ents = rt.world.entities;
  for (const h of Object.values(ents).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const slot = h.human?.grip?.slot;
    if (!slot?.startsWith(SETPART_SLOT)) continue;
    const part = ents[h.human!.grip!.entity];
    const hands = h.human!.hands;
    if (!part || !hands?.left || !hands.right) { out.push({ code: 'setpart.hands-missing', message: `${h.id} grips ${h.human!.grip!.entity} without hand points`, subjects: [h.id] }); continue; }
    for (const hh of [hands.left, hands.right]) {
      const gap = reachGap(h.pose.p, hh);
      if (gap > TOL + 1e-9) out.push({ code: 'setpart.hands-out-of-reach', message: `${h.id} holds ${part.id}: a hand ${gap.toFixed(2)} m beyond the reach envelope`, subjects: [part.id, h.id], at: hh });
      const up = hh[1] - h.pose.p[1];
      if (up > GIVE_MAX + 1e-6) out.push({ code: 'setpart.hands-out-of-reach', message: `${h.id} holds ${part.id} ${up.toFixed(2)} m above their feet (max ${GIVE_MAX} m)`, subjects: [part.id, h.id], at: hh });
      if (-up > REACH_DOWN + 1e-6) out.push({ code: 'setpart.hands-out-of-reach', message: `${h.id} holds ${part.id} ${(-up).toFixed(2)} m below their feet (max ${REACH_DOWN} m)`, subjects: [part.id, h.id], at: hh });
    }
  }
  return out;
};

/** Installed Kit stair / wall parts must keep their supports (the frames under the stringers stable, the posts under the handrails installed…). */
export const kitPartsSupported: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  for (const e of Object.values(rt.world.entities).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (e.phase !== 'installed' || !(STRINGER(e) || TREAD(e) || ['stair-riser-kit', 'stair-post-kit', 'stair-handrail-kit'].includes(e.def) || (isPlywood(e) && Math.abs(e.pose.roll ?? 0) > 0.1))) continue;
    const p = supportOf(rt.world, e);
    if (p) out.push({ code: 'support.part-unsupported', message: `${def(e.def).label} ${e.id} is installed but unsupported: ${p}`, subjects: [e.id], at: e.pose.p });
  }
  return out;
};

/** Spatial contributor: the walkable links of the scenario's Kit stairs (usable once complete, with a landing). */
export function kitStairContributor(stairs: KitStair[]): Contributor {
  return (world, base) => {
    if (!stairs.length) return {};
    const surfaces = [...base.surfaces, ...deckSurfaces(world)];
    return { links: stairs.map((st) => kitStairLink(world, st, surfaces)) };
  };
}
