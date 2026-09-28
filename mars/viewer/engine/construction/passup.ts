// pass_up — year builds phase B (owner feedback 2026-09-28 §5–§7, §9; W13). Mars assembly model v1,
// approximate. The Martian hand-up of hand_up (handup.ts), for a part that goes to a given level of a
// multi-level rack (hand_up rests a part on the HIGHEST members under it, so with the whole skeleton
// standing it can only reach the top beams), with an optional RELAY — the hang_beam relay pattern for
// sheets: two givers on the ground raise the part overhead outside the building's edge, two people kneeling
// at the edge of the deck below take it and raise it overhead again, and the receivers up top (on beam
// walkways or a deck at the target level) take it, lift it just above the members and feed it in to where it
// goes, staged there for install_plywood (aloft) / install_panel / install_rail.
//
//   pass_up {part, to: {x, z, yaw, height}, edge, out: {x, z}, givers[1–2], relay?[1–2], receivers[1–2]}
//
// * The part lies on the ground (stored / staged, support ground) near where it goes up; the givers walk to
//   it, crouch, lift (hands hanging), walk it to below the edge and reach up (underside ≤ floor + GIVE_MAX,
//   less with the hands out at the grips — the body model's reach_up envelope).
// * `edge` / `out`: the part goes up beyond the line dot(p, out) = edge (the outermost structure on that
//   side: a beam's outer face, a wall) — it is raised EDGE_GAP beyond it, straight up.
// * Relay and receivers already stand at their stations (the sequence walks / climbs them there): kneeling
//   at the edge they reach down (hands ≥ feet − REACH_DOWN, ≤ 0.8 m out from the feet), take it at the
//   nearest point of its top face; the relay then raises it overhead (its own reach_up envelope, ≤ floor +
//   GIVE_MAX) and the receivers take it from them.
// * The receivers lift it to SLIDE_CLEAR above the members and feed it in (≤ 0.4 m/s, never walking with it)
//   to its place: every pose of that path must be within each receiver's reach envelope and keep BODY_GAP
//   from their feet when in their body band. Rest: plywood on the joists / beams at `height`
//   (deck.ts sheetSupports), a panel rail on the deck sheets level with `height`, a solar panel on two
//   installed rails level with `height`.
// Everything is checked at plan time; hands are published every tick in hand_up's slot formats
// (`handup-give-…`, `handup-take-…`), so liftHandsInReach (invariants.ts) checks them per tick and
// handupHands() rebuilds them from a take.
// Refusals: passup.not-part, passup.not-staged, passup.installed, crew.size, passup.no-rest, passup.occupied,
// passup.too-high (a hand-off gap: names both heights; "add a relay" / "use the forklift"), passup.giver-reach,
// passup.giver-blocked, passup.relay-reach, passup.receiver-reach (names who, the pose and the gap),
// passup.body-gap, passup.not-at-station, passup.path-blocked, passup.cancel-unsafe.
import { z } from 'zod';
import { add2, datan2, dist2, dot2, rot2, scale2, type OBB2, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { isPanel, isRail } from '../world/catalog-solar.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { crewCheck, f2, fail, lerpPose, smooth, spatialOf, symmetricYaw, sweepPoses, type Fail } from './access.ts';
import { flatObb, isPlywood, memberTop, sheetSupports } from './deck.ts';
import { BODY_GAP, CARRY_Y, EDGE_GAP, envelopeGap, GIVE_MAX, GIVER_OFF, HAND_SPREAD, HANDUP_SLOT_PREFIX, handupHands, KNEEL_BACK, nearestOnRect, POSTURE, REACH_DOWN, setHands, SLIDE_CLEAR, SPEED, STEP, T } from './handup.ts';
import { BODY_MODEL, postureTop, restHands } from '../body/model.ts';

export const HANDOFF_OUT = BODY_MODEL.maxHorizontalFromFeet; // kneel rule: hands ≤ this horizontally from the feet at a take
const size = (e: Entity) => def(e.def).size;
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const at = (q: Pose): Vec2 => [q.p[0], q.p[2]];
const poseAtXZ = (c: Vec2, y: number, yaw: number): Pose => ({ p: [c[0], y, c[1]], yaw });

type PP = {
  part: string;
  to: { x: number; z: number; yaw: number; height: number };
  edge: number;
  out: { x: number; z: number };
  givers: string[];
  relay?: string[];
  receivers: string[];
  /** Underside height (above the givers' floor) they bring it to; default: as high as they reach (overhead). */
  give?: number;
  /** The givers push it in over the edge at that height as far as they can stand and reach, before the receivers take it. */
  push?: boolean;
  /** Givers hold it by its long edges near the outer end, standing beside it (default: by its outer end, beyond it). */
  side?: boolean;
  /** Receivers on a deck walk alongside it as they feed it in (never on a beam walkway). */
  follow?: boolean;
  /** Stations (on a floor: ground / deck) the relay / receivers walk to first (aligned with them; omitted = where they stand, e.g. on a beam). */
  relayAt?: { x: number; z: number; level: number }[];
  receiverAt?: { x: number; z: number; level: number; kneel?: { x: number; z: number } }[];
  /** Plywood only: set down AND fastened (screwed to its supports) by the receivers plus these (walking to `at` first);
   *  `[]` = the receivers alone (provisional: one person may screw a sheet down where it lies). */
  fasten?: { actor: string; at?: { x: number; z: number; level: number } }[];
};
type Seg = { phase: string; who: 'givers' | 'relay' | 'receivers'; from: Pose; to: Pose; dur: number };
type Grip = { g: Vec2; tan: Vec2; out?: Vec2 }; // local grip point + local tangent (hands spread along it) + (givers) the local direction they stand off in
export type PassUpProgram = {
  yaw: number;
  rest: { y: number; supports: string[]; on: string };
  final: Pose;
  giverGrips: Grip[];
  giverOut: Vec2; // local outward direction (givers stand GIVER_OFF beyond the grips along it)
  pickup: { actor: string; p: Vec2; yaw: number; level: number }[];
  segs: Seg[];
  relayGrips: Grip[];
  heights: { give: number; relay: number | null; slide: number; push: number };
  raisePhase: string;
  walks: { actor: string; p: Vec2; yaw: number; level: number }[];
  fasten: string[];
  follow: boolean;
  kneels: { actor: string; from: Vec2; to: Vec2 }[];
};

// ---- rest: what the part will lie on at `height` ----
function restFor(rt: Runtime, e: Entity, o: OBB2, height: number): { y: number; supports: string[]; on: string } | Fail {
  const w = rt.world;
  if (isPlywood(e)) {
    const s = sheetSupports(w, e, o, height);
    if (!s.ok) return { ok: false, diagnostic: { ...s.diagnostic, code: 'passup.no-rest', message: `${e.id} would not rest at ${f2(height)} m: ${s.diagnostic.message}` } };
    if (Math.abs(s.y - height) > 0.3) return fail('passup.no-rest', `${e.id} would rest at ${f2(s.y)} m, not near ${f2(height)} m`, [e.id]);
    return { y: s.y, supports: s.supports, on: s.supports[0] };
  }
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => add2(o.c, rot2([a * o.half[0], b * o.half[1]], o.yaw)));
  const pts = [...corners, o.c, add2(o.c, rot2([o.half[0] / 2, 0], o.yaw)), add2(o.c, rot2([-o.half[0] / 2, 0], o.yaw))];
  if (isRail(e.def)) {
    // on the deck: installed sheets level with `height` under every sample point of the rail
    const sheets = Object.values(w.entities).filter((x) => isPlywood(x) && x.phase === 'installed' && Math.abs(memberTop(x) - height) <= 0.03).sort((a, b) => (a.id < b.id ? -1 : 1));
    const on = (p: Vec2) => sheets.filter((x) => { const so = flatObb(x.pose, x); return dist2(nearestOnRect(so, p).q, p) <= 0.005; });
    const miss = pts.find((p) => !on(p).length);
    if (miss) return fail('passup.no-rest', `rail ${e.id} would overhang the deck at (${f2(miss[0])}, ${f2(miss[1])}) at ${f2(height)} m (no installed sheet there)`, [e.id]);
    const under = [...new Set(pts.flatMap((p) => on(p).map((x) => x.id)))].sort();
    return { y: memberTop(w.entities[under[0]]), supports: under, on: under[0] };
  }
  if (isPanel(e.def)) {
    const rails = Object.values(w.entities).filter((x) => isRail(x.def) && x.phase === 'installed' && Math.abs(memberTop(x) - height) <= 0.03).filter((x) => rectsOverlap(o, flatObb(x.pose, x))).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (rails.length < 2) return fail('passup.no-rest', `${e.id} at (${f2(o.c[0])}, ${f2(o.c[1])}) would rest on ${rails.length} installed rail(s) at ${f2(height)} m; it needs two`, [e.id, ...rails.map((r) => r.id)]);
    return { y: Math.max(...rails.map(memberTop)), supports: rails.map((r) => r.id), on: rails[0].id };
  }
  return fail('passup.no-rest', `${def(e.def).label} ${e.id} has no rest rule for pass_up (plywood, panel rails, solar panels)`, [e.id]);
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

/**
 * Givers' grips: on the part's outer edge (hand_up's localOut rule: they stand beyond its outer end), or with `side`
 * on its two long edges near the outer end (they stand beside it — where the ground beyond its end is taken).
 */
function outerGrips(nLoc: Vec2, lx: number, lz: number, n: number, side = false): { grips: Grip[]; out: Vec2 } {
  if (side) {
    if (Math.abs(nLoc[0]) >= Math.abs(nLoc[1])) {
      const sx = nLoc[0] >= 0 ? 1 : -1;
      const zs = n === 1 ? [1] : [-1, 1];
      return { grips: zs.map((sz) => ({ g: [sx * 0.25 * lx, (sz * lz) / 2] as Vec2, tan: [1, 0] as Vec2, out: [0, sz] as Vec2 })), out: [sx, 0] };
    }
    const sz = nLoc[1] >= 0 ? 1 : -1;
    const xs = n === 1 ? [1] : [-1, 1];
    return { grips: xs.map((sx) => ({ g: [(sx * lx) / 2, sz * 0.25 * lz] as Vec2, tan: [0, 1] as Vec2, out: [sx, 0] as Vec2 })), out: [0, sz] };
  }
  if (Math.abs(nLoc[0]) >= Math.abs(nLoc[1])) {
    const sx = nLoc[0] >= 0 ? 1 : -1;
    const x = sx * 0.45 * lx;
    const zs = n === 1 ? [0] : lz >= 0.6 ? [-0.4 * lz, 0.4 * lz] : [0, 0];
    return { grips: zs.map((zz) => ({ g: [x, zz] as Vec2, tan: [0, 1] as Vec2 })), out: [sx, 0] };
  }
  const sz = nLoc[1] >= 0 ? 1 : -1;
  const xs = n === 1 ? [0] : [-0.35 * lx, 0.35 * lx];
  return { grips: xs.map((xx) => ({ g: [xx, (sz * lz) / 2] as Vec2, tan: [1, 0] as Vec2 })), out: [0, sz] };
}
const q3 = (v: Vec2): Vec2 => [Number(v[0].toFixed(3)), Number(v[1].toFixed(3))];
/** hand_up's slot formats (handupHands rebuilds the hands from them): givers and the raising relay grip a local point. */
const giveSlot = (i: number, g: Grip) => `${HANDUP_SLOT_PREFIX}give-${i}:${g.g[0].toFixed(3)}:${g.g[1].toFixed(3)}:${Math.abs(g.tan[0]) > 0.5 ? 'x' : 'z'}`;
const takeSlot = (i: number) => `${HANDUP_SLOT_PREFIX}take-${i}`;
const handsFor = (e: Entity, q: Pose, h: Entity, slot: string): [Vec3, Vec3] => handupHands(e, q, h, slot)!;
function samples(e: Entity, a: Pose, b: Pose): Pose[] {
  const ext = Math.sqrt(size(e)[0] * size(e)[0] + size(e)[2] * size(e)[2]) / 2;
  const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + ext * Math.abs(b.yaw - a.yaw);
  const n = Math.max(1, Math.ceil(d / STEP));
  return Array.from({ length: n + 1 }, (_, k) => lerpPose(a, b, k / n));
}
const segDur = (a: Pose, b: Pose, speed: number, min = 0.2) => {
  const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
  return Math.max(min, Math.sqrt(dx * dx + dy * dy + dz * dz) / speed);
};

export function planPassUp(rt: Runtime, p: PP): { ok: true; program: PassUpProgram } | Fail {
  const w = rt.world;
  const e = w.entities[p.part];
  if (!e || e.kind !== 'component' || !def(e.def).handling) return fail('passup.not-part', `${p.part} is not a component that can be handed up`, [p.part]);
  if (e.phase === 'installed') return fail('passup.installed', `${e.id} is already installed`, [e.id]);
  if (!(e.phase === 'stored' || e.phase === 'staged') || e.support?.kind !== 'ground')
    return fail('passup.not-staged', `${e.id} must lie on the ground near where it goes up (it is ${e.phase ?? 'unplaced'}, support ${e.support?.kind ?? 'none'})`, [e.id]);
  const hd = def(e.def).handling!;
  const relay = p.relay ?? [];
  const cc = crewCheck(rt, [...p.givers, ...relay, ...p.receivers], 2, 6, `passing up ${e.id}`);
  if (cc) return cc;
  for (const [what, xs] of [['givers', p.givers], ['receivers', p.receivers], ...(relay.length ? [['relay', relay]] : [])] as [string, string[]][])
    if (xs.length < hd.carryCrew[0] || xs.length > 2) return fail('crew.size', `${def(e.def).label} ${e.id} needs ${hd.carryCrew[0]}–2 ${what}; ${xs.length} assigned`, xs);
  const n: Vec2 = (() => { const l = Math.sqrt(p.out.x * p.out.x + p.out.z * p.out.z) || 1; return [p.out.x / l, p.out.z / l]; })();
  const yaw = symmetricYaw(e.pose.yaw, p.to.yaw);
  const obbF: OBB2 = { c: [p.to.x, p.to.z], half: [size(e)[0] / 2, size(e)[2] / 2], yaw };
  const rest = restFor(rt, e, obbF, p.to.height);
  if ('ok' in rest) return rest as Fail;
  for (const o of Object.values(w.entities))
    if (o.id !== e.id && o.kind === 'component' && def(o.def).category === def(e.def).category && o.phase !== 'carried' && Math.abs(o.pose.p[1] - rest.y) < 0.03 && rectsOverlap(obbF, flatObb(o.pose, o)))
      return fail('passup.occupied', `${o.id} already lies where ${e.id} would go`, [e.id, o.id]);
  const final = poseAtXZ([p.to.x, p.to.z], rest.y, yaw);
  const th = size(e)[1];
  const ySlide = rest.y + SLIDE_CLEAR;
  // ---- where it goes up: beyond the edge line, straight up
  const cornersF = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => add2(obbF.c, rot2([a * obbF.half[0], b * obbF.half[1]], yaw)));
  const shift = Math.max(0, p.edge + EDGE_GAP - Math.min(...cornersF.map((c) => dot2(c, n))));
  const R = (y: number): Pose => poseAtXZ(add2(obbF.c, scale2(n, shift)), y, yaw);
  // ---- givers
  const gl = p.givers.map((g) => w.entities[g]);
  const floor = gl[0].pose.p[1];
  if (gl.some((h) => h.human!.on || h.human!.level !== gl[0].human!.level)) return fail('passup.giver-level', `the givers must stand together on one floor (not on the structure)`, p.givers);
  const { grips, out } = outerGrips(rot2(n, -yaw), size(e)[0], size(e)[2], p.givers.length, p.side);
  const giverGrips = grips.map((g) => ({ ...g, g: q3(g.g), out: g.out ?? out }));
  const giverFeet = (i: number, q: Pose): Vec3 => { const c = add2(at(q), rot2(add2(giverGrips[i].g, scale2(giverGrips[i].out, GIVER_OFF)), q.yaw)); return [c[0], floor, c[1]]; };
  const giverHands = (i: number, q: Pose, feet: Vec3) => handsFor(e, q, { ...gl[i], pose: { ...gl[i].pose, p: feet } }, giveSlot(i, giverGrips[i]));
  let give = floor + GIVE_MAX;
  for (const [i] of gl.entries()) {
    const q = R(give), f = giverFeet(i, q);
    for (const hh of giverHands(i, q, f)) give = Math.min(give, floor + postureTop(POSTURE.reach_up, dist2([hh[0], hh[2]], [f[0], f[2]])));
  }
  if (p.give !== undefined) {
    if (floor + p.give > give + 1e-9) return fail('passup.giver-reach', `the givers cannot hold ${e.id} ${f2(p.give)} m above their floor (they reach ${f2(give - floor)} m at its outer edge)`, p.givers);
    give = floor + p.give;
  }
  if (give < floor + CARRY_Y && p.give === undefined) return fail('passup.giver-reach', `the givers cannot hold ${e.id} overhead by its outer edge`, p.givers);
  const raisePhase = give >= floor + CARRY_Y ? 'reach_up' : 'crouch'; // down to a low hand-off: they crouch with it
  // ---- relay (optional): kneel at the deck edge, take it at `give`, raise it overhead
  const holderOk = (h: Entity, q: Pose, act: string, slot: string, take: boolean): string | null => {
    const hands = slot.startsWith(`${HANDUP_SLOT_PREFIX}take`) ? handupHands(e, q, h, slot)! : handsFor(e, q, h, slot);
    for (const hh of hands) {
      const gap = envelopeGap(act, h.pose.p, hh);
      if (gap > 1e-9) return `a hand ${f2(gap)} m beyond their reach (${act})`;
      if (take && h.pose.p[1] - hh[1] > REACH_DOWN + 1e-9) return `hands ${f2(h.pose.p[1] - hh[1])} m below their feet (max ${REACH_DOWN} m)`;
      if (take && dist2([hh[0], hh[2]], at(h.pose)) > HANDOFF_OUT + 1e-9) return `hands ${f2(dist2([hh[0], hh[2]], at(h.pose)))} m out from their feet at the hand-off (kneeling: max ${HANDOFF_OUT} m)`;
    }
    // a load in the body band keeps its distance
    if (q.p[1] + th > h.pose.p[1] + 0.02 && q.p[1] < h.pose.p[1] + HUMAN_PROFILE.height && dist2(nearestOnRect(flatObb(q, e), at(h.pose)).q, at(h.pose)) < BODY_GAP - 1e-9)
      return `${e.id} would pass ${f2(dist2(nearestOnRect(flatObb(q, e), at(h.pose)).q, at(h.pose)))} m from their feet in their body band (min ${f2(BODY_GAP)} m)`;
    return null;
  };
  // relay / receivers / fasteners: where they will stand (their station, walked to by this action, or where they are)
  const sp0 = spatialOf(rt);
  const stationOf = (id: string, at?: { x: number; z: number; level: number; kneel?: { x: number; z: number } }): Entity => {
    const h = w.entities[id];
    if (!at) return h;
    const lv = sp0.scene.levels.find((l) => l.id === at.level);
    if (at.kneel && dist2([at.kneel.x, at.kneel.z], [at.x, at.z]) > 0.15 + 1e-9) throw new Error('kneel point more than 0.15 m from the station');
    const k = at.kneel ?? at; // they walk to `at` and shuffle forward to kneel at the edge
    return { ...h, pose: { ...h.pose, p: [k.x, lv ? lv.y : h.pose.p[1], k.z] }, human: { ...h.human!, level: at.level, on: undefined } };
  };
  if ((p.relayAt && p.relayAt.length !== relay.length) || (p.receiverAt && p.receiverAt.length !== p.receivers.length)) return fail('passup.stations', 'give one station per relay / receiver', [...relay, ...p.receivers]);
  const rl = relay.map((r, i) => stationOf(r, p.relayAt?.[i]));
  const rc = p.receivers.map((r, i) => stationOf(r, p.receiverAt?.[i]));
  for (const h of [...rl, ...rc]) if (w.entities[h.id].human!.task) return fail('passup.not-at-station', `${h.id} is busy (${w.entities[h.id].human!.task})`, [h.id]);
  if (p.fasten && !isPlywood(e)) return fail('passup.fasten', `pass_up fastens plywood only (${e.id}: use install_rail / install_panel)`, [e.id]);
  let relayTop: number | null = null;
  const relayGrips: Grip[] = [];
  const segs: Seg[] = [];
  let handAt = give; // underside height at the hand-off to the receivers
  if (rl.length) {
    const q = R(give);
    for (const [i, h] of rl.entries()) {
      if (h.human!.on) return fail('passup.not-at-station', `relay ${h.id} stands on ${h.human!.on}; the relay kneels on a deck at the edge`, [h.id]);
      const why = holderOk(h, q, 'reach_down', takeSlot(i), true);
      if (why) return fail('passup.relay-reach', `relay ${h.id} at (${f2(h.pose.p[0])}, ${f2(h.pose.p[1])}, ${f2(h.pose.p[2])}) cannot take ${e.id} from the givers at ${f2(give)} m: ${why}`, [e.id, h.id], h.pose.p);
      // the grip it keeps while raising: the nearest point of the part to them, in part-local coords
      const nr = nearestOnRect(flatObb(q, e), at(h.pose));
      const lg = rot2([nr.q[0] - q.p[0], nr.q[1] - q.p[2]], -yaw), lt = rot2(nr.t, -yaw);
      relayGrips.push({ g: q3(lg), tan: [Math.abs(lt[0]) > 0.5 ? 1 : 0, Math.abs(lt[0]) > 0.5 ? 0 : 1] });
    }
    const rfloor = rl[0].pose.p[1];
    if (rl.some((h) => Math.abs(h.pose.p[1] - rfloor) > 0.02)) return fail('passup.relay-level', 'the relay kneels on one deck', relay);
    // (the relay keeps the grip it took it by — the top face at its nearest edge — while it stands up with it)
    let top = rfloor + GIVE_MAX - th;
    for (const [i, h] of rl.entries()) {
      const hands = handupHands(e, R(top), h, takeSlot(i))!;
      for (const hh of hands) top = Math.min(top, rfloor + postureTop(POSTURE.stand_with_load, dist2([hh[0], hh[2]], at(h.pose))) - th);
    }
    if (top <= give) return fail('passup.too-high', `the relay on the deck at ${f2(rfloor)} m cannot raise ${e.id} above the givers' ${f2(give)} m`, relay);
    for (const q2 of samples(e, R(give), R(top)))
      for (const [i, h] of rl.entries()) {
        const why = holderOk(h, q2, 'stand_with_load', takeSlot(i), false); // from kneeling at the edge up to overhead
        if (why) return fail('passup.relay-reach', `relay ${h.id} cannot raise ${e.id} to ${f2(top)} m: at ${f2(q2.p[1])} m ${why}`, [e.id, h.id], h.pose.p);
      }
    relayTop = top;
    handAt = top;
  }
  // ---- receivers: take it at handAt, lift it to the slide height, feed it in, set it down
  // the givers push it in over the edge (at the hand-off height) as far as they can stand and reach
  let sPush = 0;
  const Rp = (y: number, sp: number): Pose => poseAtXZ(add2(obbF.c, scale2(n, shift - sp)), y, yaw);
  if (p.push && !rl.length) {
    const g2 = spatialOf(rt).level(gl[0].human!.level);
    for (let sp = STEP; sp <= shift + 1e-9; sp += STEP) {
      const q = Rp(give, sp);
      const ok = gl.every((_, i) => { const f = giverFeet(i, q); return !!g2 && clearanceAt(g2, [f[0], f[2]]) >= HUMAN_PROFILE.radius - 0.03 && giverHands(i, q, f).every((hh) => envelopeGap(raisePhase, f, hh) <= 0); });
      if (!ok) break;
      sPush = sp;
    }
    if (sPush >= shift - 1e-9) sPush = shift;
  }
  const tr = sPush > 0 ? Rp(handAt, sPush) : R(handAt);
  const recv = [tr, ...(handAt < ySlide ? [sPush > 0 ? Rp(ySlide, sPush) : R(ySlide)] : []), poseAtXZ(at(final), Math.max(ySlide, handAt), yaw), final];
  if (p.follow && rc.some((h) => h.human!.on)) return fail('passup.follow-on-beam', 'receivers on a beam do not walk with a load; only receivers on a deck follow it in', p.receivers);
  const gR = p.follow ? spatialOf(rt).level(rc[0].human!.level) : undefined;
  const moved = (h: Entity, q: Pose): Entity => (p.follow ? { ...h, pose: { ...h.pose, p: [h.pose.p[0] + q.p[0] - tr.p[0], h.pose.p[1], h.pose.p[2] + q.p[2] - tr.p[2]] } } : h);
  for (const [i, h] of rc.entries()) {
    const why = holderOk(h, tr, 'reach_down', takeSlot(i), true);
    if (why) {
      const hands = handupHands(e, tr, h, takeSlot(i))!;
      return fail('passup.too-high', `receiver ${h.id} (feet ${f2(h.pose.p[1])} m at (${f2(h.pose.p[0])}, ${f2(h.pose.p[2])})) cannot take ${e.id} ${rl.length ? 'from the relay' : 'from the givers'} at ${f2(handAt)} m (hands at ${f2(hands[0][1])} m): ${why}${rl.length ? '' : '; add a relay on a deck below'}`, [e.id, h.id], h.pose.p);
    }
    for (let k = 1; k < recv.length; k++)
      for (const q of samples(e, recv[k - 1], recv[k])) {
        const hq = moved(h, q);
        if (p.follow && (!gR || clearanceAt(gR, at(hq.pose)) < HUMAN_PROFILE.radius - 0.03))
          return fail('passup.receiver-blocked', `receiver ${h.id} has no room to walk alongside ${e.id} at (${f2(hq.pose.p[0])}, ${f2(hq.pose.p[2])})`, [e.id, h.id], hq.pose.p);
        const w2 = holderOk(hq, q, k === recv.length - 1 ? 'set_down' : 'lay', takeSlot(i), false);
        if (w2) return fail('passup.receiver-reach', `receiver ${h.id} cannot feed ${e.id} in from (${f2(h.pose.p[0])}, ${f2(h.pose.p[2])}): at (${f2(q.p[0])}, ${f2(q.p[1])}, ${f2(q.p[2])}) ${w2}`, [e.id, h.id], q.p);
      }
  }
  if (rc.length === 2 && dist2(at(rc[0].pose), at(rc[1].pose)) < 0.6) return fail('passup.not-at-station', `receivers ${rc[0].id} and ${rc[1].id} stand ${f2(dist2(at(rc[0].pose), at(rc[1].pose)))} m apart (min 0.6 m)`, p.receivers);
  // ---- fasteners (plywood): the receivers + `fasten`, each within reach of the sheet in place (as install_plywood aloft)
  // a giver who also fastens stays where the push left them
  const giverAtEnd = (id: string): Entity => { const i = p.givers.indexOf(id); const f = giverFeet(i, tr); const h = w.entities[id]; return { ...h, pose: { ...h.pose, p: f } }; };
  const fasteners = [...rc.map((h) => moved(h, final)), ...(p.fasten ?? []).map((f) => (p.givers.includes(f.actor) && !f.at ? giverAtEnd(f.actor) : stationOf(f.actor, f.at)))];
  if (p.fasten) {
    const fo = flatObb(final, e);
    for (const h of fasteners) {
      const dh = dist2(nearestOnRect(fo, at(h.pose)).q, at(h.pose)), up = final.p[1] - h.pose.p[1];
      if (dh > HANDOFF_OUT + 1e-9 || up > GIVE_MAX + 1e-9 || up < -REACH_DOWN - 1e-9)
        return fail('passup.fasten-reach', `${h.id} cannot fasten ${e.id} from (${f2(h.pose.p[0])}, ${f2(h.pose.p[1])}, ${f2(h.pose.p[2])}): ${f2(dh)} m away (max ${HANDOFF_OUT} m), ${f2(up)} m above their feet`, [e.id, h.id], h.pose.p);
    }
  }
  const walks: { actor: string; p: Vec2; yaw: number; level: number }[] = [
    ...relay.map((a, i) => ({ a, at: p.relayAt?.[i] })), ...p.receivers.map((a, i) => ({ a, at: p.receiverAt?.[i] })), ...(p.fasten ?? []).map((f) => ({ a: f.actor, at: f.at })),
  ].filter((x) => !!x.at).map((x) => { const c = nearestOnRect(flatObb(final, e), [x.at!.x, x.at!.z]).q; return { actor: x.a, p: [x.at!.x, x.at!.z] as Vec2, yaw: datan2(c[1] - x.at!.z, c[0] - x.at!.x), level: x.at!.level }; });
  // ---- givers: pick it up where it lies, walk it to below the edge, reach up
  const lying = e.pose;
  const lyingG = { ...lying, yaw };
  const pickup = p.givers.map((a, i) => { const f = giverFeet(i, lyingG); const c = add2(at(lyingG), rot2(giverGrips[i].g, yaw)); return { actor: a, p: [f[0], f[2]] as Vec2, yaw: datan2(c[1] - f[2], c[0] - f[0]), level: gl[0].human!.level }; });
  if (dist2(at(lying), at(R(0))) > 3.0 + 1e-9) return fail('passup.not-staged', `${e.id} lies ${f2(dist2(at(lying), at(R(0))))} m from where it goes up at (${f2(R(0).p[0])}, ${f2(R(0).p[2])}); carry it within 3 m first`, [e.id]);
  const up: Pose = { ...lyingG, p: [lying.p[0], floor + CARRY_Y, lying.p[2]] };
  const g = spatialOf(rt).level(gl[0].human!.level);
  for (const [a, b, phase] of [[up, R(floor + CARRY_Y), 'walk-load'], [R(floor + CARRY_Y), R(give), raisePhase], ...(sPush > 0 ? [[R(give), Rp(give, sPush), raisePhase]] : [])] as [Pose, Pose, string][])
    for (const q of samples(e, a, b)) {
      const fs = p.givers.map((_, i) => giverFeet(i, q));
      for (const [i, f] of fs.entries()) {
        if (!g || clearanceAt(g, [f[0], f[2]]) < HUMAN_PROFILE.radius - 0.03)
          return fail('passup.giver-blocked', `${p.givers[i]} has no room to stand at (${f2(f[0])}, ${f2(f[2])}) holding ${e.id} (${phase})`, [e.id, p.givers[i]], f);
        for (const hh of giverHands(i, q, f)) {
          const gap = envelopeGap(phase, f, hh);
          if (gap > 1e-9) return fail('passup.giver-reach', `${p.givers[i]} cannot hold ${e.id} at ${f2(q.p[1] - floor)} m above their floor standing at (${f2(f[0])}, ${f2(f[2])}) (${phase}): a hand ${f2(gap)} m beyond reach`, [e.id, p.givers[i]], f);
        }
      }
      if (fs.length === 2 && dist2([fs[0][0], fs[0][2]], [fs[1][0], fs[1][2]]) < 2 * HUMAN_PROFILE.radius) return fail('passup.giver-blocked', `the givers would stand ${f2(dist2([fs[0][0], fs[0][2]], [fs[1][0], fs[1][2]]))} m apart`, p.givers);
    }
  const pk = checkStations(rt, [...pickup, ...walks].map((m) => ({ actor: m.actor, p: m.p, level: m.level })));
  if (pk) return { ok: false, diagnostic: { ...pk, code: 'passup.giver-unreachable' } };
  // ---- the part's path (supports may be touched at the very end; notched parts are allowed their notch at Kit frames)
  const ignore = rest.supports;
  const path = [up, R(floor + CARRY_Y), R(give), ...(sPush > 0 ? [Rp(give, sPush)] : []), ...(relayTop !== null ? [R(relayTop)] : []), ...recv.slice(1)];
  const hit = sweepPoses(rt, e, path, ignore);
  if (hit) return fail('passup.path-blocked', `${e.id} cannot go up at the edge and in: it would hit ${hit.o.label ?? hit.o.id} at (${f2(hit.q.p[0])}, ${f2(hit.q.p[1])}, ${f2(hit.q.p[2])})`, [e.id, hit.o.id], hit.q.p);
  // ---- segments
  segs.push({ phase: 'crouch', who: 'givers', from: lyingG, to: lyingG, dur: T.crouch });
  segs.push({ phase: 'lift', who: 'givers', from: lyingG, to: up, dur: T.lift });
  segs.push({ phase: 'walk-load', who: 'givers', from: up, to: R(floor + CARRY_Y), dur: segDur(up, R(floor + CARRY_Y), SPEED.carry) });
  segs.push({ phase: raisePhase, who: 'givers', from: R(floor + CARRY_Y), to: R(give), dur: segDur(R(floor + CARRY_Y), R(give), SPEED.raise) });
  if (sPush > 0) segs.push({ phase: 'push', who: 'givers', from: R(give), to: Rp(give, sPush), dur: segDur(R(give), Rp(give, sPush), SPEED.slide) });
  if (relayTop !== null) {
    segs.push({ phase: 'reach_down', who: 'relay', from: R(give), to: R(give), dur: T.reachDown });
    segs.push({ phase: 'take', who: 'relay', from: R(give), to: R(give), dur: T.take });
    segs.push({ phase: 'stand_with_load', who: 'relay', from: R(give), to: R(relayTop), dur: segDur(R(give), R(relayTop), SPEED.raise) });
  }
  segs.push({ phase: 'reach_down', who: 'receivers', from: tr, to: tr, dur: T.reachDown });
  segs.push({ phase: 'take', who: 'receivers', from: tr, to: tr, dur: T.take });
  for (let k = 1; k < recv.length; k++) {
    const ph = k === recv.length - 1 ? 'set_down' : k === 1 && handAt < ySlide ? 'stand_with_load' : 'lay';
    segs.push({ phase: ph, who: 'receivers', from: recv[k - 1], to: recv[k], dur: ph === 'set_down' ? T.setDown : segDur(recv[k - 1], recv[k], ph === 'lay' ? SPEED.slide : SPEED.raise, ph === 'stand_with_load' ? T.stand : 0.2) });
  }
  return { ok: true, program: { yaw, rest, final, giverGrips, giverOut: out, pickup, segs, relayGrips, heights: { give, relay: relayTop, slide: ySlide, push: sPush }, raisePhase, walks, fasten: p.fasten ? [...new Set([...p.receivers, ...p.fasten.map((f) => f.actor)])] : [], follow: !!p.follow,
    kneels: p.receivers.map((a, i) => ({ a, at: p.receiverAt?.[i] })).filter((x) => x.at?.kneel).map((x) => ({ actor: x.a, from: [x.at!.x, x.at!.z] as Vec2, to: [x.at!.kneel!.x, x.at!.kneel!.z] as Vec2 })) } };
}

