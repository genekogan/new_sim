// Deocclusion / decollision solver. Given a desired camera pose (from a shot),
// generate a fixed, ordered family of alternates around the target, decollide
// each (push-out), score readability / deviation, and pick with hysteresis.
// Nothing here hides architecture: occluders are only ignored when the spec
// explicitly asks for `cutaway`.
import { dacos, dasin, datan, datan2, dlog, dtan, obbOverlap, q6, type Vec3, hypot } from '../core/math.ts';
import { CameraWorld, pointInside, pushOut, raycast } from './geom.ts';
import { dirFrom, subjectPoints, type CameraPose, type SubjectPose } from './shots.ts';
import { MIN_CLEARANCE, PERSON_HEIGHT, PERSON_RADIUS, placement, readability, type Placement, type Readability } from './quality.ts';
import { segmentBox, type OccBox } from './occluders.ts';

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

// ---- Phase 2 (OWNER_FEEDBACK_2026-09-28 §11 layer 3, CAMERA_DIRECT.md §7): simulate a computed shot against the
// take — people and parts per tick, not just the static scene — and score every sample against named failure
// modes. Pure and deterministic; the camera still never mutates the world. The ranked corrections that act on
// these failures live in correct.ts.

/** Thresholds of the phase-2 failure checks (documented in CAMERA_DIRECT.md §7). */
export const FAILURE_LIMITS = {
  /** Free width across the camera (two opposite horizontal rays that both hit) below this = squeezed (m): a
   * steadicam-sized rig (≈ 0.6 m) plus 0.3 m each side. A 1.6 m door passes; two sheets 0.8 m apart do not. */
  squeezeWidth: 1.2,
  /** Floor-to-ceiling free height at the camera (only when something is above it) below this = squeezed (m). */
  squeezeHeight: 1.0,
  /** Length of the free-space probe rays (m). */
  probe: 3,
  /** Take parts do not collide with the planner's camera (occlude only); phase 2 keeps it this far from their boxes (m). */
  partClearance: MIN_CLEARANCE,
  /** A person this close to the camera (m, to the capsule axis) is a foreground blob … */
  foregroundDistance: 1.5,
  /** … when its projection covers at least this fraction of the subject's frame region. */
  foregroundCover: 0.25,
  /** The sun (when above the horizon and not hidden by the scene) closer than this to the optical axis = flare (deg). */
  flareDeg: 6,
  /** At least this fraction of the subject's points must stay inside the frame (5 % margin, UI band) on every sample. */
  frameMin: 0.75,
  /** A look-at camera's roll is undefined near vertical: |pitch| above this loses the horizon (deg). */
  maxPitchDeg: 75,
  /** Explicit roll (a key's `roll`, rad) beyond this tilts the horizon (deg). */
  maxRollDeg: 1,
  /** Shortest failing run that counts (samples): a person brushing past for one frame is not a failure. */
  minRun: { collision: 1, squeeze: 1, foreground: 3, flare: 1, frame: 3, horizon: 1, motion: 1 },
  /** A squeeze must be sustained — this much camera travel (m) or this long (s) — so passing a door's jambs is not one. */
  squeezeTravel: 0.3,
  squeezeHold: 0.5,
} as const;

/** Failure kinds in report / correction order (the first failure of the first kind drives the ranked corrections). */
export const FAILURE_ORDER = ['collision', 'squeeze', 'foreground', 'flare', 'frame', 'horizon', 'motion'] as const;
export type FailureKind = (typeof FAILURE_ORDER)[number];
/** Penalty per failing sample (the scalar score is only for ranking / before-after reporting; validity = no failure). */
export const FAILURE_WEIGHT: Record<FailureKind, number> = { collision: 100, squeeze: 10, foreground: 5, flare: 5, frame: 5, horizon: 3, motion: 3 };

