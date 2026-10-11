// Humanoid body dims (core/humanoid@2 look params, eden4 humanoid lane L10). A humanoid body may carry a composed
// look (`body.params`, `body.model` = the look key `humanoid2-<sha16>`). Four of its params are physical:
//   height     m, 1.65–1.85 (default 1.75): the body scales uniformly by height / 1.75 — collision radius (half of
//              the effect, so doorways sized for today's bodies still pass), eye height and seat fit;
//   build      0.92–1.1 (default 1): girth — collision radius (and the drawn torso/hip/limb width);
//   walkSpeed  m/s, 0.9–1.4 (default 1.35): the walking speed walk_to plans with, never above WALK_SPEED_CAP 1.4
//              (so every tick stays inside MAX_HUMAN_STEP_PER_TICK and the published speed inside SPEED_CAPS.walk);
//   headSize   0.94–1.08 (default 1): drawn only.
// The ranges are kept narrow on purpose (Gene 2026-10-11: bodies vary subtly, not as caricatures).
// Every other param is paint. A body without params, or with all four at their defaults, is today's body exactly:
// `humanoidProfile` returns the HUMAN_PROFILE object itself and every dim equals today's constant, so worlds that
// never set a look plan, hash and move as before. The reach model (body/model.ts BODY_MODEL: shoulders, arms) is
// still the one 1.75 m body: hand targets do not scale (BODY_MODEL.md "Humanoid looks").
import type { Body, Entity } from '../world/types.ts';
import { HUMAN_PROFILE, type AgentProfile } from '../spatial/types.ts';

/** Ranges of the physical look params (the def core/humanoid@2 declares the same; humanoid-dims test asserts it). */
export const HUMANOID_DIM_RANGES = Object.freeze({
  height: [1.65, 1.85] as const,
  build: [0.92, 1.1] as const,
  walkSpeed: [0.9, 1.4] as const,
  headSize: [0.94, 1.08] as const,
});
export type HumanoidDimKey = keyof typeof HUMANOID_DIM_RANGES;
/** Today's body: the 1.75 m model, girth 1, HUMAN_PROFILE's 1.35 m/s, head 1. */
export const HUMANOID_DEFAULT_DIMS: Readonly<Record<HumanoidDimKey, number>> = Object.freeze({ height: 1.75, build: 1, walkSpeed: HUMAN_PROFILE.speed, headSize: 1 });
/** Today's constants the dims scale (radius: world/catalog HUMAN_RADIUS; eyes: edge/eyes/view.ts; seat range:
 *  social/pose.ts seatHeight 0.2–1.2 and the renderer's accepted seat tops). */
export const HUMANOID_BASE = Object.freeze({ radius: HUMAN_PROFILE.radius, height: HUMAN_PROFILE.height, eye: 1.62, seatedEye: 1.15, knee: 0.45, seatLo: 0.2, seatHi: 1.2 });
/** Collision radius bounds: a 0.9 m doorway still passes the widest body (2 × (0.32 + PLAN_MARGIN 0.06) = 0.76 m). */
export const HUMANOID_RADIUS_RANGE: readonly [number, number] = [0.24, 0.32];

