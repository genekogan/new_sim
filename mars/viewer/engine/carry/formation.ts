// Coordinated-carry formation model (spec §11). A crew of 1–4 people and the
// load they hold move as ONE rigid formation. The formation frame is SE(2):
// origin = load centre on the ground plane, +x ("along") = the load's long
// axis = direction of travel, +z ("lat") = rot2([0, 1], θ).
//
// Everything here is pure geometry derived from the asset catalog's handling
// data, so planner, action, invariant and tests agree on where the load and
// each carrier are for a given formation pose.
import { datan2, dcos, dist2, dsin, rot2, type Vec2, type Vec3 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Entity, Pose } from '../world/types.ts';
import { def, HUMAN_RADIUS, type AssetDef } from '../world/catalog.ts';

export const CARRIER_RADIUS = HUMAN_RADIUS; // 0.28 m
/** Horizontal distance from a carrier's body centre to the load edge they grip (m). */
export const REACH = 0.35;
/** Sustained two-handed carrying load per person (kg); provisional, spec §7 "no absurd carries". */
export const MAX_KG_PER_CARRIER = 30;

export type SE2 = { x: number; z: number; th: number };
export type Orientation = { pitch: number; roll: number };
export type Disc = { c: Vec2; r: number; part: 'load' | 'carrier'; carrier?: number };
export type CarrierSlot = { slot: string; along: number; side: 1 | -1 };

export type Formation = {
  defId: string;
  crew: number;
  name: string; // "12 ft beam"
  massKg: number;
  /** Carried load box in the formation frame. */
  length: number;
  width: number;
  height: number;
  carryHeight: number;
  carry: Orientation;
  lay: Orientation;
  carriers: CarrierSlot[];
  /** Conservative disc cover of the load rectangle + carrier body discs (formation frame). */
  discs: Disc[];
  loadDiscR: number;
  loadDiscSpacing: number;
  /** Max distance of any disc boundary from the formation origin (bounds swept displacement under rotation). */
  extent: number;
};

/** Index of the local axis that becomes the long (travel) axis: uprights lie on their height. */
export const longAxis = (d: AssetDef) => (d.category === 'rack-upright' ? 1 : 0);

/** Rotate a local vector by roll (about Z) then pitch (about X) — same order as `entityCorners`. */
export function rotRP(v: Vec3, o: Orientation): Vec3 {
  const cr = dcos(o.roll), sr = dsin(o.roll), cp = dcos(o.pitch), sp = dsin(o.pitch);
  const X = v[0] * cr - v[1] * sr, Y = v[0] * sr + v[1] * cr, Z = v[2];
  return [X, Y * cp - Z * sp, Y * sp + Z * cp];
}

/** Local point → world point for an entity pose (yaw about +Y after roll/pitch). */
export function toWorld(pose: Pose, v: Vec3): Vec3 {
  const [X, Y, Z] = rotRP(v, { pitch: pose.pitch ?? 0, roll: pose.roll ?? 0 });
  const w = rot2([X, Z], pose.yaw);
  return [pose.p[0] + w[0], pose.p[1] + Y, pose.p[2] + w[1]];
}

/**
 * Orientation that puts the long axis along +X (formation "along") with the
 * requested cross-section face vertical: 'edge' = larger cross dimension
 * vertical, 'flat' = smaller cross dimension vertical.
 */
export function orientationFor(d: AssetDef, pose: 'flat' | 'edge'): Orientation {
  const [sx, sy, sz] = d.size;
  if (longAxis(d) === 1) {
    // roll −π/2 maps local y → +X, local x → −Y (vertical), local z → Z.
    const xVertical = pose === 'edge' ? sx >= sz : sx < sz;
    return xVertical ? { pitch: 0, roll: -Math.PI / 2 } : { pitch: Math.PI / 2, roll: -Math.PI / 2 };
  }
  const yVertical = pose === 'edge' ? sy >= sz : sy < sz;
  return yVertical ? { pitch: 0, roll: 0 } : { pitch: -Math.PI / 2, roll: 0 };
}

/** Human-legible short name: "19 ft upright", "12 ft beam", "8 ft 2x4", "4x8 plywood sheet", "4x6 plywood sheet". */
export function shortName(defId: string): string {
  let m = /^upright-(\d+)ft$/.exec(defId);
  if (m) return `${m[1]} ft upright`;
  m = /^beam-(\d+)ft$/.exec(defId);
  if (m) return `${m[1]} ft beam`;
  m = /^2x4-(\d+)ft$/.exec(defId);
  if (m) return `${m[1]} ft 2x4`;
  m = /^plywood-(\d+x\d+)$/.exec(defId);
  if (m) return `${m[1]} plywood sheet`;
  return def(defId).label;
}

