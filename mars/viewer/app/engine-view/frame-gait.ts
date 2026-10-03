// Poses on the rack structure (owner feedback §5/§7, HANDUP.md, YEAR_BUILD.md): where the hands and
// feet of someone climbing a frame, standing on its bracing, or walking a beam go. Pure TS (no
// three.js), a function of the engine's body point and the frame's pose — renderers only read.
//
// * LADDER (climb-up / climb-down): on a W2 `climb:` link (up the frame's outside face, beside the
//   column) or a year-build frame stance (`stance:…`, up beside the column, round it onto the face).
//   The climber faces the frame: the hold line is the frame plane point in front of the climb axis
//   (clamped between the columns, so a climber beside a column holds the column). Feet on rungs of a
//   0.35 m pitch from the ground (0.25 m first — the Kit frame's lowest bracing node, then half its
//   0.7 m node pitch), hands on the hold line HAND_UP above the opposite foot, a diagonal
//   two-hand-two-foot ladder cycle: a limb is planted for most of a two-rung cycle and moves up two
//   rungs in the rest (the stair gait's timing, stair-gait.ts), hands a quarter cycle ahead of the
//   opposite foot. A pure function of the body height, so climbing down is the same motion reversed,
//   locked to the rung pitch at any engine speed. No IK to the rendered bracing rods.
// * STANCE (on `stance:…`, not climbing): feet on the bracing node in front of the body point (the
//   frame plane, the body 0.36 m off it — a ladder stance), free hands on the column and the bracing.
// * BEAM (activity beam-walk): arms held out to the sides for balance (short steps: humans.ts).
import type { Entity } from '../../engine/world/types.ts';
import { parseStance, stanceGeo } from '../../engine/construction/stance.ts';
import { seatPoint } from '../../engine/construction/rules.ts';
import { CATALOG } from '../../engine/world/catalog.ts';

export type V3 = [number, number, number];
type V2 = [number, number];

/** Ladder rung pitch (m) and the first rung above the ground (the Kit frame's lowest bracing node). */
export const RUNG = 0.35, FIRST_RUNG = 0.25;
/** Hands this far (m) above the rung of the opposite foot: the climber's pelvis sits ~0.3 m low (feet on the frame ahead), so ≈ 0.2 m above the shoulders. */
export const HAND_UP = 1.2;
/** Share of a two-rung cycle a limb is moving (stair-gait SWING). */
const SWING = 0.8;
/** Hands move this much of a rung ahead of the opposite foot. */
const HAND_LEAD = 0.5;
const FOOT_LAT = 0.1, HAND_LAT = 0.14, ON_PLANE = 0.08;

export type Ladder = {
  kind: 'ladder';
  /** Climb axis (x, z): where the body point rises. */
  axis: V2;
  /** Hold line (x, z) on the frame in front of the climber, and the unit direction axis → hold. */
  hold: V2;
  dir: V2;
  ground: number;
  top: number;
  /** Where the body goes after the vertical part (x, z) at `top`, and the stance there (feet / holds), if any. */
  exit: V2;
  stance: Stance | null;
};
export type Stance = { kind: 'stance'; y: number; facing: number; feet: V2; right: V2; holds: [V3, V3] };
export type FrameCtx = Ladder | Stance | { kind: 'beam' };

export type Limb = { p: V3; planted: boolean };
export type FramePose = {
  kind: 'ladder' | 'stance' | 'beam';
  /** Rendered facing (engine yaw convention), or null to keep the engine's yaw. */
  facing: number | null;
  /** Soles [left, right] (world; y = sole height), or null = the clip's legs. */
  feet: [Limb, Limb] | null;
  /** Hand holds [left, right] (world), used only when the engine publishes no hand points. */
  hands: [V3 | null, V3 | null];
  /** Ladder: rung coordinate of the body (0 = ground); 1 while at the top. */
  u: number;
  /** How far along the move from the climb axis to the exit (0 … 1). */
  exit: number;
  /** 0 … 1: how much this layer replaces the clip (a ladder ramps in over the first 0.2 m of the climb). */
  weight: number;
};

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const yawOf = (d: V2) => Math.atan2(d[1], d[0]);

/** Engine yaw rotation of (x, z): x' = x cos − z sin, z' = x sin + z cos. */
function rot(v: V2, yaw: number): V2 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

/** The frame plane point in front of `p` (projection along the frame normal), clamped between the columns. */
function planePoint(u: Entity, p: V2): V2 {
  const depth = CATALOG[u.def]?.size[0] ?? 0.91;
  const c: V2 = [u.pose.p[0], u.pose.p[2]];
  const e = rot([1, 0], u.pose.yaw);
  const d = sub(p, c);
  const across = Math.max(-depth / 2, Math.min(depth / 2, d[0] * e[0] + d[1] * e[1]));
  return [c[0] + e[0] * across, c[1] + e[1] * across];
}