export type HumanoidDims = {
  height: number; build: number; walkSpeed: number; headSize: number;
  /** height / 1.75: the uniform body scale (renderer and every length below). */
  scale: number;
  radius: number;
  /** Standing / seated eye height above the feet (m). */
  eyeHeight: number; seatedEyeHeight: number;
  /** Knee (seat) height: the def's `seat` landmark, scaled. */
  kneeHeight: number;
  /** Seat tops this body sits on (m above its feet): today's 0.2–1.2 scaled by `scale`. */
  seat: readonly [number, number];
  /** True when every dim is today's: the body is HUMAN_PROFILE exactly. */
  standard: boolean;
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const num = (p: Record<string, unknown> | undefined, k: HumanoidDimKey) => {
  const v = p?.[k];
  return typeof v === 'number' && Number.isFinite(v) && v >= HUMANOID_DIM_RANGES[k][0] && v <= HUMANOID_DIM_RANGES[k][1] ? v : HUMANOID_DEFAULT_DIMS[k];
};
const cache = new WeakMap<object, HumanoidDims>();
const STANDARD: HumanoidDims = Object.freeze(dimsOf(undefined));

/** Dims of a humanoid look's params (out-of-range or missing values read as today's). */
export function dimsOf(params: Record<string, unknown> | undefined): HumanoidDims {
  const height = num(params, 'height'), build = num(params, 'build'), walkSpeed = num(params, 'walkSpeed'), headSize = num(params, 'headSize');
  const scale = height / HUMANOID_DEFAULT_DIMS.height;
  const standard = height === HUMANOID_DEFAULT_DIMS.height && build === 1 && walkSpeed === HUMANOID_DEFAULT_DIMS.walkSpeed;
  const radius = standard ? HUMANOID_BASE.radius : r3(Math.min(HUMANOID_RADIUS_RANGE[1], Math.max(HUMANOID_RADIUS_RANGE[0], HUMANOID_BASE.radius * (0.5 + 0.5 * scale) * build)));
  return {
    height, build, walkSpeed, headSize, scale, radius,
    eyeHeight: r3(HUMANOID_BASE.eye * scale), seatedEyeHeight: r3(HUMANOID_BASE.seatedEye * scale), kneeHeight: r3(HUMANOID_BASE.knee * scale),
    seat: [r3(HUMANOID_BASE.seatLo * scale), r3(HUMANOID_BASE.seatHi * scale)], standard,
  };
}

/** Dims of a body (floaters and bodies without a look: today's humanoid). Cached per body object. */
export function humanoidDims(body: Body | undefined | null): HumanoidDims {
  const p = body?.family === 'humanoid' ? body.params : undefined;
  if (!p) return STANDARD;
  let d = cache.get(p);
  if (!d) { d = dimsOf(p); cache.set(p, d); }
  return d;
}

const profiles = new Map<string, AgentProfile>();
/** Movement profile of a humanoid: HUMAN_PROFILE itself unless its look changes height, build or walk speed. */
export function humanoidProfile(body: Body | undefined | null): AgentProfile {
  const d = humanoidDims(body);
  if (d.standard) return HUMAN_PROFILE;
  const id = `human-r${d.radius}-h${r3(HUMAN_PROFILE.height * d.scale)}-v${d.walkSpeed}`;
  let p = profiles.get(id);
  if (!p) { p = Object.freeze({ ...HUMAN_PROFILE, id, radius: d.radius, height: r3(HUMAN_PROFILE.height * d.scale), speed: d.walkSpeed }); profiles.set(id, p); }
  return p;
}

/** Collision radius of a human entity's body (floaters: their own; humanoids: their look's, else 0.28). */
export function humanRadius(e: Pick<Entity, 'body'> | undefined): number {
  const b = e?.body;
  if (b?.family === 'floater') return b.radius ?? 0.35;
  return humanoidDims(b).radius;
}

/** Whether a seat top `seatTop` m above the feet fits this body; null = it fits. */
export function seatFitProblem(body: Body | undefined | null, seatTop: number): { code: 'seat.too-high' | 'seat.too-low'; message: string } | null {
  if (body?.family === 'floater') return null;
  const d = humanoidDims(body), [lo, hi] = d.seat;
  if (seatTop > hi + 1e-9) return { code: 'seat.too-high', message: `the seat is ${seatTop.toFixed(2)} m high; a ${d.height.toFixed(2)} m body sits on seats up to ${hi.toFixed(2)} m` };
  if (seatTop < lo - 1e-9) return { code: 'seat.too-low', message: `the seat is ${seatTop.toFixed(2)} m high; a ${d.height.toFixed(2)} m body sits on seats from ${lo.toFixed(2)} m` };
  return null;
}

/** Structural check of a humanoid look's params (bodyProblem): shape, and the physical dims in range. */
export function humanoidParamsProblem(params: unknown): string | null {
  if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length > 32) return 'body.params';
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(k) || !(typeof v === 'string' && v.length <= 32 || typeof v === 'number' && Number.isFinite(v))) return 'body.params';
    if (k in HUMANOID_DIM_RANGES) {
      const [lo, hi] = HUMANOID_DIM_RANGES[k as HumanoidDimKey];
      if (typeof v !== 'number' || v < lo || v > hi) return `body.params.${k}`;
    }
  }
  return null;
}