type Exec = { id: string; p: PP; prog: PassUpProgram; walk?: Children; si: number; t: number; t2?: number; holders: 'givers' | 'relay' | 'receivers' | null; feet0?: Record<string, Vec3> };
const FASTEN_S = 3.0;

function approachHands(h: Entity, grip: [Vec3, Vec3], k: number | undefined): [Vec3, Vec3] {
  if (k === undefined || k >= 1) return grip;
  const r = restHands(h), s = smooth(k);
  const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  return [mix(r[0], grip[0]), mix(r[1], grip[1])];
}

function hold(rt: Runtime, ex: Exec, who: 'givers' | 'relay' | 'receivers', activity: string, q: Pose, opts: { move?: boolean; k?: number; give?: boolean } = {}) {
  const e = rt.world.entities[ex.p.part];
  const ids = who === 'givers' ? ex.p.givers : who === 'relay' ? ex.p.relay ?? [] : ex.p.receivers;
  for (const [i, a] of ids.entries()) {
    const h = rt.world.entities[a];
    if (who === 'givers' && opts.move) {
      const gg = ex.prog.giverGrips[i];
      const c = add2(at(q), rot2(add2(gg.g, scale2(gg.out ?? ex.prog.giverOut, GIVER_OFF)), q.yaw));
      h.pose.p = [c[0], h.pose.p[1], c[1]];
    }
    const slot = who === 'givers' ? giveSlot(i, ex.prog.giverGrips[i]) : who === 'relay' && opts.give ? giveSlot(i, ex.prog.relayGrips[i]) : takeSlot(i);
    const hands = slot.startsWith(`${HANDUP_SLOT_PREFIX}take`) ? handupHands(e, q, h, slot)! : handsFor(e, q, h, slot);
    const c: Vec2 = [(hands[0][0] + hands[1][0]) / 2, (hands[0][2] + hands[1][2]) / 2];
    h.pose.yaw = datan2(c[1] - h.pose.p[2], c[0] - h.pose.p[0]);
    Object.assign(h.human!, { activity, task: ex.id, grip: { entity: e.id, slot } });
    setHands(h, approachHands(h, hands, opts.k));
  }
}
function release(rt: Runtime, ids: string[]) {
  for (const a of ids) {
    const h = rt.world.entities[a];
    Object.assign(h.human!, { activity: 'idle', grip: undefined, task: undefined });
    setHands(h, undefined);
  }
}
const phaseK = (s: Seg, t: number) => (s.dur > 0 ? Math.min(1, t / s.dur) : 1);
function poseAt(s: Seg, t: number): Pose {
  const k = phaseK(s, t);
  return lerpPose(s.from, s.to, s.phase === 'lift' || s.phase === 'set_down' || s.phase === 'reach_up' || s.phase === 'stand_with_load' ? smooth(k) : k);
}