function stanceAt(u: Entity, ref: NonNullable<ReturnType<typeof parseStance>>): Stance {
  const g = stanceGeo(u, ref);
  const f = rot([1, 0], g.facing), right: V2 = [-f[1], f[0]];
  const plane = planePoint(u, g.body);
  const toPlane = len(sub(plane, g.body));
  // feet: on the bracing node in the frame plane, ankles ON_PLANE behind it
  const k = Math.max(0, toPlane - ON_PLANE);
  const feet: V2 = [g.body[0] + f[0] * k, g.body[1] + f[1] * k];
  const sp = seatPoint(u, ref.col === 'l' ? -1 : 1, 0);
  const col: V3 = [sp[0], g.y + 1.3, sp[2]];
  // the other hand on the bracing in front of the body, toward the middle of the frame
  const mid = planePoint(u, [u.pose.p[0], u.pose.p[2]]);
  const inward = sub(mid, plane), il = len(inward) || 1;
  const brace: V3 = [plane[0] + (inward[0] / il) * 0.25, g.y + 1.1, plane[1] + (inward[1] / il) * 0.25];
  // left / right from where they are
  const side = (q: V3) => (q[0] - g.body[0]) * right[0] + (q[2] - g.body[1]) * right[1];
  const holds: [V3, V3] = side(col) < side(brace) ? [col, brace] : [brace, col];
  return { kind: 'stance', y: g.y, facing: g.facing, feet, right, holds };
}

/**
 * What the rack structure does to this person's pose, or null: `on` = engine human.on, `activity`,
 * `get` = entity lookup (the frame), `links` = the scene's climb links (W2 `climb:` paths).
 */
export function frameCtx(on: string | undefined, activity: string, get: (id: string) => Entity | undefined, links: { id: string; path: [number, number, number][] }[]): FrameCtx | null {
  if (activity === 'beam-walk') return { kind: 'beam' };
  if (!on) return null;
  const climbing = activity === 'climb-up' || activity === 'climb-down';
  const st = parseStance(on);
  if (st) {
    const u = get(st.upright);
    if (!u || !CATALOG[u.def]) return null;
    const stance = stanceAt(u, st);
    if (!climbing) return stance;
    const g = stanceGeo(u, st);
    const hold = planePoint(u, g.foot);
    const d = sub(hold, g.foot), dl = len(d) || 1;
    return { kind: 'ladder', axis: g.foot, hold, dir: [d[0] / dl, d[1] / dl], ground: g.groundY, top: g.y, exit: g.body, stance };
  }
  const m = /^climb:(.+):([lr])@/.exec(on);
  if (m && climbing) {
    const link = links.find((l) => l.id === on);
    const u = get(m[1]);
    if (!link || !u || link.path.length < 3) return null;
    const p = link.path;
    const axis: V2 = [p[0][0], p[0][2]];
    const hold = planePoint(u, axis);
    const d = sub(hold, axis), dl = len(d) || 1;
    const last = p[p.length - 1];
    return { kind: 'ladder', axis, hold, dir: [d[0] / dl, d[1] / dl], ground: p[0][1], top: p[1][1], exit: [last[0], last[2]], stance: null };
  }
  return null;
}

/** Rung height above the ground of spot k (0 = the ground; clamped to the top). */
function spotY(k: number, top: number) {
  return k <= 0 ? 0 : Math.min(top, FIRST_RUNG + RUNG * (k - 1));
}

/** Limb of parity `par` at rung coordinate u: [height above the ground, planted]. */
function limb(u: number, par: number, top: number): [number, boolean] {
  let k = 2 * Math.floor((u + 1.5 - SWING - par) / 2) + par;
  if (u <= k + 0.5) return [spotY(k, top), true];
  const t = clamp01((u - (k + 0.5)) / SWING);
  const a = spotY(k, top), b = spotY(k + 2, top);
  const up = b >= a ? Math.sin((t * Math.PI) / 2) : 1 - Math.cos((t * Math.PI) / 2);
  k += 2;
  return [a + (b - a) * up + 0.05 * Math.sin(t * Math.PI), false];
}

/** Rung coordinate of a body `h` m above the ground (inverse of spotY for the body's feet level). */
function rungOf(h: number) {
  return h <= FIRST_RUNG ? h / FIRST_RUNG : 1 + (h - FIRST_RUNG) / RUNG;
}

/** Most a person on a stance turns on the rod toward a load in their hands (rad, either way). */
export const STANCE_TURN = 1.75;

/**
 * Rendered facing of a person on a stance: toward the frame, turned on the rod toward the midpoint of
 * their engine hand points (a beam passing beside them, 0.3 m + the 0.457 m stage axis out from the
 * column) by up to STANCE_TURN. The feet stay on the node. null = no load.
 */