/** What `ShotFailure.worst` measures per kind. */
const WORST_UNIT: Record<FailureKind, string> = { collision: ' samples', squeeze: ' m free', foreground: ' of the subject covered', flare: '° off axis', frame: ' of the points framed', horizon: '° pitch', motion: '°/s' };

export type MotionCapsIn = { viewOmegaDeg: number; viewAlphaDeg: number; speed: number; accel: number };

/** One computed shot to simulate. `keys[i].t` is relative to `t0` (take seconds). */
export type ShotSim = {
  world: CameraWorld;
  sampler: (t: number) => Record<string, SubjectPose>;
  keys: { t: number; position: Vec3; target: Vec3; roll?: number }[];
  t0: number;
  hz: number;
  fov: number;
  aspect: number;
  safeBottom?: number;
  groundY?: number;
  /** Sampler ids that are the subject (framed, never foreground). */
  subjects: string[];
  /** Static focus points per key (sweeps, fixtures, static geometry) — framed like subject points. */
  focus?: Vec3[][];
  /** A take structure under construction: its members whose points lie inside the final box (grown 0.25 m) at t are framed too. */
  growing?: { members: string[]; min: Vec3; max: Vec3 };
  /** World direction to the sun (null / y ≤ 0: no flare check). */
  sunDir?: Vec3 | null;
  caps: MotionCapsIn;
  /** Frame check on (default). A fly-through looks along its route, not at the subject: off. */
  frame?: boolean;
};

export type SampleScore = {
  t: number;
  position: Vec3;
  /** Narrowest free width across the camera (m, Infinity = open on at least one side of every axis) and what bounds it. */
  freeWidth: number;
  squeezedBy?: string[];
  /** A vertical squeeze between two bounds: their ids (obstacle id, or part:<entity id>). */
  slot?: { below: string; above: string };
  /** Distance to the nearest take-part box (m). */
  partClearance: number;
  foreground?: { id: string; cover: number; distance: number };
  sunOffAxisDeg: number | null;
  framed: number;
  pitchDeg: number;
  omegaDeg: number;
  alphaDeg: number;
  speed: number;
  accel: number;
  fails: FailureKind[];
  why: Partial<Record<FailureKind, string>>;
};
export type ShotFailure = { kind: FailureKind; i0: number; i1: number; t0: number; t1: number; samples: number; worst: number; detail: string; subjects: string[] };
export type ShotScore = {
  valid: boolean;
  samples: SampleScore[];
  failures: ShotFailure[];
  failingSamples: number;
  penalty: number;
  /** Worst value of each measured quantity over the shot (for the report). */
  worst: { minFreeWidth: number; minPartClearance: number; maxForegroundCover: number; minSunOffAxisDeg: number | null; minFramed: number; maxAbsPitchDeg: number; maxOmegaDeg: number; maxAlphaDeg: number; maxSpeed: number; maxAccel: number };
};

const HDIRS: Vec3[] = [[1, 0, 0], [Math.SQRT1_2, 0, Math.SQRT1_2], [0, 0, 1], [-Math.SQRT1_2, 0, Math.SQRT1_2]];
type PartBox = { id: string; b: OccBox };

/** Distance along `dir` (unit) from `a` to the first collision solid or take-part box within `L`, or null. */
function probeRay(world: CameraWorld, parts: PartBox[], a: Vec3, dir: Vec3, L: number): { d: number; id: string } | null {
  const b: Vec3 = [a[0] + dir[0] * L, a[1] + dir[1] * L, a[2] + dir[2] * L];
  const h = raycast(world, a, b, 'collide');
  let best = h ? { d: h.t * L, id: h.solid.o.label ?? h.solid.o.id } : null;
  for (const q of parts) {
    const t = segmentBox(a, b, q.b);
    if (t !== null && (!best || t * L < best.d)) best = { d: t * L, id: `part ${q.id}` };
  }
  return best;
}

