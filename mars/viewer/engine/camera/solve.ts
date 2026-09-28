// Deocclusion / decollision solver. Given a desired camera pose (from a shot),
// generate a fixed, ordered family of alternates around the target, decollide
// each (push-out), score readability / deviation, and pick with hysteresis.
// Nothing here hides architecture: occluders are only ignored when the spec
// explicitly asks for `cutaway`.
import { dacos, dasin, datan, datan2, dlog, dtan, type Vec3, hypot } from '../core/math.ts';
import { CameraWorld, pointInside, pushOut, raycast } from './geom.ts';
import { dirFrom, type CameraPose, type SubjectPose } from './shots.ts';
import { MIN_CLEARANCE, placement, readability, type Placement, type Readability } from './quality.ts';

const DEG = Math.PI / 180;

export type SolveOpts = {
  minClear?: number; // m (default 0.3)
  minReadability?: number; // default 0.6
  minDistance?: number; // closest a pull-in may come to the target (default 1.2 m)
  pullMargin?: number; // stop this far before the first hit (default 0.45 m)
  aspect?: number;
  minSize?: number;
  /** UI covering the bottom of the viewport (fraction of frame height, e.g. the studio replay bar ≈ 0.17). Default 0. */
  safeArea?: { bottom?: number };
  cutaway?: boolean;
  /** Max decollision push-out (m); farther is treated as invalid, not teleported (default 1.5). */
  maxPush?: number;
  /** Weight of framing deviation vs readability (default 2). */
  deviationWeight?: number;
  /** Restrict the alternate family to these keys (default: all VARIANTS). */
  variants?: string[];
};

export type Candidate = {
  key: string;
  pose: CameraPose;
  place: Placement;
  valid: boolean;
  pushed: boolean;
  read: Readability;
  deviation: number; // 0 = desired framing; ~1 = opposite side
};

type Variant = { key: string; daz?: number; del?: number; wide?: number; pull?: true };
/** Fixed, ordered candidate family (order = tie-break priority). */
export const VARIANTS: Variant[] = [
  { key: 'desired' },
  { key: 'pull', pull: true },
  ...[15, 30, 45, 60, 90].flatMap((a) => [{ key: `az+${a}`, daz: a }, { key: `az-${a}`, daz: -a }]),
  ...[15, 30, 45].map((e) => ({ key: `el+${e}`, del: e })),
  { key: 'wide1.3', wide: 1.3 },
  { key: 'wide1.6', wide: 1.6 },
  ...[30, 60].flatMap((a) => [{ key: `az+${a}el+20`, daz: a, del: 20 }, { key: `az-${a}el+20`, daz: -a, del: 20 }]),
];
export const VARIANT_KEYS = VARIANTS.map((v) => v.key);

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => hypot(a[0], a[1], a[2]);

function spherical(pose: CameraPose) {
  const d = sub(pose.position, pose.target);
  const dist = Math.max(1e-6, len(d));
  return { dist, az: datan2(d[2], d[0]), el: dasin(Math.max(-1, Math.min(1, d[1] / dist))) };
}

/** Normalised framing deviation between two poses sharing a target. */
export function deviation(desired: CameraPose, pose: CameraPose): number {
  const a = sub(desired.position, desired.target), b = sub(pose.position, pose.target);
  const la = len(a) || 1, lb = len(b) || 1;
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return dacos(Math.max(-1, Math.min(1, cos))) / Math.PI + 0.35 * Math.abs(dlog(lb / la));
}

/**
 * Build the candidate set for one instant. `ids` are the subjects that must be
 * readable. Deterministic: same inputs → same candidates in VARIANTS order.
 */