function stepPassUp(rt: Runtime, ex: Exec, dt: number): StepResult {
  const w = rt.world;
  const e = w.entities[ex.p.part];
  const prog = ex.prog;
  if (!ex.walk) {
    const r = walkCrew(rt, ex.id, [...prog.pickup, ...prog.walks].map((m) => ({ actor: m.actor, p: m.p, yaw: m.yaw, level: m.level })));
    if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'passup.giver-unreachable' } };
    ex.walk = r;
    for (const a of [...(ex.p.relay ?? []), ...ex.p.receivers, ...(ex.p.fasten ?? []).map((f) => f.actor)]) if (!prog.walks.some((m) => m.actor === a)) Object.assign(w.entities[a].human!, { activity: 'wait', task: ex.id });
  }
  if (ex.si < 0) {
    const s = childrenState(ex.walk);
    if (typeof s === 'object') return { status: 'failed', diagnostic: s };
    if (s === 'running') return { status: 'running', phase: 'approach' };
    ex.si = 0;
    ex.t = 0;
  }
  if (ex.si < prog.segs.length) {
  const seg = prog.segs[ex.si];
  ex.t += dt;
  const q = seg.phase === 'crouch' || seg.phase === 'reach_down' || seg.phase === 'take' ? seg.from : poseAt(seg, ex.t);
  if (seg.phase === 'lift' && e.phase !== 'carried') {
    e.phase = 'carried';
    e.support = { kind: 'held', by: [...ex.p.givers] };
    ex.holders = 'givers';
  }
  if (seg.phase !== 'crouch') e.pose = q;
  const k = seg.phase === 'crouch' || seg.phase === 'reach_down' ? phaseK(seg, ex.t) : undefined;
  if (seg.who === 'givers') hold(rt, ex, 'givers', seg.phase === 'push' ? ex.prog.raisePhase : seg.phase, e.pose, { move: seg.phase === 'walk-load' || seg.phase === 'push', k });
  else {
    // whoever holds it keeps holding while the next pair reaches for it
    if (ex.holders && ex.holders !== seg.who) hold(rt, ex, ex.holders, ex.holders === 'givers' ? ex.prog.raisePhase : 'stand_with_load', e.pose, {});
    if (seg.phase === 'reach_down' && e.support?.kind === 'held' && !e.support.by.includes((seg.who === 'relay' ? ex.p.relay! : ex.p.receivers)[0]))
      e.support = { kind: 'held', by: [...e.support.by, ...(seg.who === 'relay' ? ex.p.relay! : ex.p.receivers)] };
    if (seg.who === 'receivers' && seg.phase === 'reach_down') for (const kn of prog.kneels) {
      const h = w.entities[kn.actor], kk = Math.min(1, ex.t / seg.dur);
      h.pose.p = [kn.from[0] + (kn.to[0] - kn.from[0]) * kk, h.pose.p[1], kn.from[1] + (kn.to[1] - kn.from[1]) * kk];
    }
    if (seg.who === 'receivers' && prog.follow && seg.phase !== 'reach_down' && seg.phase !== 'take') {
      // walking alongside: the receivers keep their offset from it
      const tr0 = prog.segs.find((x) => x.who === 'receivers' && x.phase === 'take')!.from;
      ex.feet0 ??= Object.fromEntries(ex.p.receivers.map((a) => [a, [...w.entities[a].pose.p] as Vec3]));
      for (const a of ex.p.receivers) { const f0 = ex.feet0[a]; w.entities[a].pose.p = [f0[0] + e.pose.p[0] - tr0.p[0], f0[1], f0[2] + e.pose.p[2] - tr0.p[2]]; }
    }
    hold(rt, ex, seg.who, seg.phase, e.pose, { k });
  }
  if (ex.t < seg.dur - 1e-9) return { status: 'running', phase: `${seg.who}:${seg.phase}` };
  if (seg.phase === 'take') {
    // the new pair has it: the previous one lets go
    const prev = ex.holders === 'givers' ? ex.p.givers : ex.holders === 'relay' ? ex.p.relay ?? [] : [];
    release(rt, prev);
    ex.holders = seg.who;
    e.support = { kind: 'held', by: [...(seg.who === 'relay' ? ex.p.relay! : ex.p.receivers)] };
  }
  ex.si++;
  ex.t = 0;
  if (ex.si < prog.segs.length) return { status: 'running', phase: `${seg.who}:${seg.phase}` };
  e.pose = { ...prog.final, p: [...prog.final.p] as Vec3, yaw: ex.p.to.yaw }; // (the same box: set down with the heading asked for)
  }
  if (prog.fasten.length) {
    // screwed down where it lies (install_plywood's aloft fastening: 3 s, everyone within reach)
    if (ex.t2 === undefined) {
      ex.t2 = 0;
      release(rt, ex.p.receivers);
      e.pose = { ...prog.final, p: [...prog.final.p] as Vec3, yaw: ex.p.to.yaw }; // (the same box: set down with the heading asked for)
      e.phase = 'staged';
      e.support = { kind: 'resting-on', on: prog.rest.on };
    }
    ex.t2 += dt;
    for (const a of prog.fasten) { Object.assign(w.entities[a].human!, { activity: 'fasten', task: ex.id, grip: { entity: e.id, slot: 'fasten' } }); setHands(w.entities[a], undefined); }
    if (ex.t2 < FASTEN_S - 1e-9) return { status: 'running', phase: 'fasten' };
    e.phase = 'installed';
    e.connections = prog.rest.supports.map((sid) => ({ socket: 'bears-on', to: sid, toSocket: 'deck' }));
    release(rt, prog.fasten);
    spatialOf(rt);
    return { status: 'completed', outputs: { part: e.id, at: [...e.pose.p], supports: prog.rest.supports, heights: prog.heights, installed: true } };
  }
  e.phase = 'staged';
  e.support = { kind: 'resting-on', on: prog.rest.on };
  release(rt, ex.p.receivers);
  spatialOf(rt);
  return { status: 'completed', outputs: { part: e.id, at: [...e.pose.p], supports: prog.rest.supports, heights: prog.heights } };
}