/** Crew-size and load checks (spec §7 "a six-foot human cannot casually carry a nineteen-foot frame alone"). */
export function checkCrew(defId: string, n: number, itemId?: string): Diagnostic | null {
  const d = def(defId);
  const h = d.handling;
  const name = shortName(defId);
  const L = d.size[longAxis(d)];
  const who = itemId ? [itemId] : [];
  if (!h) return { code: 'carry.not-carriable', message: `the ${name} has no handling definition; it cannot be carried`, subjects: who };
  const byMass = Math.ceil(d.massKg / MAX_KG_PER_CARRIER);
  const need = Math.max(h.carryCrew[0], byMass);
  if (n < need) {
    const why = byMass > h.carryCrew[0] ? ` at ≤ ${MAX_KG_PER_CARRIER} kg per person` : ` (handling minimum for a ${L.toFixed(1)} m load)`;
    return {
      code: 'carry.crew-too-small',
      message: `the ${name} (${d.massKg} kg, ${L.toFixed(1)} m) needs at least ${need} carriers${why}; ${n} assigned`,
      subjects: who,
      details: { need, assigned: n, massKg: d.massKg, length: L },
    };
  }
  if (n > h.carryCrew[1])
    return {
      code: 'carry.crew-too-large',
      message: `the ${name} has grip room for at most ${h.carryCrew[1]} carriers; ${n} assigned`,
      subjects: who,
      details: { max: h.carryCrew[1], assigned: n },
    };
  if (!h.grips[n]) return { code: 'carry.no-grips', message: `the ${name} defines no grip layout for a crew of ${n}`, subjects: who };
  return null;
}

/** Build the formation for an asset and crew size (assumes `checkCrew` passed). */
export function formationFor(defId: string, n: number): Formation {
  const d = def(defId);
  const h = d.handling!;
  const ax = longAxis(d);
  const carry = orientationFor(d, h.carryPose);
  const lay = orientationFor(d, 'flat');
  // carried box extents in the formation frame
  const [sx, sy, sz] = d.size;
  const cLocal: Vec3 = [0, sy / 2, 0];
  let W = 0, H = 0;
  for (const x of [-sx / 2, sx / 2]) for (const y of [0, sy]) for (const z of [-sz / 2, sz / 2]) {
    const r = rotRP([x - cLocal[0], y - cLocal[1], z - cLocal[2]], carry);
    W = Math.max(W, 2 * Math.abs(r[2]));
    H = Math.max(H, 2 * Math.abs(r[1]));
  }
  const L = d.size[ax];
  const cR = rotRP(cLocal, carry);
  const carriers: CarrierSlot[] = h.grips[n].map((g, i) => {
    const r = rotRP(g.local, carry);
    const along = r[0] - cR[0];
    const lat = r[2] - cR[2];
    // centreline grips are taken at the load edge on the carrier's side; sides alternate by slot
    const side: 1 | -1 = Math.abs(lat) > 0.05 ? (lat > 0 ? 1 : -1) : i % 2 === 0 ? 1 : -1;
    return { slot: g.id, along, side };
  });
  // disc cover of the load rectangle: rows ≤ 0.6 m wide, along-spacing ≤ 0.5 m
  const rows = Math.max(1, Math.ceil(W / 0.6));
  const w = W / (2 * rows);
  const sTarget = Math.min(0.5, Math.max(0.2, 2 * w));
  const nAlong = Math.max(1, Math.ceil(L / sTarget));
  const s = L / nAlong;
  const rho = Math.hypot(w, s / 2);
  const discs: Disc[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < nAlong; i++) discs.push({ c: [-L / 2 + s * (i + 0.5), -W / 2 + w * (2 * j + 1)], r: rho, part: 'load' });
  carriers.forEach((c, i) => discs.push({ c: [c.along, c.side * (W / 2 + REACH)], r: CARRIER_RADIUS, part: 'carrier', carrier: i }));
  const extent = Math.max(...discs.map((q) => Math.hypot(q.c[0], q.c[1]) + q.r));
  return {
    defId, crew: n, name: shortName(defId), massKg: d.massKg, length: L, width: W, height: H, carryHeight: h.carryHeight,
    carry, lay, carriers, discs, loadDiscR: rho, loadDiscSpacing: s, extent,
  };
}