export function candidates(world: CameraWorld, desired: CameraPose, subjects: Record<string, SubjectPose>, ids: string[], opts: SolveOpts = {}): Candidate[] {
  const minClear = opts.minClear ?? MIN_CLEARANCE;
  const { dist, az, el } = spherical(desired);
  const T = desired.target;
  const out: Candidate[] = [];
  for (const v of VARIANTS) {
    if (opts.variants && v.key !== 'desired' && !opts.variants.includes(v.key)) continue; // desired is always evaluated
    let position: Vec3;
    let fov = desired.fov;
    if (v.key === 'desired') position = desired.position;
    else if (v.pull) {
      // Pull forward along target→camera to just before the first collider or occluder.
      const skip = new Set(world.candidates(T[0], T[2], T[0], T[2]).map((i) => world.solids[i]).filter((q) => pointInside(T, q)).map((q) => q.o.id));
      const hc = raycast(world, T, desired.position, 'collide', skip);
      const ho = opts.cutaway ? null : raycast(world, T, desired.position, 'occlude', skip);
      const t = Math.min(hc ? hc.t : 1, ho ? ho.t : 1);
      if (t >= 1) continue; // nothing to pull in front of
      const d = t * dist - (opts.pullMargin ?? 0.45);
      if (d < (opts.minDistance ?? 1.2)) continue;
      const u = d / dist;
      position = [T[0] + (desired.position[0] - T[0]) * u, T[1] + (desired.position[1] - T[1]) * u, T[2] + (desired.position[2] - T[2]) * u];
      // widen to keep roughly the same framing, capped
      fov = Math.min(80, (2 * datan(dtan((desired.fov * DEG) / 2) / u)) / DEG);
    } else {
      const e = Math.min(80 * DEG, el + (v.del ?? 0) * DEG);
      const r = dist * (v.wide ?? 1);
      const dir = dirFrom(az + (v.daz ?? 0) * DEG, e);
      position = [T[0] + dir[0] * r, T[1] + dir[1] * r, T[2] + dir[2] * r];
    }
    let place = placement(world, position, minClear);
    let pushed = false;
    if (!place.valid) {
      const po = pushOut(world, position, minClear + 0.02);
      const drift = hypot(po.p[0] - position[0], po.p[1] - position[1], po.p[2] - position[2]);
      if (po.ok && drift <= (opts.maxPush ?? 1.5)) {
        position = po.p;
        pushed = true;
        place = placement(world, position, minClear);
      }
    }
    const pose: CameraPose = { position, target: T, fov };
    const read = readability(world, pose, subjects, ids, { aspect: opts.aspect, minSize: opts.minSize, safeBottom: opts.safeArea?.bottom, cutaway: opts.cutaway });
    out.push({ key: v.key, pose, place, valid: place.valid, pushed, read, deviation: v.key === 'desired' ? 0 : deviation(desired, pose) });
  }
  return out;
}

/** Instantaneous cost (lower is better). Invalid placements are effectively forbidden. */
export function candidateCost(c: Candidate, minReadability = 0.6, deviationWeight = 2): number {
  return badness(c, minReadability) + 4 * (1 - c.read.score) + deviationWeight * c.deviation;
}
/** Hard-problem part of the cost (used for lookahead): invalid or unreadable. */
export function badness(c: Candidate, minReadability = 0.6): number {
  return (c.valid ? 0 : 1000) + (c.read.score < minReadability ? 1.5 + 4 * (minReadability - c.read.score) : 0);
}

export type LiveOpts = SolveOpts & { hysteresis?: number; minHold?: number };
export type LiveStep = { chosen: Candidate; switched: boolean; all: Candidate[] };

/**
 * Greedy ClearShot-style selector for live use (no future knowledge). Keeps
 * the current alternate unless it becomes invalid/unreadable or another
 * candidate beats it by more than `hysteresis` after `minHold` seconds.
 * State is camera-only; it never touches the world.
 */
export class LiveSolver {
  world: CameraWorld;
  opts: LiveOpts;
  key: string | null = null;
  since = 0;

  constructor(world: CameraWorld, opts: LiveOpts = {}) {
    this.world = world;
    this.opts = opts;
  }

  step(t: number, desired: CameraPose, subjects: Record<string, SubjectPose>, ids: string[]): LiveStep {
    const minRead = this.opts.minReadability ?? 0.6;
    const hyst = this.opts.hysteresis ?? 0.35, hold = this.opts.minHold ?? 1.5;
    const all = candidates(this.world, desired, subjects, ids, this.opts);
    let best = all[0];
    const w = this.opts.deviationWeight ?? 2;
    const cost = (c: Candidate) => candidateCost(c, minRead, w);
    for (const c of all) if (cost(c) < cost(best)) best = c;
    const cur = this.key ? all.find((c) => c.key === this.key) : undefined;
    let chosen = best;
    if (cur && cur.valid && cur.read.score >= minRead) {
      const held = t - this.since;
      if (held < hold || cost(cur) <= cost(best) + hyst) chosen = cur;
    }
    const switched = chosen.key !== this.key;
    if (switched) { this.key = chosen.key; this.since = t; }
    return { chosen, switched, all };
  }
}