export const passUp: ActionDef<PP, PassUpProgram, Exec> = {
  verb: 'pass_up',
  description: `Pass a sheet / rail / solar panel up to a given level: 1–2 givers raise it overhead outside the edge (underside ≤ their floor + ${GIVE_MAX} m), an optional relay kneeling on a deck below takes it and raises it again, 1–2 receivers already at their stations up top take it (≤ ${REACH_DOWN} m below their feet), lift it just above the members and feed it in, staged for install_*.`,
  schema: z.strictObject({
    part: z.string().max(80),
    to: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), yaw: z.number().min(-10).max(10), height: z.number().min(0).max(20) }),
    edge: z.number().min(-1e4).max(1e4),
    out: z.strictObject({ x: z.number().min(-1).max(1), z: z.number().min(-1).max(1) }),
    givers: z.array(z.string().max(80)).min(1).max(2),
    relay: z.array(z.string().max(80)).min(1).max(2).optional(),
    receivers: z.array(z.string().max(80)).min(1).max(2),
    give: z.number().min(0.05).max(2.1).optional(),
    push: z.boolean().optional(),
    side: z.boolean().optional(),
    follow: z.boolean().optional(),
    relayAt: z.array(z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), level: z.number().int().min(0).max(40) })).min(1).max(2).optional(),
    receiverAt: z.array(z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), level: z.number().int().min(0).max(40), kneel: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4) }).optional() })).min(1).max(2).optional(),
    fasten: z.array(z.strictObject({ actor: z.string().max(80), at: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), level: z.number().int().min(0).max(40) }).optional() })).max(2).optional(),
  }),
  reservations: (_w, p) => [...[...new Set([...p.givers, ...(p.relay ?? []), ...p.receivers, ...(p.fasten ?? []).map((f) => f.actor)])].map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.part}`, mode: 'exclusive' }],
  resumable: 'pass_up drives child walks and holds a load in the air between crews; its exec is not serialised',
  plan: planPassUp,
  start: (_rt, p, prog, id) => ({ id, p, prog, si: -1, t: 0, holders: null }),
  step: stepPassUp,
  cancel(rt, ex) {
    const e = rt.world.entities[ex.p.part];
    if (e?.phase === 'carried') return { ok: false, diagnostic: { code: 'passup.cancel-unsafe', message: `${e.id} is in the air between the crews; it cannot be abandoned`, subjects: [e.id] } };
    for (const r of ex.walk?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    release(rt, [...ex.p.givers, ...(ex.p.relay ?? []), ...ex.p.receivers].filter((a) => rt.world.entities[a]?.human?.task === ex.id));
    return { ok: true };
  },
};