/** Distance from p to an oriented box (0 inside). */
export function boxDistance(p: Vec3, q: OccBox): number {
  const r: Vec3 = [p[0] - q.c[0], p[1] - q.c[1], p[2] - q.c[2]];
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const u = q.ax[k];
    const e = Math.abs(r[0] * u[0] + r[1] * u[1] + r[2] * u[2]) - q.h[k];
    if (e > 0) s += e * e;
  }
  return Math.sqrt(s);
}

/**
 * Free space around a camera position: the narrowest width across it (4 horizontal axes, both rays must hit within
 * the probe; plus floor-to-ceiling when something is above), against static collision solids and the take's parts
 * at that tick. Two plywood sheets 0.8 m apart give 0.8 m; the middle of a 1.6 m door gives 1.6 m.
 */
export function freeSpace(world: CameraWorld, parts: PartBox[], p: Vec3, groundY = 0, L: number = FAILURE_LIMITS.probe): { width: number; by: string[]; vertical: number; slot?: { below: string; above: string } } {
  let width = Infinity, by: string[] = [];
  for (const d of HDIRS) {
    const f = probeRay(world, parts, p, d, L), g = f ? probeRay(world, parts, p, [-d[0], 0, -d[2]], L) : null;
    if (f && g && f.d + g.d < width) { width = f.d + g.d; by = [f.id, g.id]; }
  }
  // floor-to-ceiling over the camera body's footprint (a 2r square): every collision solid or take part whose
  // footprint overlaps it bounds the free height above or below — exact, so a thin slot (a 6 cm wall's hatch
  // between a half wall and the panel above) is caught on every sample within r of it
  const fp = { c: [p[0], p[2]] as [number, number], half: [MIN_CLEARANCE, MIN_CLEARANCE] as [number, number], yaw: 0 };
  type Bound = { d: number; id: string; key: string };
  let up: Bound | null = null, down: Bound | null = null;
  const consider = (y0: number, y1: number, id: string, key: string) => {
    if (y0 >= p[1]) { const d = y0 - p[1]; if (d <= L && (!up || d < up.d)) up = { d, id, key }; }
    else if (y1 <= p[1]) { const d = p[1] - y1; if (!down || d < down.d) down = { d, id, key }; }
  };
  for (const i of world.candidates(p[0], p[2], p[0], p[2], MIN_CLEARANCE)) {
    const q = world.solids[i];
    if (q.collide && obbOverlap(fp, q.o.obb)) consider(q.y0, q.y1, q.o.label ?? q.o.id, q.o.id);
  }
  for (const q of parts) if (q.b.max[0] >= p[0] - MIN_CLEARANCE && q.b.min[0] <= p[0] + MIN_CLEARANCE && q.b.max[2] >= p[2] - MIN_CLEARANCE && q.b.min[2] <= p[2] + MIN_CLEARANCE) consider(q.b.min[1], q.b.max[1], `part ${q.id}`, `part:${q.id}`);
  let vertical = Infinity, slot: { below: string; above: string } | undefined;
  const u = up as Bound | null, dn = down as Bound | null;
  if (u) {
    const floor = Math.max(0, p[1] - groundY);
    vertical = u.d + (dn && dn.d < floor ? dn.d : floor);
    if (vertical < FAILURE_LIMITS.squeezeHeight && vertical < width) {
      by = [u.id, dn && dn.d < floor ? dn.id : 'the ground'];
      if (dn && dn.d < floor) slot = { below: dn.key, above: u.key };
    }
  }
  return { width, by, vertical, ...(slot ? { slot } : {}) };
}

type CamBasis = { f: Vec3; r: Vec3; u: Vec3; tv: number; th: number };
function camBasis(position: Vec3, target: Vec3, fov: number, aspect: number): CamBasis {
  const d: Vec3 = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
  const l = hypot(d[0], d[1], d[2]) || 1;
  const f: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  let r: Vec3 = [-f[2], 0, f[0]];
  const rl = hypot(r[0], r[2]);
  r = rl > 1e-9 ? [r[0] / rl, 0, r[2] / rl] : [1, 0, 0];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const tv = dtan((fov * DEG) / 2);
  return { f, r, u, tv, th: tv * aspect };
}
const camSpace = (b: CamBasis, o: Vec3, p: Vec3): Vec3 => {
  const d: Vec3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  return [d[0] * b.r[0] + d[1] * b.r[1] + d[2] * b.r[2], d[0] * b.u[0] + d[1] * b.u[1] + d[2] * b.u[2], d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2]];
};

