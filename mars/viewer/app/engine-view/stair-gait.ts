// Stair gait (owner feedback §4): where each foot is on a flight of stairs, as a pure function of
// the body's progress along the flight. Pure TS (no three.js), node-testable.
//
// A flight comes from an engine stairs Link: `path` runs bottom → top through the tread centres at
// tread-top height (construction/stairs.ts: approach, foot, tread 1…N, top, approach; the proving
// ground's straight flights: ground, tread 1…15, deck edge). Treads = the interior path points
// strictly between the bottom and top heights. Foot spots are indexed k: k = 1…N are the treads,
// k ≤ 0 the floor before the flight and k ≥ N+1 the landing, one `going` apart.
//
// The body's tread coordinate u = 1 + (s − s₁)/going (s = distance along the flight axis). One tread
// per step, feet alternating (left on odd spots, right on even): the foot on spot k is planted for
// u ∈ [k − 1.5 + SWING, k + 0.5] and swings k → k + 2 for u ∈ [k + 0.5, k + 0.5 + SWING]. Because it
// is a function of u alone, descending is the same motion played backwards (the swing foot then stays
// high and drops onto the lower tread) and cadence is locked to tread pitch at any engine speed.
import type { Link } from '../../engine/spatial/types.ts';

/** Fraction of a two-tread cycle one foot spends in the air (in u units; stance = 2 − SWING). */
export const SWING = 0.8;
/** Swing-foot clearance over the tread it passes (m, sole). */
export const CLEAR = 0.07;

export type Flight = {
  id: string;
  /** Axis origin (x, z) = the path's first point, and unit direction bottom → top. */
  o: [number, number];
  dir: [number, number];
  /** Tread centres along the axis (s, m) and tread-top heights (y), bottom first. */
  treads: { s: number; y: number }[];
  going: number;
  width: number;
  yBottom: number;
  yTop: number;
  /** Actual mesh support extents, when independently proven. Path-only flights retain their existing gait. */
  supports?: {s:number;y:number;lo:number;hi:number;left:number;right:number}[];
  /** Actual horizontal contact triangles in flight coordinates [s, worldY, lateral]. */
  contactTops?: [number,number,number][][];
};

export function flightOf(link: Link): Flight | null {
  if (link.kind !== 'stairs' || !link.usable || link.path.length < 3) return null;
  const p = link.path, a = p[0], b = p[p.length - 1];
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
  if (L < 0.3) return null;
  const dir: [number, number] = [dx / L, dz / L];
  const y0 = a[1], y1 = b[1], eps = 0.01;
  const treads = p
    .filter((q) => q[1] > Math.min(y0, y1) + eps && q[1] < Math.max(y0, y1) - eps)
    .map((q) => ({ s: (q[0] - a[0]) * dir[0] + (q[2] - a[2]) * dir[1], y: q[1] }))
    .sort((m, n) => m.s - n.s);
  if (treads.length < 2) return null;
  const gs = treads.slice(1).map((t, i) => t.s - treads[i].s).sort((m, n) => m - n);
  const going = gs[Math.floor(gs.length / 2)];
  if (!(going > 0.05)) return null;
  return { id: link.id, o: [a[0], a[2]], dir, treads, going, width: link.width, yBottom: y0, yTop: y1 };
}

/** Foot spot k: axis position and support height (floor / tread top / landing). */
export function spot(f: Flight, k: number): { s: number; y: number } {
  const n = f.treads.length;
  if (k <= 0) return { s: f.treads[0].s + (k - 1) * f.going, y: f.yBottom };
  if (k > n) return { s: f.treads[n - 1].s + (k - n) * (f.supports&&n>1?f.treads[n-1].s-f.treads[n-2].s:f.going), y: f.yTop };
  return f.treads[k - 1];
}

export type FootState = {
  /** Axis position (m) and sole height (m) of the foot. */
  s: number;
  y: number;
  planted: boolean;
  /** Spot the foot stands on (planted) or is swinging to. */
  k: number;
  /** Support height of that spot (the tread top the sole must meet at plant time). */
  top: number;
};

export type Gait = {
  u: number;
  /** Axis position of the body. */
  s: number;
  /** Lateral offset of the body from the axis (m, + = right of the ascent direction, engine r = (−sin yaw, cos yaw)). */
  lateral: number;
  /** 0…1: how much the stair gait replaces the clip's legs (ramps in/out one tread before/after the flight). */
  weight: number;
  /** [left, right]. */
  feet: [FootState, FootState];
};

const floorDiv = (a: number, b: number) => Math.floor(a / b);