export function stanceFacing(s: Stance, body: V2, hands: V3[]): number | null {
  if (!hands.length) return null;
  const mx = hands.reduce((a, h) => a + h[0], 0) / hands.length - body[0], mz = hands.reduce((a, h) => a + h[2], 0) / hands.length - body[1];
  if (Math.hypot(mx, mz) < 0.15) return null;
  const d = Math.atan2(mz, mx) - s.facing, turn = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return s.facing + Math.max(-STANCE_TURN, Math.min(STANCE_TURN, turn));
}

/** Pose for a body point `p` (world, interpolated), its engine yaw and engine hand points (a load held). */
export function framePose(ctx: FrameCtx, p: V3, yaw: number, hands: V3[] = []): FramePose {
  if (ctx.kind === 'beam') {
    const f = rot([1, 0], yaw), r: V2 = [-f[1], f[0]];
    // arms a little out and down (hands ~0.35 m below the shoulders, 0.45 m out from the body axis)
    const out = (s: number): V3 => [p[0] + r[0] * s * 0.45 + f[0] * 0.1, p[1] + 0.98, p[2] + r[1] * s * 0.45 + f[1] * 0.1];
    return { kind: 'beam', facing: null, feet: null, hands: [out(-1), out(1)], u: 0, exit: 0, weight: 1 };
  }
  if (ctx.kind === 'stance') return stancePose(ctx, stanceFacing(ctx, [p[0], p[2]], hands));
  // ladder: vertical climb on the axis, then the move to the exit at the top (feet finish onto the top rung)
  const exitLen = len(sub(ctx.exit, ctx.axis));
  const t = exitLen > 1e-6 ? clamp01(len(sub([p[0], p[2]], ctx.axis)) / exitLen) : 0;
  const onTop = p[1] >= ctx.top - 1e-3;
  const h = Math.max(0, Math.min(ctx.top, p[1]) - ctx.ground), topU = rungOf(ctx.top - ctx.ground);
  const u = rungOf(h) + (onTop ? 2 * t : 0);
  const facing = yawOf(ctx.dir);
  const f = ctx.dir, r: V2 = [-f[1], f[0]];
  const at = (lat: number, y: number, inset: number): V3 => [ctx.hold[0] - f[0] * inset + r[0] * lat, ctx.ground + y, ctx.hold[1] - f[1] * inset + r[1] * lat];
  const top = ctx.top - ctx.ground;
  const fl = limb(u, 1, top), fr = limb(u, 0, top);
  // hands: the opposite foot's rung + HAND_UP, HAND_LEAD rungs ahead (diagonal gait)
  const hl = limb(u + HAND_LEAD, 0, top + 2), hr = limb(u + HAND_LEAD, 1, top + 2);
  const handY = (q: [number, boolean]) => Math.min(q[0] + HAND_UP, top + HAND_UP);
  const ladder: FramePose = {
    kind: 'ladder',
    facing,
    feet: [{ p: at(-FOOT_LAT, fl[0], ON_PLANE), planted: fl[1] }, { p: at(FOOT_LAT, fr[0], ON_PLANE), planted: fr[1] }],
    hands: [at(-HAND_LAT, handY(hl), 0.03), at(HAND_LAT, handY(hr), 0.03)],
    u: Math.min(u, topU + 2),
    exit: t,
    weight: (() => { const q = clamp01(h / 0.2); return q * q * (3 - 2 * q); })(),
  };
  if (!onTop || t <= 0) return ladder;
  // the move onto the stance / beam end: feet, hands and facing blend over the horizontal travel
  const w = t * t * (3 - 2 * t);
  if (ctx.stance) {
    const s = stancePose(ctx.stance);
    const mix = (a: V3, b: V3): V3 => [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)];
    return {
      kind: 'ladder',
      facing: facing + (((s.facing! - facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * w,
      feet: [{ p: mix(ladder.feet![0].p, s.feet![0].p), planted: ladder.feet![0].planted }, { p: mix(ladder.feet![1].p, s.feet![1].p), planted: ladder.feet![1].planted }],
      hands: [mix(ladder.hands[0]!, s.hands[0]!), mix(ladder.hands[1]!, s.hands[1]!)],
      u: ladder.u,
      exit: t,
      weight: 1,
    };
  }
  // onto a beam end: the clip's legs take over as the body steps off the frame
  return { ...ladder, feet: w < 0.5 ? ladder.feet : null, hands: w < 0.7 ? ladder.hands : [null, null] };
}

function stancePose(s: Stance, turned: number | null = null): FramePose {
  // feet side by side across the rendered facing (so a body turned on the rod does not cross its legs)
  const f = turned ?? s.facing, r: V2 = [-Math.sin(f), Math.cos(f)];
  const foot = (lat: number): V3 => [s.feet[0] + r[0] * lat, s.y, s.feet[1] + r[1] * lat];
  return { kind: 'stance', facing: f, feet: [{ p: foot(-FOOT_LAT), planted: true }, { p: foot(FOOT_LAT), planted: true }], hands: [s.holds[0], s.holds[1]], u: 0, exit: 1, weight: 1 };
}