/** Is the sun visible from p (no occluding solid within 80 m toward it)? */
function sunVisible(world: CameraWorld, p: Vec3, sun: Vec3): boolean {
  return !raycast(world, p, [p[0] + sun[0] * 80, p[1] + sun[1] * 80, p[2] + sun[2] * 80], 'occlude');
}

/**
 * Simulate a computed shot against the take and score every sample: static collision (placement + swept moves),
 * squeeze (free width against solids and take parts), foreground blob (a person within 1.5 m of the camera over
 * the subject's frame region), sun flare on the optical axis, subject leaving the frame (people, focus points and
 * a structure's in-place members at that tick), horizon (near-vertical view / roll) and motion sickness (the
 * MOTION_CAPS on per-sample angular / linear velocity and acceleration). Deterministic.
 */
export function scoreShot(sim: ShotSim): ShotScore {
  const L = FAILURE_LIMITS;
  const near = 0.05, groundY = sim.groundY ?? 0;
  const yMin = 2 * (sim.safeBottom ?? 0) - 0.95;
  const sl = sim.sunDir ? hypot(sim.sunDir[0], sim.sunDir[1], sim.sunDir[2]) : 0;
  const sun: Vec3 | null = sim.sunDir && sim.sunDir[1] > 0 && sl > 0 ? [sim.sunDir[0] / sl, sim.sunDir[1] / sl, sim.sunDir[2] / sl] : null;
  const samples: SampleScore[] = [];
  let prevW: number | null = null, prevV: number | null = null;
  const subjectSet = new Set(sim.subjects);
  for (let i = 0; i < sim.keys.length; i++) {
    const k = sim.keys[i];
    const t = sim.t0 + k.t;
    const now = sim.sampler(t);
    const ids = Object.keys(now).sort();
    const fails: FailureKind[] = [];
    const why: Partial<Record<FailureKind, string>> = {};
    const fail = (kind: FailureKind, w: string) => { if (!fails.includes(kind)) { fails.push(kind); why[kind] = w; } };
    const p = k.position;
    // collision (the planner's own evaluator: placement + swept move against static solids)
    const pl = placement(sim.world, p);
    if (!pl.valid) fail('collision', pl.reason ?? 'invalid placement');
    if (i) { const h = raycast(sim.world, sim.keys[i - 1].position, p, 'collide'); if (h) fail('collision', `move crosses '${h.solid.o.label ?? h.solid.o.id}'`); }
    // squeeze: free width against solids + the take's parts at this tick
    const parts: PartBox[] = [];
    let partClear = Infinity, partNear = '';
    for (const id of ids) for (const b of now[id].occluders ?? []) {
      if (b.max[0] < p[0] - L.probe || b.min[0] > p[0] + L.probe || b.max[1] < p[1] - L.probe || b.min[1] > p[1] + L.probe || b.max[2] < p[2] - L.probe || b.min[2] > p[2] + L.probe) continue;
      parts.push({ id, b });
      const dd = boxDistance(p, b);
      if (dd < partClear) { partClear = dd; partNear = id; }
    }
    const fs = freeSpace(sim.world, parts, p, groundY);
    if (fs.width < L.squeezeWidth) fail('squeeze', `free width ${r2(fs.width)} m between ${fs.by.map((x) => `'${x}'`).join(' and ')} (< ${L.squeezeWidth} m)`);
    else if (fs.vertical < L.squeezeHeight) fail('squeeze', `free height ${r2(fs.vertical)} m between ${fs.by.map((x) => `'${x}'`).join(' and ')} (< ${L.squeezeHeight} m)`);
    if (partClear < L.partClearance) fail('squeeze', `camera ${r2(partClear)} m from take part ${partNear} (< ${L.partClearance} m; take parts do not collide in the planner)`);
    // the subject's points in camera space
    const b = camBasis(p, k.target, sim.fov, sim.aspect);
    const pts: Vec3[] = [];
    if (sim.focus?.[i]) pts.push(...sim.focus[i]);
    for (const id of sim.subjects) if (now[id]) pts.push(...subjectPoints(now[id]));
    if (sim.growing) {
      const g = sim.growing;
      for (const m of g.members) {
        if (subjectSet.has(m) || !now[m]) continue;
        const mp = subjectPoints(now[m]);
        if (mp.every((q) => q[0] >= g.min[0] - 0.25 && q[0] <= g.max[0] + 0.25 && q[1] >= g.min[1] - 0.25 && q[1] <= g.max[1] + 0.25 && q[2] >= g.min[2] - 0.25 && q[2] <= g.max[2] + 0.25)) pts.push(...mp);
      }
    }
    const cs = pts.map((q) => camSpace(b, p, q));
    let framedN = 0;
    for (const c of cs) if (c[2] > near && Math.abs(c[0]) <= c[2] * b.th * 0.95 && c[1] <= c[2] * b.tv * 0.95 && c[1] >= c[2] * b.tv * yMin) framedN++;
    const framed = cs.length ? framedN / cs.length : 1;
    if (sim.frame !== false && cs.length && framed < L.frameMin) fail('frame', `${Math.round((1 - framed) * 100)}% of the subject's points outside the frame`);
    // foreground blob: a person (not the subject) within 1.5 m of the camera over the subject's frame region
    let fg: SampleScore['foreground'];
    const front = cs.filter((c) => c[2] > near);
    if (front.length) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zMin = Infinity;
      for (const c of front) {
        const x = Math.max(-1, Math.min(1, c[0] / (c[2] * b.th))), y = Math.max(-1, Math.min(1, c[1] / (c[2] * b.tv)));
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); zMin = Math.min(zMin, c[2]);
      }
      if (x1 - x0 < 0.1) { const m = (x0 + x1) / 2; x0 = m - 0.05; x1 = m + 0.05; }
      if (y1 - y0 < 0.1) { const m = (y0 + y1) / 2; y0 = m - 0.05; y1 = m + 0.05; }
      const area = (x1 - x0) * (y1 - y0);
      for (const id of ids) {
        const s = now[id];
        if (s.kind !== 'human' || subjectSet.has(id)) continue;
        // distance from the camera to the capsule axis
        const ay0 = s.p[1] + PERSON_RADIUS, ay1 = s.p[1] + PERSON_HEIGHT - PERSON_RADIUS;
        const cy = Math.max(ay0, Math.min(ay1, p[1]));
        const dist = hypot(p[0] - s.p[0], p[1] - cy, p[2] - s.p[2]);
        if (dist > L.foregroundDistance + PERSON_RADIUS) continue;
        let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity, pz = Infinity;
        for (const hgt of [0.1, 0.5, 0.9, 1.3, 1.6]) {
          const c = camSpace(b, p, [s.p[0], s.p[1] + hgt, s.p[2]]);
          if (c[2] <= -PERSON_RADIUS) continue; // behind the camera
          const z = Math.max(near, c[2]);
          const rx = PERSON_RADIUS / (z * b.th), ry = PERSON_RADIUS / (z * b.tv);
          px0 = Math.min(px0, c[0] / (z * b.th) - rx); px1 = Math.max(px1, c[0] / (z * b.th) + rx);
          py0 = Math.min(py0, c[1] / (z * b.tv) - ry); py1 = Math.max(py1, c[1] / (z * b.tv) + ry);
          pz = Math.min(pz, c[2]);
        }
        if (!(pz < zMin)) continue; // not in front of the subject
        const ix = Math.max(0, Math.min(x1, px1) - Math.max(x0, px0)), iy = Math.max(0, Math.min(y1, py1) - Math.max(y0, py0));
        const cover = (ix * iy) / area;
        if (cover > 0 && (!fg || cover > fg.cover)) fg = { id, cover: r2(cover), distance: r2(dist) };
      }
      if (fg && fg.cover >= L.foregroundCover) fail('foreground', `person ${fg.id} ${fg.distance} m from the camera covers ${Math.round(fg.cover * 100)}% of the subject's frame region`);
    }
    // sun flare on the optical axis
    let sunOff: number | null = null;
    if (sun) {
      const c = Math.max(-1, Math.min(1, b.f[0] * sun[0] + b.f[1] * sun[1] + b.f[2] * sun[2]));
      sunOff = r2(datan2(Math.sqrt(1 - c * c), c) / DEG);
      if (sunOff < L.flareDeg && sunVisible(sim.world, p, sun)) fail('flare', `sun ${sunOff}° off the optical axis (< ${L.flareDeg}°)`);
    }
    // horizon
    const pitchDeg = r2(dasin(Math.max(-1, Math.min(1, b.f[1]))) / DEG);
    if (Math.abs(pitchDeg) > L.maxPitchDeg) fail('horizon', `view pitch ${pitchDeg}° (|pitch| > ${L.maxPitchDeg}°: a look-at camera's horizon is undefined)`);
    if (Math.abs((k.roll ?? 0) / DEG) > L.maxRollDeg) fail('horizon', `roll ${r2((k.roll ?? 0) / DEG)}° (> ${L.maxRollDeg}°)`);
    // motion (per sample, the same measure as synth.ts motionPeaks)
    let w = 0, v = 0, a = 0, acc = 0;
    if (i) {
      const q = sim.keys[i - 1];
      const d0 = camBasis(q.position, q.target, sim.fov, sim.aspect).f;
      const c = Math.max(-1, Math.min(1, d0[0] * b.f[0] + d0[1] * b.f[1] + d0[2] * b.f[2]));
      w = (datan2(Math.sqrt(1 - c * c), c) / DEG) * sim.hz;
      v = hypot(p[0] - q.position[0], p[1] - q.position[1], p[2] - q.position[2]) * sim.hz;
      if (prevW !== null && prevV !== null) { a = Math.abs(w - prevW) * sim.hz; acc = Math.abs(v - prevV) * sim.hz; }
      prevW = w; prevV = v;
    }
    const cap = sim.caps;
    if (w > cap.viewOmegaDeg + 0.5 || a > cap.viewAlphaDeg + 1 || v > cap.speed + 0.05 || acc > cap.accel + 0.1) fail('motion', `view ${r2(w)}°/s, ${r2(a)}°/s², camera ${r2(v)} m/s, ${r2(acc)} m/s² (caps ${cap.viewOmegaDeg}°/s, ${cap.viewAlphaDeg}°/s², ${cap.speed} m/s, ${cap.accel} m/s²)`);
    const fw = Math.min(fs.width, fs.vertical);
    samples.push({ t: q6(t), position: p, freeWidth: fw === Infinity ? Infinity : r2(fw), ...(fs.by.length && fw < Infinity ? { squeezedBy: fs.by } : {}), ...(fs.slot && fails.includes('squeeze') ? { slot: fs.slot } : {}), partClearance: partClear === Infinity ? Infinity : r2(partClear), ...(fg ? { foreground: fg } : {}), sunOffAxisDeg: sunOff, framed: r2(framed), pitchDeg, omegaDeg: r2(w), alphaDeg: r2(a), speed: r2(v), accel: r2(acc), fails, why });
  }
  // failing runs per kind (runs shorter than minRun are transients)
  const failures: ShotFailure[] = [];
  const failing = new Set<number>();
  for (const kind of FAILURE_ORDER) {
    let i = 0;
    while (i < samples.length) {
      if (!samples[i].fails.includes(kind)) { i++; continue; }
      let j = i;
      while (j + 1 < samples.length && samples[j + 1].fails.includes(kind)) j++;
      let counts = j - i + 1 >= L.minRun[kind];
      if (kind === 'squeeze' && counts) {
        let travel = 0;
        for (let q = i + 1; q <= j; q++) { const a = samples[q - 1].position, c = samples[q].position; travel += hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]); }
        counts = travel >= L.squeezeTravel - 1e-9 || (j - i + 1) / sim.hz >= L.squeezeHold - 1e-9;
      }
      if (counts) {
        const run = samples.slice(i, j + 1);
        const minW = Math.min(...run.map((s) => s.freeWidth));
        const worst = kind === 'squeeze' ? (Number.isFinite(minW) ? minW : Math.min(...run.map((s) => s.partClearance))) : kind === 'foreground' ? Math.max(...run.map((s) => s.foreground?.cover ?? 0)) : kind === 'flare' ? Math.min(...run.map((s) => s.sunOffAxisDeg ?? 90)) : kind === 'frame' ? Math.min(...run.map((s) => s.framed)) : kind === 'horizon' ? Math.max(...run.map((s) => Math.abs(s.pitchDeg))) : kind === 'motion' ? Math.max(...run.map((s) => s.omegaDeg)) : run.length;
        const who = [...new Set(run.flatMap((s) => (kind === 'foreground' && s.foreground ? [s.foreground.id] : kind === 'squeeze' && s.squeezedBy ? s.squeezedBy : [])))].sort();
        failures.push({ kind, i0: i, i1: j, t0: samples[i].t, t1: samples[j].t, samples: j - i + 1, worst: r2(worst), detail: `t=${samples[i].t}–${samples[j].t} s: ${run[0].why[kind]}${j > i ? `; worst ${r2(worst)}${WORST_UNIT[kind]}` : ''}`, subjects: who });
        for (let q = i; q <= j; q++) failing.add(q);
      }
      i = j + 1;
    }
  }
  failures.sort((x, y) => FAILURE_ORDER.indexOf(x.kind) - FAILURE_ORDER.indexOf(y.kind) || x.i0 - y.i0);
  const penalty = failures.reduce((s, f) => s + FAILURE_WEIGHT[f.kind] * f.samples, 0);
  const fin = (xs: number[], f: (...v: number[]) => number, d: number) => { const ys = xs.filter((x) => Number.isFinite(x)); return ys.length ? r2(f(...ys)) : d; };
  const offs = samples.map((s) => s.sunOffAxisDeg).filter((x): x is number => x !== null);
  return {
    valid: failures.length === 0,
    samples,
    failures,
    failingSamples: failing.size,
    penalty,
    worst: {
      minFreeWidth: fin(samples.map((s) => s.freeWidth), Math.min, 99),
      minPartClearance: fin(samples.map((s) => s.partClearance), Math.min, 99),
      maxForegroundCover: fin(samples.map((s) => s.foreground?.cover ?? 0), Math.max, 0),
      minSunOffAxisDeg: offs.length ? r2(Math.min(...offs)) : null,
      minFramed: fin(samples.map((s) => s.framed), Math.min, 1),
      maxAbsPitchDeg: fin(samples.map((s) => Math.abs(s.pitchDeg)), Math.max, 0),
      maxOmegaDeg: fin(samples.map((s) => s.omegaDeg), Math.max, 0),
      maxAlphaDeg: fin(samples.map((s) => s.alphaDeg), Math.max, 0),
      maxSpeed: fin(samples.map((s) => s.speed), Math.max, 0),
      maxAccel: fin(samples.map((s) => s.accel), Math.max, 0),
    },
  };
}
const r2 = (x: number) => Math.round(x * 100) / 100;