/** Foot on spot parity `par` (1 = odd spots = left, 0 = even = right) at body coordinate u. */
function footAt(f: Flight, u: number, par: number): FootState {
  // the planted spot k (parity par) whose stance window [k − 1.5 + SWING, k + 0.5] contains u, else swinging
  // from k to k + 2 when u ∈ (k + 0.5, k + 0.5 + SWING)
  let k = 2 * floorDiv(u + 1.5 - SWING - par, 2) + par; // latest spot of this parity with plant time ≤ u
  // plant time of k is k − 1.5 + SWING ≤ u; its lift time is k + 0.5
  if (u <= k + 0.5) {
    const q = spot(f, k);
    return { s: q.s, y: q.y, planted: true, k, top: q.y };
  }
  // swinging k → k + 2 (u in (k + 0.5, k + 0.5 + SWING) — k + 2's plant time)
  const t = Math.max(0, Math.min(1, (u - (k + 0.5)) / SWING));
  const a = spot(f, k), b = spot(f, k + 2), mid = spot(f, k + 1);
  const h = t * t * (3 - 2 * t); // horizontal: ease in/out
  const rise = b.y >= a.y ? Math.sin((t * Math.PI) / 2) : 1 - Math.cos((t * Math.PI) / 2); // up: rise early; down: stay high
  const base = a.y + (b.y - a.y) * rise;
  // clear the spot in between by CLEAR at mid-swing
  const need = Math.max(0, mid.y + CLEAR - (a.y + b.y) / 2);
  const y = base + Math.max(CLEAR * 0.6, need) * Math.sin(t * Math.PI);
  k += 2;
  return { s: a.s + (b.s - a.s) * h, y, planted: false, k, top: b.y };
}

/** Gait on flight `f` for a body at world (x, z); null when not near the flight. */
export function gaitAt(f: Flight, x: number, z: number, bodyY: number,envelope?:{reach:number;blend:number}): Gait | null {
  const rx = x - f.o[0], rz = z - f.o[1];
  const s = rx * f.dir[0] + rz * f.dir[1];
  const lateral = -rx * f.dir[1] + rz * f.dir[0];
  if (Math.abs(lateral) > f.width / 2 + 0.25) return null;
  const n = f.treads.length;
  let u = 1 + (s - f.treads[0].s) / f.going;
  if(f.supports){
    const next=f.treads.findIndex(t=>t.s>s);
    if(next>0){const a=f.treads[next-1],b=f.treads[next];u=next+(s-a.s)/(b.s-a.s);}
    else if(next<0)u=n+(s-f.treads[n-1].s)/(f.treads[n-1].s-f.treads[n-2].s);
  }
  const ramp = (v: number) => Math.max(0, Math.min(1, v));
  const sm = (w: number) => w * w * (3 - 2 * w);
  let contactWeight=0;
  if(f.supports&&envelope&&envelope.reach>0&&envelope.blend>0){
    const enter=f.supports[0].lo-envelope.reach,exit=f.supports[n-1].hi+envelope.reach;
    contactWeight=sm(ramp((s-enter+envelope.blend)/envelope.blend))*sm(ramp((exit+envelope.blend-s)/envelope.blend));
  }
  if ((u < -1 || u > n + 2)&&contactWeight<=0) return null;
  // the body must be on this flight's height band (not walking under or over it)
  const yAt = u <= 1 ? f.yBottom : u >= n ? f.yTop : spot(f, Math.floor(u)).y + (spot(f, Math.floor(u) + 1).y - spot(f, Math.floor(u)).y) * (u - Math.floor(u));
  if (Math.abs(bodyY - yAt) > 0.35) return null;
  const weight = ramp(u + 0.5) * ramp(n + 1.5 - u);
  return { u, s, lateral, weight: Math.max(sm(weight),contactWeight), feet: [footAt(f, u, 1), footAt(f, u, 0)] };
}

/** World (x, z) of an axis position `s` at lateral offset `lat` (+ = right of the ascent direction). */
export function axisPoint(f: Flight, s: number, lat: number): [number, number] {
  return [f.o[0] + f.dir[0] * s - f.dir[1] * lat, f.o[1] + f.dir[1] * s + f.dir[0] * lat];
}

/** Renderer target mapping: gait parity stays anatomical while the body's
 * facing determines which side of the ascent axis that anatomical foot occupies.
 * `spread` is the current rig's measured half stance width, never activity state.
 */
export function stairFootTarget(f: Flight, g: Gait, side: 'left' | 'right', spread: number, bodyYaw: number) {
  const alignment=Math.cos(bodyYaw)*f.dir[0]+Math.sin(bodyYaw)*f.dir[1];
  const facing = Math.sign(alignment) || 1;
  const foot = g.feet[side === 'left' ? 0 : 1];
  const stance=(side==='left'?-1:1)*Math.max(.08,Math.abs(spread));
  const rightAlong=-Math.sin(bodyYaw)*f.dir[0]+Math.cos(bodyYaw)*f.dir[1];
  const lat = g.lateral + stance * (f.supports?alignment:facing);
  // A measured approach can include the native turn on its landing. Rotate the
  // stance continuously rather than flipping both feet at cos(yaw)==0.
  const point = axisPoint(f, foot.s - 0.04 * (f.supports?alignment:facing)+(f.supports?stance*rightAlong:0), lat);
  return { foot, point, facing };
}