/** Body positions of the carriers at a formation pose. `halfW` = half-width of the load cross-section they stand beside. */
export function carrierSpots(f: Formation, q: SE2, halfW = f.width / 2): Vec2[] {
  return f.carriers.map((c) => {
    const o = rot2([c.along, c.side * (halfW + REACH)], q.th);
    return [q.x + o[0], q.z + o[1]];
  });
}

/** Grip points (hands on the load edge) at carry height. */
export function gripPoints(f: Formation, q: SE2, levelY: number): Vec3[] {
  return f.carriers.map((c) => {
    const o = rot2([c.along, (c.side * f.width) / 2], q.th);
    return [q.x + o[0], levelY + f.carryHeight, q.z + o[1]];
  });
}

/** Entity pose whose box centre is at (q.x, q.z) with long axis along q.th, for a given orientation. */
export function poseAt(defId: string, o: Orientation, q: SE2, y: { centre?: number; bottom?: number }): Pose {
  const d = def(defId);
  const [sx, sy, sz] = d.size;
  const trial: Pose = { p: [0, 0, 0], yaw: q.th, pitch: o.pitch, roll: o.roll };
  let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity, az = Infinity, bz = -Infinity;
  for (const x of [-sx / 2, sx / 2]) for (const yy of [0, sy]) for (const z of [-sz / 2, sz / 2]) {
    const w = toWorld(trial, [x, yy, z]);
    ax = Math.min(ax, w[0]); bx = Math.max(bx, w[0]);
    ay = Math.min(ay, w[1]); by = Math.max(by, w[1]);
    az = Math.min(az, w[2]); bz = Math.max(bz, w[2]);
  }
  const py = y.bottom !== undefined ? y.bottom - ay : (y.centre ?? 0) - (ay + by) / 2;
  const pose: Pose = { p: [q.x - (ax + bx) / 2, py, q.z - (az + bz) / 2], yaw: q.th };
  if (o.pitch) pose.pitch = o.pitch;
  if (o.roll) pose.roll = o.roll;
  return pose;
}

export const carriedPose = (f: Formation, q: SE2, levelY: number) => poseAt(f.defId, f.carry, q, { centre: levelY + f.carryHeight });
export const laidPose = (f: Formation, q: SE2, levelY: number) => poseAt(f.defId, f.lay, q, { bottom: levelY });

/** Formation pose (centre + long-axis heading) and lateral half-width of an entity as it currently lies. */
export function entityFrame(e: Entity): { q: SE2; halfW: number; bottom: number; top: number } {
  const d = def(e.def);
  const ax = longAxis(d);
  const [sx, sy, sz] = d.size;
  const a0 = toWorld(e.pose, [0, 0, 0]);
  const unit: Vec3 = ax === 1 ? [0, 1, 0] : [1, 0, 0];
  const a1 = toWorld(e.pose, unit);
  const th = datan2(a1[2] - a0[2], a1[0] - a0[0]);
  const pts: Vec3[] = [];
  for (const x of [-sx / 2, sx / 2]) for (const y of [0, sy]) for (const z of [-sz / 2, sz / 2]) pts.push(toWorld(e.pose, [x, y, z]));
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0] / 8; cz += p[2] / 8; }
  const lat = rot2([0, 1], th);
  let halfW = 0, bottom = Infinity, top = -Infinity;
  for (const p of pts) {
    halfW = Math.max(halfW, Math.abs((p[0] - cx) * lat[0] + (p[2] - cz) * lat[1]));
    bottom = Math.min(bottom, p[1]);
    top = Math.max(top, p[1]);
  }
  return { q: { x: cx, z: cz, th }, halfW, bottom, top };
}

/** Largest grip error (m) between actual carrier positions and slot-derived positions. */
export function gripError(f: Formation, q: SE2, actual: Vec2[]): { max: number; carrier: number } {
  const want = carrierSpots(f, q);
  let max = 0, carrier = -1;
  want.forEach((w, i) => {
    const e = dist2(w, actual[i]);
    if (e > max) { max = e; carrier = i; }
  });
  return { max, carrier };
}

/** World-space disc centres at a formation pose. */
export function worldDiscs(f: Formation, q: SE2): { p: Vec2; d: Disc }[] {
  const c = dcos(q.th), s = dsin(q.th);
  return f.discs.map((d) => ({ p: [q.x + d.c[0] * c - d.c[1] * s, q.z + d.c[0] * s + d.c[1] * c] as Vec2, d }));
}
