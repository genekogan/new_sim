// Trajectory synthesis by calculation (OWNER_FEEDBACK_2026-09-28 §11, layer 2; docs/engineering/CAMERA_DIRECT.md).
// A ShotIntent (direct.ts) becomes dense keyed poses: orbit radius from the subject's extent and the lens,
// pans that keep a low sun in frame behind the subject, interior moves routed through a camera navmesh
// (layered free-space rasters + A*, smoothed by a clamped cubic B-spline, C²), speeds eased with
// smootherstep (C²) under documented motion caps. The keys become an existing `path` shot per window and
// the existing planner (planShotList, alternates off by default) validates collision, sweeps and
// readability — so the report is the planner's truth about the computed move, not a rescued one.
// Phase 2 (self-correction, correct.ts) re-synthesizes through `SynthOverrides` and records `SynthShot.corrections`.
import type { Diagnostic } from '../actions/types.ts';
import { hashOf } from '../core/hash.ts';
import { datan, datan2, dcos, dsin, dtan, hypot, q6, type Vec3 } from '../core/math.ts';
import { solarPosition, worldHeadingOfAzimuth } from '../env/sun.ts';
import { buildGrids, cellOf, latticeOf, type LevelGrid } from '../spatial/grid.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';
import type { WorldState } from '../world/types.ts';
import { CameraWorld, nearestSolid, raycast, segmentPrism, solidName, type CameraPolicy } from './geom.ts';
import { MIN_CLEARANCE, placement, readability } from './quality.ts';
import { aimForSafeArea, DEFAULT_ASPECT, fitDistance, subjectPoints, type CameraPose, type Key, type Sampler, type ShotSpec, type SubjectPose } from './shots.ts';
import { planShotList, type ShotListPlan, type ShotWindow } from './shotlist.ts';
import { correctShot, type CorrectDeps, type DirectCorrection, type ShotSimulation } from './correct.ts';
import { compileDirection, COMPASS, parseDirection, pointInPolygon, SemanticWorld, type CameraDirection, type Facts, type ResolvedSubject, type ShotIntent } from './direct.ts';

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

// ---- constants (documented in CAMERA_DIRECT.md) -------------------------------------------------------

/**
 * Motion-sickness / readability caps on the computed track (peaks, measured on the samples):
 * view angular velocity 20°/s (a 79° frame crosses in ≥ 4 s), angular acceleration 30°/s², camera speed
 * 6 m/s outside (the planner's continuity limit) and 1.5 m/s inside a room (walking-steadicam pace),
 * linear acceleration 2 m/s².
 */
export const MOTION_CAPS = { viewOmegaDeg: 20, viewAlphaDeg: 30, speedExterior: 6, speedInterior: 1.5, accel: 2 };
/** Default speeds when a direction gives neither duration nor speed. */
export const DEFAULT_SPEEDS = { panDeg: 8, tiltDeg: 6, orbitDeg: 6, dolly: 1.0, crane: 0.8, push: 1.0, fly: 1.0 };
export const DEFAULT_HOLD = 5; // s
/** Fraction of the frame the subject's bounding sphere fills, and the camera elevation, per framing size. */
export const FRAMING = { wide: { fill: 0.55, elevationDeg: 22 }, medium: { fill: 0.75, elevationDeg: 14 }, close: { fill: 0.92, elevationDeg: 8 } } as const;
/** Viewpoint distance from a look-at fixture per framing size (m). */
export const FIXTURE_DISTANCE = { close: 1.2, medium: 1.8, wide: 2.6 } as const;
export const EYE_HEIGHT = 1.6; // m above ground for interior / eye-level cameras
export const SUBJECT_PAD = 0.3; // m added to a subject's bounding radius
/** smootherstep: C² easing, zero velocity and acceleration at both ends. Peak speed 1.875×, peak |accel| 5.7735× (L/T, L/T²). */
export const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (6 * u - 15) + 10));
export const EASE_PEAK_VEL = 1.875;
export const EASE_PEAK_ACC = 5.7735;

// ---- small vector helpers --------------------------------------------------------------------------------

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const clampN = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const wrap = (a: number) => { let x = (a + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3v = (v: Vec3): Vec3 => [r2(v[0]), r2(v[1]), r2(v[2])];
const degs = (rad: number) => r2(rad / DEG);
const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Horizontal unit direction of a world heading (dirFrom convention: heading = datan2(z, x)). */
const hdir = (h: number): Vec3 => [dcos(h), 0, dsin(h)];
/** Compass bearing (deg clockwise from north) of a world-space horizontal vector (-Z north, +X east). */
export const compassOf = (v: Vec3) => { const a = datan2(v[0], -v[2]) / DEG; return r2(((a % 360) + 360) % 360); };

// ---- types ---------------------------------------------------------------------------------------------

export type { DirectCorrection, ShotSimulation } from './correct.ts';
/**
 * Knobs the phase-2 corrector (correct.ts) turns on a re-synthesis (all neutral by default): raise → heightOffset (m),
 * widen → distanceScale, swing → bearingOffset (rad), re-route → navRadius (camera radius of the navmesh, m) + avoid
 * (extra collision prisms, e.g. the take's parts), shorten → duration (s).
 */
export type SynthOverrides = { bearingOffset?: number; heightOffset?: number; distanceScale?: number; duration?: number; via?: Vec3[]; navRadius?: number; avoid?: Obstacle[] };
export type SynthValidation = { samples: number; invalidSamples: number; sweptCrossings: number; minClearance: number; firstProblem?: string };
export type SynthShot = {
  index: number;
  label: string;
  verb: ShotIntent['verb'];
  t0: number;
  t1: number;
  fov: number;
  /** Keyed poses at 1/hz, `t` relative to t0. */
  keys: Key[];
  /** Sampler ids scored for readability (a `focus:<i>` id is injected for static geometry). */
  subjects: string[];
  focus?: { id: string; points: Vec3[][] };
  params: Record<string, unknown>;
  notes: string[];
  validation: SynthValidation;
  corrections: DirectCorrection[];
  /** Phase 2: the simulation of this (final) shot against the take. */
  simulation?: ShotSimulation;
};
export type SynthContext = {
  world: CameraWorld;
  scene: SpatialScene;
  sampler: Sampler;
  hz: number;
  aspect: number;
  safeBottom: number;
  groundY: number;
  /** Take length (s). */
  duration: number;
  navmeshes?: Map<string, CameraNavmesh>;
  /** The sun when above the horizon at the take's datetime (phase-2 flare check, sun-behind band). */
  sun?: { direction: Vec3; datetime: string } | null;
  policy?: CameraPolicy;
};
export type PrevPose = { position: Vec3; target: Vec3 };
export type SynthResult = { ok: true; shot: SynthShot } | { ok: false; diagnostic: Diagnostic };

// ---- subject geometry ------------------------------------------------------------------------------------

type Geo = { centre: Vec3; min: Vec3; max: Vec3; radius: number; points: Vec3[] };

function geometry(s: ResolvedSubject, sampler: Sampler, t: number): Geo | null {
  const pts: Vec3[] = [];
  if (s.box) {
    const { min: a, max: b } = s.box;
    for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) pts.push([x, y, z]);
  }
  if (s.dynamic || s.ids.length) {
    const now = sampler(t);
    for (const id of s.ids) if (now[id]) pts.push(...subjectPoints(now[id]));
  }
  if (!pts.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let j = 0; j < 3; j++) { if (p[j] < min[j]) min[j] = p[j]; if (p[j] > max[j]) max[j] = p[j]; }
  const centre = lerp3(min, max, 0.5);
  return { centre, min, max, radius: len(sub(max, min)) / 2, points: pts };
}

/** Centre of a subject at t: fixed for static geometry; for people, the centroid averaged over ±1 s (the take is a known future, so this is the predicted path, without walking jitter). */
function centreAt(s: ResolvedSubject, sampler: Sampler, t: number, t0: number, t1: number): Vec3 | null {
  if (!s.dynamic) { const g = geometry(s, sampler, t0); return g ? g.centre : null; }
  let acc: Vec3 = [0, 0, 0], n = 0;
  for (let k = -4; k <= 4; k++) {
    const g = geometry(s, sampler, clampN(t + k * 0.25, t0, t1));
    if (g) { acc = addv(acc, g.centre); n++; }
  }
  return n ? mul(acc, 1 / n) : null;
}

// ---- framing -------------------------------------------------------------------------------------------

const hfovOf = (fov: number, aspect: number) => 2 * datan(dtan((fov * DEG) / 2) * aspect);

function reframe(pose: CameraPose, top: Vec3 | null, d: CameraDirection, aspect: number, safeBottom: number): CameraPose {
  let { position, target } = pose;
  const f = d.framing ?? {};
  const v = sub(target, position);
  const dist = len(v);
  if (dist < 1e-9) return pose;
  let heading = datan2(v[2], v[0]);
  let pitch = datan2(v[1], hypot(v[0], v[2]));
  if (f.thirds === 'left' || f.thirds === 'right') heading += (f.thirds === 'left' ? 1 : -1) * datan(dtan(hfovOf(pose.fov, aspect) / 2) / 3);
  if (f.headroom !== undefined && top) {
    const tv = sub(top, position);
    const aTop = datan2(tv[1], hypot(tv[0], tv[2]));
    pitch = aTop - datan((1 - 2 * f.headroom) * dtan((pose.fov * DEG) / 2));
  }
  const ce = dcos(pitch);
  target = [position[0] + dist * ce * dcos(heading), position[1] + dist * dsin(pitch), position[2] + dist * ce * dsin(heading)];
  return aimForSafeArea({ position, target, fov: pose.fov }, safeBottom);
}

// ---- validation + measurements -----------------------------------------------------------------------------

export function validateKeys(world: CameraWorld, keys: Key[]): SynthValidation {
  let invalid = 0, crossings = 0, minClear = Infinity, first: string | undefined;
  keys.forEach((k, i) => {
    const p = placement(world, k.position);
    if (p.clearance < minClear) minClear = p.clearance;
    if (!p.valid) { invalid++; first ??= `t=${k.t.toFixed(1)} s: ${p.reason}`; }
    if (i) {
      const h = raycast(world, keys[i - 1].position, k.position, 'collide');
      if (h) { crossings++; first ??= `t=${k.t.toFixed(1)} s: move crosses ${solidName(h.solid)}`; }
    }
  });
  return { samples: keys.length, invalidSamples: invalid, sweptCrossings: crossings, minClearance: minClear === Infinity ? 99 : r2(minClear), ...(first ? { firstProblem: first } : {}) };
}

/** Peak view angular velocity/acceleration (deg/s, deg/s²) and camera speed/acceleration (m/s, m/s²) of keys at hz, and when each peaks (s). */
export function motionPeaks(keys: Key[], hz: number): { viewOmegaDeg: number; viewAlphaDeg: number; speed: number; accel: number; at: { viewOmegaDeg: number; viewAlphaDeg: number; speed: number; accel: number } } {
  let w = 0, a = 0, v = 0, acc = 0, prevW: number | null = null, prevV: number | null = null;
  const at = { viewOmegaDeg: 0, viewAlphaDeg: 0, speed: 0, accel: 0 };
  for (let i = 1; i < keys.length; i++) {
    const d0 = norm(sub(keys[i - 1].target, keys[i - 1].position)), d1 = norm(sub(keys[i].target, keys[i].position));
    const c = clampN(dot(d0, d1), -1, 1);
    const ang = datan2(Math.sqrt(1 - c * c), c) * hz;
    const sp = len(sub(keys[i].position, keys[i - 1].position)) * hz;
    const t = keys[i].t;
    if (ang > w) { w = ang; at.viewOmegaDeg = t; }
    if (sp > v) { v = sp; at.speed = t; }
    if (prevW !== null && Math.abs(ang - prevW) * hz > a) { a = Math.abs(ang - prevW) * hz; at.viewAlphaDeg = t; }
    if (prevV !== null && Math.abs(sp - prevV) * hz > acc) { acc = Math.abs(sp - prevV) * hz; at.accel = t; }
    prevW = ang; prevV = sp;
  }
  return { viewOmegaDeg: r2(w / DEG), viewAlphaDeg: r2(a / DEG), speed: r2(v), accel: r2(acc), at };
}

/** Where the sun lands in a camera frame: NDC (x, y), in frame (with margin), angle off the optical axis. */
export function sunInFrame(pose: CameraPose, sunDir: Vec3, aspect: number, marginDeg = 0): { ndc: [number, number]; inFrame: boolean; offAxisDeg: number } {
  const f = norm(sub(pose.target, pose.position));
  const rl = hypot(f[0], f[2]) || 1;
  const r: Vec3 = [-f[2] / rl, 0, f[0] / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const s = norm(sunDir);
  const z = dot(s, f);
  const ty = dtan((pose.fov * DEG) / 2), tx = ty * aspect;
  const x = z > 1e-6 ? dot(s, r) / z / tx : Infinity, y = z > 1e-6 ? dot(s, u) / z / ty : Infinity;
  const mx = 1 - dtan(marginDeg * DEG) / tx, my = 1 - dtan(marginDeg * DEG) / ty;
  const off = datan2(Math.sqrt(Math.max(0, 1 - z * z)), z) / DEG;
  return { ndc: [r2(x), r2(y)], inFrame: z > 0 && Math.abs(x) <= mx && Math.abs(y) <= my, offAxisDeg: r2(off) };
}

// ---- camera navmesh ------------------------------------------------------------------------------------------

export const NAV_CELL = 0.2; // m
/** Layer heights above ground (m): eye layers ≤ 1.9, the flight layer from 2.2 m to roof / open sky. */
export const NAV_LAYERS = [1.0, 1.3, 1.6, 1.9, 2.2, 2.6, 3.0, 3.6, 4.4, 5.4, 6.6, 8.0];
export const FLIGHT_FROM = 2.2;
const VERTICAL_COST = 1.2; // per metre: prefer staying level

type NavNode = { k: number; idx: number };
export type NavRoute = { ok: true; points: Vec3[]; layers: number[]; expanded: number } | { ok: false; diagnostic: Diagnostic };

/**
 * Camera navmesh over a rectangle: for each layer height h a raster of the collision solids crossing the
 * camera band [h − r, h + r] (spatial/grid.ts `buildGrids` on a band scene: the same conservative OBB
 * raster and exact EDT clearance people navigate with), plus a raster per gap between adjacent layers for
 * vertical moves. A node is free when its clearance ≥ r + one cell. Rooms are regions (polygons), door
 * openings are the gaps walls leave in the rasters (the scenes carry no door objects), the flight layer is
 * everything from 2.2 m up that no roof or deck blocks. Read-only: never touches the world.
 */
export class CameraNavmesh {
  readonly bounds: [number, number, number, number];
  readonly cell: number;
  readonly radius: number;
  readonly need: number;
  readonly heights: number[];
  readonly layers: LevelGrid[];
  readonly gaps: LevelGrid[];
  readonly nx: number;
  readonly nz: number;
  readonly world: CameraWorld;

  constructor(world: CameraWorld, bounds: [number, number, number, number], groundY: number, radius = MIN_CLEARANCE, cell = NAV_CELL) {
    this.world = world;
    this.bounds = bounds;
    this.cell = cell;
    this.radius = radius;
    this.need = radius + cell;
    this.heights = NAV_LAYERS.map((h) => groundY + h);
    const band = (y0: number, y1: number): LevelGrid => {
      const obstacles = [];
      for (const q of world.solids) {
        if (!q.collide || q.y1 < y0 || q.y0 > y1 || q.maxX < bounds[0] || q.minX > bounds[2] || q.maxZ < bounds[1] || q.minZ > bounds[3]) continue;
        obstacles.push({ ...q.o, y0: 0.5, y1: 1.0 });
      }
      const [x0, z0, x1, z1] = bounds;
      const scene: SpatialScene = { bounds, levels: [{ id: 0, y: 0, label: `camera band ${y0.toFixed(2)}–${y1.toFixed(2)}` }], surfaces: [{ id: 'air', level: 0, y: 0, obb: { c: [(x0 + x1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (z1 - z0) / 2], yaw: 0 } }], obstacles, links: [] };
      return buildGrids(scene, cell).levels.get(0)!;
    };
    this.layers = this.heights.map((h) => band(h - radius, h + radius));
    this.gaps = this.heights.slice(0, -1).map((h, k) => band(h - radius, this.heights[k + 1] + radius));
    const lat = latticeOf(bounds, cell);
    this.nx = lat.nx;
    this.nz = lat.nz;
  }

  free(k: number, idx: number): boolean {
    return idx >= 0 && this.layers[k].clearance[idx] >= this.need;
  }

  point(n: NavNode): Vec3 {
    const g = this.layers[n.k];
    const i = n.idx % g.nx, j = Math.floor(n.idx / g.nx);
    return [(g.ox + i + 0.5) * this.cell, this.heights[n.k], (g.oz + j + 0.5) * this.cell];
  }

  /** Nearest free node to p (its nearest layer first, then the others by height), within `reach` metres. */
  snap(p: Vec3, reach = 1.2): NavNode | null {
    const order = this.heights.map((h, k) => k).sort((a, b) => Math.abs(this.heights[a] - p[1]) - Math.abs(this.heights[b] - p[1]) || a - b);
    const g0 = this.layers[0];
    const c = cellOf(g0, [p[0], p[2]]);
    if (c < 0) return null;
    const ci = c % g0.nx, cj = Math.floor(c / g0.nx), R = Math.ceil(reach / this.cell);
    for (const k of order.slice(0, 4)) {
      let best: NavNode | null = null, bd = Infinity;
      for (let j = Math.max(0, cj - R); j <= Math.min(g0.nz - 1, cj + R); j++)
        for (let i = Math.max(0, ci - R); i <= Math.min(g0.nx - 1, ci + R); i++) {
          const idx = j * g0.nx + i;
          if (!this.free(k, idx)) continue;
          const d = (i - ci) * (i - ci) + (j - cj) * (j - cj);
          if (d < bd) { bd = d; best = { k, idx }; }
        }
      if (best && bd <= R * R) return best;
    }
    return null;
  }

  /** A* over (layer, cell): 8-connected in a layer (no corner cutting), vertical moves where the gap raster is free. */
  route(a: Vec3, b: Vec3, maxExpand = 3_000_000): NavRoute {
    const s = this.snap(a), g = this.snap(b);
    const blocked = (p: Vec3, which: string): Diagnostic => {
      const n = nearestSolid(this.world, p, 'collide', 2);
      return { code: `camera.nav.${which}-blocked`, message: `camera ${which} (${r3v(p).join(', ')}) has no free camera space within 1.2 m${n ? ` (nearest: ${solidName(n.solid)} ${r2(Math.max(0, n.d))} m)` : ''}`, at: r3v(p), ...(n ? { subjects: [n.solid.o.id] } : {}) };
    };
    if (!s) return { ok: false, diagnostic: blocked(a, 'start') };
    if (!g) return { ok: false, diagnostic: blocked(b, 'goal') };
    const N = this.nx * this.nz, L = this.heights.length;
    const gcost = new Float64Array(N * L).fill(Infinity);
    const came = new Int32Array(N * L).fill(-1);
    const closed = new Uint8Array(N * L);
    const gp = this.point(g);
    const hOf = (node: number) => { const p = this.point({ k: Math.floor(node / N), idx: node % N }); return hypot(p[0] - gp[0], p[1] - gp[1], p[2] - gp[2]); };
    // binary heap of [f, node], ties → lower node id (deterministic)
    const hf: number[] = [], hn: number[] = [];
    const less = (i: number, j: number) => hf[i] < hf[j] || (hf[i] === hf[j] && hn[i] < hn[j]);
    const swap = (i: number, j: number) => { const f = hf[i]; hf[i] = hf[j]; hf[j] = f; const n = hn[i]; hn[i] = hn[j]; hn[j] = n; };
    const push = (f: number, n: number) => { hf.push(f); hn.push(n); let i = hf.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; } };
    const pop = (): number => {
      const top = hn[0], lf = hf.pop()!, ln = hn.pop()!;
      if (hf.length) { hf[0] = lf; hn[0] = ln; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hf.length && less(l, m)) m = l; if (r < hf.length && less(r, m)) m = r; if (m === i) break; swap(i, m); i = m; } }
      return top;
    };
    const start = s.k * N + s.idx, goal = g.k * N + g.idx;
    gcost[start] = 0;
    push(hOf(start), start);
    const c = this.cell, diag = c * Math.SQRT2;
    let expanded = 0;
    while (hf.length) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) break;
      if (++expanded > maxExpand) return { ok: false, diagnostic: { code: 'camera.nav.search-limit', message: `camera route search expanded ${maxExpand} nodes without reaching the goal` } };
      const k = Math.floor(cur / N), idx = cur % N, i = idx % this.nx, j = Math.floor(idx / this.nx);
      const relax = (nk: number, nidx: number, cost: number) => {
        const n = nk * N + nidx;
        if (closed[n]) return;
        const ng = gcost[cur] + cost;
        if (ng < gcost[n]) { gcost[n] = ng; came[n] = cur; push(ng + hOf(n), n); }
      };
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.nz) continue;
          const nidx = nj * this.nx + ni;
          if (!this.free(k, nidx)) continue;
          if (di && dj && (!this.free(k, j * this.nx + ni) || !this.free(k, nj * this.nx + i))) continue;
          relax(k, nidx, di && dj ? diag : c);
        }
      if (k > 0 && this.free(k - 1, idx) && this.gaps[k - 1].clearance[idx] >= this.need) relax(k - 1, idx, (this.heights[k] - this.heights[k - 1]) * VERTICAL_COST);
      if (k < L - 1 && this.free(k + 1, idx) && this.gaps[k].clearance[idx] >= this.need) relax(k + 1, idx, (this.heights[k + 1] - this.heights[k]) * VERTICAL_COST);
    }
    if (!closed[goal]) return { ok: false, diagnostic: { code: 'camera.nav.unreachable', message: `no camera route from (${r3v(a).join(', ')}) to (${r3v(b).join(', ')}): the free camera space (clearance ≥ ${r2(this.need)} m, layers ${NAV_LAYERS[0]}–${NAV_LAYERS[NAV_LAYERS.length - 1]} m) does not connect them`, at: r3v(b) } };
    const chain: number[] = [];
    for (let n = goal; n >= 0; n = came[n]) chain.push(n);
    chain.reverse();
    return { ok: true, points: chain.map((n) => this.point({ k: Math.floor(n / N), idx: n % N })), layers: chain.map((n) => Math.floor(n / N)), expanded };
  }
}

function navmeshFor(ctx: SynthContext, a: Vec3, b: Vec3, margin = 8, radius = MIN_CLEARANCE): CameraNavmesh {
  const sb = ctx.scene.bounds;
  const q = (v: number, f: (x: number) => number) => f(v / 2) * 2; // 2 m-aligned crop so nearby requests share a mesh
  const bounds: [number, number, number, number] = [
    Math.max(sb[0], q(Math.min(a[0], b[0]) - margin, Math.floor)), Math.max(sb[1], q(Math.min(a[2], b[2]) - margin, Math.floor)),
    Math.min(sb[2], q(Math.max(a[0], b[0]) + margin, Math.ceil)), Math.min(sb[3], q(Math.max(a[2], b[2]) + margin, Math.ceil)),
  ];
  const key = `${bounds.join(',')}@${radius}`;
  ctx.navmeshes ??= new Map();
  let m = ctx.navmeshes.get(key);
  if (!m) { m = new CameraNavmesh(ctx.world, bounds, ctx.groundY, radius); ctx.navmeshes.set(key, m); }
  return m;
}

/** Clamped uniform cubic B-spline (C²) through control points; dense samples ≤ `step` apart. */
export function bspline(ctrl: Vec3[], step = 0.05): Vec3[] {
  if (ctrl.length < 2) return ctrl.slice();
  const Q = [ctrl[0], ctrl[0], ...ctrl, ctrl[ctrl.length - 1], ctrl[ctrl.length - 1]];
  const out: Vec3[] = [];
  for (let i = 0; i + 3 < Q.length; i++) {
    // control-polygon length bounds the segment's arc length (the clamped end segments have a zero middle chord)
    const n = Math.max(1, Math.ceil((len(sub(Q[i + 1], Q[i])) + len(sub(Q[i + 2], Q[i + 1])) + len(sub(Q[i + 3], Q[i + 2]))) / step));
    for (let s = 0; s < n || (i + 4 === Q.length && s === n); s++) {
      const u = s / n, u2 = u * u, u3 = u2 * u;
      const b0 = (1 - u) * (1 - u) * (1 - u) / 6, b1 = (3 * u3 - 6 * u2 + 4) / 6, b2 = (-3 * u3 + 3 * u2 + 3 * u + 1) / 6, b3 = u3 / 6;
      out.push([0, 1, 2].map((j) => b0 * Q[i][j] + b1 * Q[i + 1][j] + b2 * Q[i + 2][j] + b3 * Q[i + 3][j]) as Vec3);
    }
  }
  return out;
}

function pullString(points: Vec3[], world: CameraWorld, grow: number): Vec3[] {
  const out = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && raycast(world, points[i], points[j], 'collide', undefined, grow)) j--;
    out.push(points[j]);
    i = j;
  }
  return out;
}

function subdivide(points: Vec3[], maxSeg: number): Vec3[] {
  if (!(maxSeg < Infinity)) return points;
  const out: Vec3[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const n = Math.max(1, Math.ceil(len(sub(points[i], points[i - 1])) / maxSeg));
    for (let s = 1; s <= n; s++) out.push(lerp3(points[i - 1], points[i], s / n));
  }
  return out;
}

const denseValid = (world: CameraWorld, pts: Vec3[]) => pts.every((p, i) => placement(world, p).valid && (!i || !raycast(world, pts[i - 1], p, 'collide')));

/** Smooth an A* route into a collision-free C² curve: string-pull (grown sweep), B-spline, verify; densify control points until it verifies. */
export function smoothRoute(route: Vec3[], world: CameraWorld, radius = MIN_CLEARANCE): { ok: true; dense: Vec3[]; control: Vec3[]; attempt: string } | { ok: false; diagnostic: Diagnostic } {
  const attempts: [string, number, number][] = [
    ['pulled', radius + 0.05, Infinity], ['pulled/1m', radius + 0.05, 1.0], ['pulled/0.5m', radius + 0.05, 0.5],
    ['pulled+0.25/0.5m', radius + 0.25, 0.5], ['pulled/0.25m', radius + 0.05, 0.25],
  ];
  for (const [name, grow, seg] of attempts) {
    const control = subdivide(pullString(route, world, grow), seg);
    const dense = bspline(control);
    if (denseValid(world, dense)) return { ok: true, dense, control, attempt: name };
  }
  const raw = bspline(route);
  if (denseValid(world, raw)) return { ok: true, dense: raw, control: route, attempt: 'navmesh nodes' };
  return { ok: false, diagnostic: { code: 'camera.nav.no-smooth-path', message: `the camera route (${route.length} nodes) has no collision-free smoothing` } };
}

/** Point at arc length s along a dense polyline (cumulative lengths `cum`). */
function along(pts: Vec3[], cum: number[], s: number): Vec3 {
  if (s <= 0) return pts[0];
  const L = cum[cum.length - 1];
  if (s >= L) return pts[pts.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const u = (s - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
  return lerp3(pts[lo], pts[hi], u);
}

// ---- per-verb synthesis --------------------------------------------------------------------------------------

type Framed = { size: 'wide' | 'medium' | 'close'; fill: number; elevation: number };
const framedOf = (d: CameraDirection): Framed => { const size = d.framing?.size ?? 'medium'; return { size, fill: FRAMING[size].fill, elevation: FRAMING[size].elevationDeg * DEG }; };

/** Camera heading forced by the direction (compass side or sun window), or null (search). */
function forcedHeading(intent: ShotIntent, over: SynthOverrides): number | null {
  const side = intent.direction.framing?.side;
  if (intent.sun) return intent.sun.cameraHeading.centre + (over.bearingOffset ?? 0);
  if (side) return worldHeadingOfAzimuth(COMPASS.indexOf(side) * 45) + (over.bearingOffset ?? 0);
  return null;
}

/** Pick the camera heading (subject → camera) with the fewest invalid samples, then best readability; ties → lowest index. */
function pickHeading(ctx: SynthContext, intent: ShotIntent, over: SynthOverrides, prev: PrevPose | undefined, centre: Vec3, poses: (h: number) => CameraPose[], scoreIds: string[], focus: Vec3[]): { heading: number; searched: boolean } {
  const forced = forcedHeading(intent, over);
  if (forced !== null) return { heading: forced, searched: false };
  const cands: number[] = [];
  if (prev) cands.push(datan2(prev.position[2] - centre[2], prev.position[0] - centre[0]));
  for (let k = 0; k < 16; k++) cands.push(wrap((k * TAU) / 16));
  let best = cands[0], bestKey: [number, number] | null = null;
  const subjects = ctx.sampler(intent.t0);
  const scored = focus.length ? { ...subjects, 'focus:pick': { p: focus[0], yaw: 0, points: focus, kind: 'component' as const } } : subjects;
  const ids = focus.length ? [...scoreIds, 'focus:pick'] : scoreIds;
  cands.forEach((h) => {
    const ps = poses(h + (over.bearingOffset ?? 0));
    let bad = 0;
    ps.forEach((p, i) => { if (!placement(ctx.world, p.position).valid) bad++; if (i && raycast(ctx.world, ps[i - 1].position, p.position, 'collide')) bad++; });
    const read = ids.length ? readability(ctx.world, ps[0], scored, ids, { aspect: ctx.aspect, safeBottom: ctx.safeBottom }).score : 1;
    const key: [number, number] = [bad, -Math.round(read * 20)];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { bestKey = key; best = h; }
  });
  return { heading: best + (over.bearingOffset ?? 0), searched: true };
}

type MoveFail = { code: string; message: string };
/** Duration of an eased move of `amount` (deg or m) under a peak-velocity cap and a peak-acceleration cap. */
function easedDuration(intent: ShotIntent, amount: number, defaultSpeed: number, velCap: number, accCap: number, unit: string, over: SynthOverrides): { T: number } | MoveFail {
  const d = intent.direction;
  const Tmin = Math.max((EASE_PEAK_VEL * amount) / velCap, Math.sqrt((EASE_PEAK_ACC * amount) / accCap));
  if (over.duration !== undefined) return { T: over.duration };
  if (d.duration !== undefined) {
    if (d.duration + 1e-9 < Tmin) return { code: 'camera.direct.motion-cap', message: `direction ${intent.index}: ${d.motion.verb} of ${r2(amount)}${unit} in ${d.duration} s exceeds the motion caps (peak ${r2((EASE_PEAK_VEL * amount) / d.duration)}${unit}/s > ${velCap}${unit}/s) — needs ≥ ${r2(Tmin)} s` };
    return { T: d.duration };
  }
  const T = d.speed !== undefined ? amount / d.speed : amount / defaultSpeed;
  return { T: Math.max(T, Tmin, 1) };
}

function timeline(ctx: SynthContext, intent: ShotIntent, T: number): { N: number; T: number } | MoveFail {
  const N = Math.max(1, Math.round(T * ctx.hz));
  const Tq = N / ctx.hz;
  if (intent.t0 + Tq > ctx.duration + 1e-6) return { code: 'camera.direct.beyond-take', message: `direction ${intent.index}: ${intent.verb} from ${r2(intent.t0)} s for ${r2(Tq)} s ends after the take (${r2(ctx.duration)} s)` };
  return { N, T: Tq };
}

const fail = (m: MoveFail, extra: Partial<Diagnostic> = {}): SynthResult => ({ ok: false, diagnostic: { code: m.code, message: m.message, ...extra } });

/** Static focus points on the camera-facing side of a box, at the lateral position of a look point (readability for sweeps). */
function faceFocus(target: Vec3, camera: Vec3, box: { min: Vec3; max: Vec3 }): Vec3[] {
  const toCam = norm([camera[0] - target[0], 0, camera[2] - target[2]]);
  // exit of the horizontal ray target → camera from the box footprint (0 when the target is already outside it)
  let tExit = Infinity;
  for (const j of [0, 2]) if (Math.abs(toCam[j]) > 1e-9) tExit = Math.min(tExit, ((toCam[j] > 0 ? box.max[j] : box.min[j]) - target[j]) / toCam[j]);
  const t = Number.isFinite(tExit) ? Math.max(0, tExit) : 0;
  const H = box.max[1] - box.min[1];
  return [0.25, 0.5, 0.75].map((f) => [target[0] + toCam[0] * t, box.min[1] + f * H, target[2] + toCam[2] * t] as Vec3);
}

/** Synthesize one intent into keyed poses. `prev` = the previous shot's last pose (continuity for fly_through / heading). */
export function synthesizeShot(intent: ShotIntent, ctx: SynthContext, prev?: PrevPose, over: SynthOverrides = {}): SynthResult {
  const d = intent.direction;
  const fov = intent.fov;
  const aspect = ctx.aspect;
  const vfov = fov * DEG, hfov = hfovOf(fov, aspect);
  const fr = framedOf(d);
  const s = intent.subject;
  const t0 = intent.t0;
  const geo0 = geometry(s, ctx.sampler, t0);
  if (!geo0) return { ok: false, diagnostic: { code: 'camera.direct.subject-absent', message: `direction ${intent.index}: subject ${s.id} has no geometry at t=${r2(t0)} s`, subjects: [s.id] } };
  const params: Record<string, unknown> = {};
  const notes: string[] = [];
  const fit = (R: number, f = fr.fill) => fitDistance(R / f, fov, aspect, ctx.safeBottom) * (over.distanceScale ?? 1);
  const interior = !!intent.interior;
  const speedCap = interior ? MOTION_CAPS.speedInterior : MOTION_CAPS.speedExterior;
  const minY = ctx.groundY + 0.6;
  let keys: Key[] = [];
  let focus: Vec3[][] | undefined;
  let scoreIds = [...s.ids];

  const build = (N: number, T: number, poseAt: (u: number, t: number) => CameraPose, topAt?: (t: number) => Vec3 | null): Key[] => {
    const out: Key[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / ctx.hz, u = T > 0 ? t / T : 1;
      const raw = poseAt(u, t0 + t);
      const pose = reframe(raw, topAt ? topAt(t0 + t) : null, d, aspect, ctx.safeBottom);
      out.push({ t: q6(t), position: pose.position, target: pose.target });
    }
    return out;
  };

  switch (d.motion.verb) {
    case 'orbit': {
      const deg = d.motion.degrees, sign = d.motion.direction === 'ccw' ? -1 : 1;
      const dur = easedDuration(intent, deg, DEFAULT_SPEEDS.orbitDeg, MOTION_CAPS.viewOmegaDeg, MOTION_CAPS.viewAlphaDeg, '°', over);
      if ('code' in dur) return fail(dur);
      const tl = timeline(ctx, intent, dur.T);
      if ('code' in tl) return fail(tl);
      const t1 = t0 + tl.T;
      // radius: the largest extent over the window about the (predicted) centre, fitted to the lens at the framing
      let R = 0;
      for (let t = t0; t <= t1 + 1e-9; t += 0.5) {
        const g = geometry(s, ctx.sampler, t), c = centreAt(s, ctx.sampler, t, t0, t1);
        if (g && c) for (const p of g.points) R = Math.max(R, len(sub(p, c)));
      }
      R += SUBJECT_PAD;
      const dist = fit(R);
      const hr = dist * dcos(fr.elevation), rise = Math.max(dist * dsin(fr.elevation) + (over.heightOffset ?? 0), minY - geo0.centre[1]);
      const c0 = centreAt(s, ctx.sampler, t0, t0, t1)!;
      const posAt = (h: number, c: Vec3): Vec3 => [c[0] + hr * dcos(h), c[1] + rise, c[2] + hr * dsin(h)];
      const arc = (h: number) => Array.from({ length: Math.ceil(deg / 10) + 1 }, (_, k) => ({ position: posAt(h + (sign * deg * DEG * k) / Math.ceil(deg / 10), c0), target: c0, fov }));
      const pick = pickHeading(ctx, intent, over, prev, c0, arc, scoreIds, s.dynamic ? [] : geo0.points.slice(0, 8));
      const h0 = pick.heading;
      keys = build(tl.N, tl.T, (u, t) => { const c = centreAt(s, ctx.sampler, t, t0, t1) ?? c0; return { position: posAt(h0 + sign * deg * DEG * ease(u), c), target: c, fov }; });
      Object.assign(params, { orbitRadius: r2(hr), orbitHeight: r2(c0[1] + rise), distance: r2(dist), boundingRadius: r2(R), elevationDeg: degs(fr.elevation), degrees: deg, direction: sign > 0 ? 'cw' : 'ccw', startHeadingDeg: degs(h0), startCompassDeg: compassOf(hdir(h0)), headingSearched: pick.searched, centre: s.dynamic ? 'group centroid averaged ±1 s (follows the group)' : r3v(c0) });
      if (!s.dynamic && !scoreIds.length) focus = keys.map(() => geo0.points.slice(0, 8));
      break;
    }
    case 'hold':
    case 'push_in':
    case 'pull_out':
    case 'crane': {
      const verb = d.motion.verb;
      const R = geo0.radius + SUBJECT_PAD;
      const dWide = fit(R, FRAMING.wide.fill), dClose = fit(R, FRAMING.close.fill), dMid = fit(R);
      const craneRise = verb === 'crane' ? (d.motion.verb === 'crane' && d.motion.rise !== undefined ? d.motion.rise : Math.max(3, dMid * dcos(fr.elevation) * dtan(40 * DEG))) : 0;
      const craneUp = verb === 'crane' && !(d.motion.verb === 'crane' && d.motion.direction === 'down');
      const amount = verb === 'push_in' || verb === 'pull_out' ? dWide - dClose : verb === 'crane' ? craneRise : 0;
      let T: number;
      if (verb === 'hold') T = over.duration ?? d.duration ?? DEFAULT_HOLD;
      else {
        const dur = easedDuration(intent, amount, verb === 'crane' ? DEFAULT_SPEEDS.crane : DEFAULT_SPEEDS.push, speedCap, MOTION_CAPS.accel, ' m', over);
        if ('code' in dur) return fail(dur);
        T = dur.T;
      }
      const tl = timeline(ctx, intent, T);
      if ('code' in tl) return fail(tl);
      const t1 = t0 + tl.T;
      const c0 = centreAt(s, ctx.sampler, t0, t0, t1)!;
      const el = fr.elevation;
      const off = (h: number, u: number): Vec3 => {
        if (verb === 'push_in' || verb === 'pull_out') { const dd = verb === 'push_in' ? dWide + (dClose - dWide) * ease(u) : dClose + (dWide - dClose) * ease(u); return [dd * dcos(el) * dcos(h), Math.max(dd * dsin(el), minY - c0[1]), dd * dcos(el) * dsin(h)]; }
        if (verb === 'crane') { const hr = dMid * dcos(el); const y0 = minY + 0.6 - c0[1]; const y = craneUp ? y0 + craneRise * ease(u) : y0 + craneRise * (1 - ease(u)); return [hr * dcos(h), y, hr * dsin(h)]; }
        return [dMid * dcos(el) * dcos(h), Math.max(dMid * dsin(el), minY - c0[1]), dMid * dcos(el) * dsin(h)];
      };
      const withH = (h: number) => (u: number, c: Vec3): CameraPose => { const o = off(h, u); return { position: [c[0] + o[0], c[1] + o[1] + (over.heightOffset ?? 0), c[2] + o[2]], target: c, fov }; };
      const pick = pickHeading(ctx, intent, over, prev, c0, (h) => [0, 0.5, 1].map((u) => withH(h)(u, c0)), scoreIds, s.dynamic ? [] : geo0.points.slice(0, 8));
      const pose = withH(pick.heading);
      keys = build(tl.N, tl.T, (u, t) => pose(u, centreAt(s, ctx.sampler, t, t0, t1) ?? c0), (t) => { const g = geometry(s, ctx.sampler, t); return g ? [g.centre[0], g.max[1], g.centre[2]] : null; });
      Object.assign(params, { headingDeg: degs(pick.heading), compassDeg: compassOf(hdir(pick.heading)), headingSearched: pick.searched, boundingRadius: r2(R), elevationDeg: degs(el) });
      if (verb === 'hold') params.distance = r2(dMid);
      if (verb === 'push_in' || verb === 'pull_out') Object.assign(params, { fromDistance: r2(verb === 'push_in' ? dWide : dClose), toDistance: r2(verb === 'push_in' ? dClose : dWide) });
      if (verb === 'crane') Object.assign(params, { rise: r2(craneRise), direction: craneUp ? 'up' : 'down', distance: r2(dMid) });
      if (!s.dynamic && !scoreIds.length) focus = keys.map(() => geo0.points.slice(0, 8));
      break;
    }
    case 'pan':
    case 'tilt':
    case 'dolly': {
      const verb = d.motion.verb;
      const box = { min: geo0.min, max: geo0.max };
      const c = geo0.centre;
      const H = Math.max(1, box.max[1] - box.min[1]);
      const pts = geo0.points;
      const lateral = (h: number) => { const r: Vec3 = [dsin(h), 0, -dcos(h)]; let w = 0, dep = 0; for (const p of pts) { w = Math.max(w, Math.abs(dot(sub(p, c), r))); dep = Math.max(dep, Math.abs(dot(sub(p, c), hdir(h)))); } return { r, w, dep }; };
      // distance: pan/dolly frame the subject's height at the framing fill; tilt frames its width
      const distFor = (h: number) => { const { w, dep } = lateral(h); const across = verb === 'tilt' ? (2 * w) / fr.fill / (2 * dtan(hfov / 2)) : H / fr.fill / (2 * dtan(vfov / 2)); return (dep + Math.max(1.5, across)) * (over.distanceScale ?? 1); };
      const eye = ctx.groundY + 1.7;
      const pick = pickHeading(ctx, intent, over, prev, c, (h) => { const dd = distFor(h); const p: Vec3 = [c[0] + dd * dcos(h), Math.max(eye, c[1]), c[2] + dd * dsin(h)]; return [{ position: p, target: c, fov }]; }, [], s.dynamic ? [] : geo0.points.slice(0, 8));
      const h = pick.heading;
      const { r, w } = lateral(h);
      let dist = distFor(h);
      const view = mul(hdir(h), -1);
      // lateral sweep (pan / dolly) in metres at the subject: its half width, or the requested angle
      let half = w;
      if (verb === 'pan' && d.motion.verb === 'pan' && d.motion.degrees !== undefined) half = dist * dtan((d.motion.degrees * DEG) / 2);
      if (verb === 'dolly' && d.motion.verb === 'dolly' && d.motion.distance !== undefined) half = d.motion.distance / 2;
      if (intent.sun && verb === 'pan') {
        const maxHalf = intent.sun.cameraHeading.halfWidth - 1 * DEG;
        if (datan(half / dist) > maxHalf) { dist = half / dtan(maxHalf); notes.push(`distance raised to ${r2(dist)} m so the sun stays in frame across the whole pan`); }
      }
      const sgn = (verb === 'pan' && d.motion.verb === 'pan' && d.motion.direction === 'left') || (verb === 'dolly' && d.motion.verb === 'dolly' && d.motion.direction === 'left') ? -1 : 1;
      // camera height: eye level, unless the sun window dictates the pitch
      let camY = Math.max(eye, Math.min(c[1], eye + 2)) + (over.heightOffset ?? 0);
      let lookY = c[1];
      if (intent.sun) {
        const sw = intent.sun;
        const pref = datan2(lookY - camY, dist);
        // upper 65% of the window: near its low end the sun sits by the top edge, and perspective lifts it out
        // of frame at the ends of a sweep
        const pitch = clampN(pref, sw.pitch.min + 0.35 * (sw.pitch.max - sw.pitch.min), sw.pitch.max - 1 * DEG);
        if (sw.pitch.min + 1 * DEG > sw.pitch.max - 1 * DEG) return { ok: false, diagnostic: { code: 'camera.direct.sun-window', message: `direction ${intent.index}: fov ${fov}° leaves no pitch that keeps the sun in frame and ≥ ${sw.flareDeg}° off axis` } };
        if (pitch !== pref) {
          camY = lookY - dist * dtan(pitch);
          if (camY < ctx.groundY + 0.4) { camY = ctx.groundY + 0.4; lookY = camY + dist * dtan(pitch); notes.push(`look point raised to y=${r2(lookY)} to keep the sun (${r2(sw.sun.elevationDeg)}° up) in frame from ground level`); }
          else notes.push(`camera height set to y=${r2(camY)} so the sun sits ${r2(sw.sun.elevationDeg - pitch / DEG)}° above the optical axis`);
        }
        if (lookY > box.max[1] + H) return { ok: false, diagnostic: { code: 'camera.direct.sun-window', message: `direction ${intent.index}: the sun is ${r2(sw.sun.elevationDeg)}° up at ${sw.datetime}; keeping it in frame behind ${s.id} would aim the camera ${r2(lookY - box.max[1])} m above the subject — shoot at a lower sun` } };
      }
      const camFixed: Vec3 = [c[0] + dist * dcos(h), camY, c[2] + dist * dsin(h)];
      let amount: number, unit: string, vcap: number, acap: number, dflt: number;
      if (verb === 'pan') { amount = (2 * datan(half / dist)) / DEG; unit = '°'; vcap = MOTION_CAPS.viewOmegaDeg; acap = MOTION_CAPS.viewAlphaDeg; dflt = DEFAULT_SPEEDS.panDeg; }
      else if (verb === 'tilt') {
        const lo = box.min[1] + 0.1, hi = box.max[1];
        amount = d.motion.verb === 'tilt' && d.motion.degrees !== undefined ? d.motion.degrees : (datan2(hi - camY, dist) - datan2(lo - camY, dist)) / DEG;
        unit = '°'; vcap = MOTION_CAPS.viewOmegaDeg; acap = MOTION_CAPS.viewAlphaDeg; dflt = DEFAULT_SPEEDS.tiltDeg;
      } else { amount = 2 * half; unit = ' m'; vcap = speedCap; acap = MOTION_CAPS.accel; dflt = DEFAULT_SPEEDS.dolly; }
      const dur = easedDuration(intent, amount, dflt, vcap, acap, unit, over);
      if ('code' in dur) return fail(dur);
      const tl = timeline(ctx, intent, d.duration !== undefined || over.duration !== undefined ? dur.T : Math.max(dur.T, 4));
      if ('code' in tl) return fail(tl);
      const up = !(d.motion.verb === 'tilt' && d.motion.direction === 'down');
      const tiltP0 = datan2(box.min[1] + 0.1 - camY, dist), tiltP1 = tiltP0 + amount * DEG;
      const poseAt = (u: number): CameraPose => {
        const e = ease(u);
        if (verb === 'tilt') {
          const p = up ? tiltP0 + (tiltP1 - tiltP0) * e : tiltP1 + (tiltP0 - tiltP1) * e;
          return { position: camFixed, target: [camFixed[0] + view[0] * dist, camY + dist * dtan(p), camFixed[2] + view[2] * dist], fov };
        }
        const x = sgn * (-half + 2 * half * e);
        const tgt: Vec3 = [c[0] + r[0] * x, lookY, c[2] + r[2] * x];
        if (verb === 'dolly') return { position: [camFixed[0] + r[0] * x, camY, camFixed[2] + r[2] * x], target: tgt, fov };
        return { position: camFixed, target: tgt, fov };
      };
      // sweeps keep the authored aim (no thirds/headroom re-aim, which would fight the sweep); safe area still applies
      keys = [];
      for (let i = 0; i <= tl.N; i++) { const t = i / ctx.hz; const p = aimForSafeArea(poseAt(t / tl.T), ctx.safeBottom); keys.push({ t: q6(t), position: p.position, target: p.target }); }
      if (d.framing?.thirds || d.framing?.headroom !== undefined) notes.push(`${verb}: thirds/headroom ignored (the sweep sets the aim)`);
      focus = keys.map((k) => faceFocus(verb === 'tilt' ? [c[0], k.target[1], c[2]] : [k.target[0], c[1], k.target[2]], k.position, box));
      scoreIds = [];
      Object.assign(params, { headingDeg: degs(h), compassDeg: compassOf(hdir(h)), headingSearched: pick.searched, distance: r2(dist), cameraHeight: r2(camY), lookHeight: r2(lookY) });
      if (verb === 'pan') Object.assign(params, { sweepDeg: r2(amount), halfWidth: r2(half), direction: sgn > 0 ? 'right' : 'left' });
      if (verb === 'tilt') Object.assign(params, { sweepDeg: r2(amount), direction: up ? 'up' : 'down' });
      if (verb === 'dolly') Object.assign(params, { travel: r2(2 * half), direction: sgn > 0 ? 'right' : 'left' });
      break;
    }
    case 'fly_through': {
      const res = synthFly(intent, ctx, prev, over, geo0, fr);
      if (!res.ok) return res;
      keys = res.keys;
      Object.assign(params, res.params);
      notes.push(...res.notes);
      if (res.focus) focus = keys.map(() => res.focus!);
      if (!s.dynamic) scoreIds = [];
      break;
    }
  }

  // sun: verify every sample against the sun model (the window is a derivation; this is the check)
  if (intent.sun) {
    const sw = intent.sun;
    let inWindow = 0, inFrame = 0, minOff = Infinity, maxNdc = 0;
    for (const k of keys) {
      const hd = datan2(k.position[2] - k.target[2], k.position[0] - k.target[0]);
      if (Math.abs(wrap(hd - sw.cameraHeading.centre)) <= sw.cameraHeading.halfWidth + 1e-9) inWindow++;
      const f = sunInFrame({ position: k.position, target: k.target, fov }, sw.sun.direction, aspect, sw.marginDeg);
      if (f.inFrame) inFrame++;
      minOff = Math.min(minOff, f.offAxisDeg);
      maxNdc = Math.max(maxNdc, Math.abs(f.ndc[0]), Math.abs(f.ndc[1]));
    }
    const lo = sw.cameraHeading.centre - sw.cameraHeading.halfWidth, hi = sw.cameraHeading.centre + sw.cameraHeading.halfWidth;
    params.sun = {
      datetime: sw.datetime, azimuthDeg: r2(sw.sun.azimuthDeg), elevationDeg: r2(sw.sun.elevationDeg),
      cameraHeadingWindowDeg: [degs(lo), degs(hi)], cameraCompassWindowDeg: [compassOf(hdir(lo)), compassOf(hdir(hi))],
      pitchWindowDeg: [degs(sw.pitch.min), degs(sw.pitch.max)], flareDeg: sw.flareDeg,
      samplesInWindow: inWindow, samplesSunInFrame: inFrame, samples: keys.length, minOffAxisDeg: r2(minOff), maxAbsNdc: r2(maxNdc),
    };
    if (inWindow < keys.length || inFrame < keys.length || minOff < sw.flareDeg) return { ok: false, diagnostic: { code: 'camera.direct.sun-window', message: `direction ${intent.index}: the computed move leaves the sun window (${inWindow}/${keys.length} samples in the heading window, ${inFrame}/${keys.length} with the sun in frame, min ${r2(minOff)}° off axis < ${sw.flareDeg}°)`, details: { sun: params.sun } } };
  }

  // motion caps on the actual samples
  const peaks = motionPeaks(keys, ctx.hz);
  params.peaks = peaks;
  const capV = interior ? MOTION_CAPS.speedInterior : MOTION_CAPS.speedExterior;
  const over1 = peaks.viewOmegaDeg > MOTION_CAPS.viewOmegaDeg + 0.5 || peaks.viewAlphaDeg > MOTION_CAPS.viewAlphaDeg + 1 || peaks.speed > capV + 0.05 || peaks.accel > MOTION_CAPS.accel + 0.1;
  if (over1) {
    const scale = Math.max(peaks.viewOmegaDeg / MOTION_CAPS.viewOmegaDeg, Math.sqrt(peaks.viewAlphaDeg / MOTION_CAPS.viewAlphaDeg), peaks.speed / capV, Math.sqrt(peaks.accel / MOTION_CAPS.accel));
    const T = keys[keys.length - 1].t;
    if (d.duration === undefined && over.duration === undefined && scale < 20) return synthesizeShot(intent, ctx, prev, { ...over, duration: Math.ceil(T * scale * 1.05 * ctx.hz) / ctx.hz });
    return { ok: false, diagnostic: { code: 'camera.direct.motion-cap', message: `direction ${intent.index}: the computed ${intent.verb} peaks at ${peaks.viewOmegaDeg}°/s, ${peaks.viewAlphaDeg}°/s², ${peaks.speed} m/s, ${peaks.accel} m/s² (caps ${MOTION_CAPS.viewOmegaDeg}°/s, ${MOTION_CAPS.viewAlphaDeg}°/s², ${capV} m/s, ${MOTION_CAPS.accel} m/s²) — needs ≥ ${r2(T * scale)} s`, details: { peaks, caps: MOTION_CAPS } } };
  }

  const focusId = `focus:${intent.index}`;
  const subjects = focus ? [...scoreIds, focusId] : scoreIds;
  const T = keys[keys.length - 1].t;
  return {
    ok: true,
    shot: {
      index: intent.index, label: intent.label, verb: intent.verb, t0, t1: q6(t0 + T), fov, keys, subjects,
      ...(focus ? { focus: { id: focusId, points: focus } } : {}),
      params: { duration: r2(T), fov, framing: fr.size, ...params }, notes, validation: validateKeys(ctx.world, keys), corrections: [],
    },
  };
}

/** Area centroid of a polygon (shoelace), at height y; the vertex mean if degenerate. */
function areaCentroid(poly: [number, number][], y: number): Vec3 {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cr = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += cr; cx += (poly[j][0] + poly[i][0]) * cr; cz += (poly[j][1] + poly[i][1]) * cr;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, y, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), y, cz / (3 * a)];
}

type FlyOk = { ok: true; keys: Key[]; params: Record<string, unknown>; notes: string[]; focus?: Vec3[] };
function synthFly(intent: ShotIntent, ctx0: SynthContext, prev: PrevPose | undefined, over: SynthOverrides, geo0: Geo, fr: Framed): FlyOk | { ok: false; diagnostic: Diagnostic } {
  const d = intent.direction;
  // re-route (phase 2): the route is searched with a wider camera radius and / or extra obstacles (the take's parts)
  const navR = over.navRadius ?? MIN_CLEARANCE;
  const ctx: SynthContext = over.avoid?.length ? { ...ctx0, world: new CameraWorld({ ...ctx0.scene, obstacles: [...ctx0.scene.obstacles, ...over.avoid] }, ctx0.policy), navmeshes: new Map() } : ctx0;
  const eyeY = ctx.groundY + EYE_HEIGHT;
  const room = intent.interior ?? (intent.subject.kind === 'region' ? intent.subject : undefined);
  const poly = room?.polygon;
  const params: Record<string, unknown> = {};
  const notes: string[] = [];
  // goal viewpoint + final look target
  let goal: Vec3, finalTarget: Vec3, focus: Vec3[] | undefined;
  const probeMesh = navmeshFor(ctx, geo0.centre, geo0.centre, 12);
  if (intent.lookAt?.box) {
    const b = intent.lookAt.box;
    const L: Vec3 = [(b.min[0] + b.max[0]) / 2, b.max[1] + 0.02, (b.min[2] + b.max[2]) / 2];
    const skip = new Set(intent.lookAt.members ?? []);
    const roomC: Vec3 = poly ? areaCentroid(poly, eyeY) : geo0.centre;
    const prefer = datan2(roomC[2] - L[2], roomC[0] - L[0]);
    const sizes: ('close' | 'medium' | 'wide')[] = [fr.size, ...(['medium', 'close', 'wide'] as const).filter((x) => x !== fr.size)];
    let found: { p: Vec3; score: number; dist: number } | null = null;
    for (const size of sizes) {
      const dist = FIXTURE_DISTANCE[size];
      for (let k = 0; k < 24; k++) {
        const h = (k * TAU) / 24;
        const p: Vec3 = [L[0] + dist * dcos(h), eyeY + (over.heightOffset ?? 0), L[2] + dist * dsin(h)];
        if (poly && !pointInPolygon(p[0], p[2], poly)) continue;
        if (!placement(ctx.world, p).valid) continue;
        const g0 = probeMesh.layers[0];
        const idx = cellOf(g0, [p[0], p[2]]);
        const kEye = NAV_LAYERS.indexOf(EYE_HEIGHT);
        if (idx < 0 || !probeMesh.free(kEye, idx)) continue;
        if (raycast(ctx.world, p, L, 'occlude', skip)) continue;
        const score = Math.abs(wrap(h - prefer));
        if (!found || score < found.score - 1e-9) found = { p, score, dist };
      }
      if (found) break;
    }
    if (!found) return { ok: false, diagnostic: { code: 'camera.direct.no-viewpoint', message: `direction ${intent.index}: no free eye-level viewpoint${poly ? ` inside ${room!.id}` : ''} with a clear view of ${intent.lookAt.id} ('${intent.lookAt.label}') within ${FIXTURE_DISTANCE.wide} m`, subjects: [intent.lookAt.id] } };
    goal = found.p;
    finalTarget = L;
    focus = [L, [b.min[0], L[1], b.min[2]], [b.max[0], L[1], b.min[2]], [b.min[0], L[1], b.max[2]], [b.max[0], L[1], b.max[2]]];
    Object.assign(params, { lookAt: intent.lookAt.id, lookAtPoint: r3v(L), viewpoint: r3v(goal), viewDistance: found.dist });
  } else if (poly) {
    const c: Vec3 = areaCentroid(poly, eyeY);
    const n = probeMesh.snap(c, 3);
    if (!n) return { ok: false, diagnostic: { code: 'camera.direct.no-viewpoint', message: `direction ${intent.index}: ${room!.id} has no free camera space near its centre` } };
    goal = probeMesh.point(n);
    finalTarget = [c[0], eyeY, c[2]]; // replaced below by the approach direction once the start is known
    Object.assign(params, { viewpoint: r3v(goal) });
  } else {
    goal = [geo0.centre[0], Math.max(eyeY, geo0.centre[1]), geo0.centre[2]];
    finalTarget = geo0.centre;
  }
  // start: explicit, the previous camera, or an exterior viewpoint in front of the room
  let start: Vec3;
  if (d.motion.verb === 'fly_through' && d.motion.from) start = d.motion.from as Vec3;
  else if (prev) start = prev.position;
  else {
    const R = geo0.radius + SUBJECT_PAD;
    const away = norm([goal[0] - finalTarget[0], 0, goal[2] - finalTarget[2]]);
    start = [goal[0] + away[0] * (R + 4), eyeY + 1, goal[2] + away[2] * (R + 4)];
  }
  if (!intent.lookAt && poly) { const a = norm([goal[0] - start[0], 0, goal[2] - start[2]]); finalTarget = [goal[0] + a[0] * 3, eyeY, goal[2] + a[2] * 3]; }
  const sp = placement(ctx.world, start);
  if (!sp.valid) return { ok: false, diagnostic: { code: 'camera.nav.start-blocked', message: `direction ${intent.index}: fly_through start (${r3v(start).join(', ')}) is not a valid camera position: ${sp.reason}`, at: r3v(start) } };
  const mesh = navmeshFor(ctx, start, goal, 8, navR);
  const straight = raycast(ctx.world, start, goal, 'collide');
  const route = mesh.route(start, goal);
  if (!route.ok) return { ok: false, diagnostic: { ...route.diagnostic, message: `direction ${intent.index}: ${route.diagnostic.message}` } };
  const pts = [start, ...route.points, goal];
  const sm = smoothRoute(pts, ctx.world, navR);
  if (!sm.ok) return { ok: false, diagnostic: { ...sm.diagnostic, message: `direction ${intent.index}: ${sm.diagnostic.message}` } };
  const dense = sm.dense;
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + len(sub(dense[i], dense[i - 1])));
  const L = cum[cum.length - 1];
  const interior = !!intent.interior;
  const speedCap = interior ? MOTION_CAPS.speedInterior : MOTION_CAPS.speedExterior;
  // view direction as a function of arc length: look along the route, turn onto the final target over the last B metres
  const AHEAD = 4, B = Math.min(L, Math.max(3, 0.6 * L));
  // the curve's own end tangent (last dense segment), so the look-ahead point moves on with the same velocity
  let endTan = norm(sub(dense[dense.length - 1], along(dense, cum, L - 0.05)));
  if (!(len(endTan) > 0.5)) endTan = norm([finalTarget[0] - goal[0], 0, finalTarget[2] - goal[2]]);
  const viewAt = (sArc: number, p: Vec3): Vec3 => {
    const past = sArc + AHEAD - L; // past the end the look-ahead continues along the end tangent (continuous)
    const aheadP = past > 0 ? addv(dense[dense.length - 1], mul(endTan, past)) : along(dense, cum, sArc + AHEAD);
    const ah = sub(aheadP, p);
    const dAhead = norm([ah[0], 0, ah[2]]);
    const dFinal = norm(sub(finalTarget, p));
    const w = smoothstep((sArc - (L - B)) / B);
    // blend by angles (shortest heading turn, then pitch): a vector lerp would spin through a near-zero vector
    const a0 = len(dAhead) > 0.5 ? dAhead : dFinal;
    const h0 = datan2(a0[2], a0[0]), p0 = datan2(a0[1], hypot(a0[0], a0[2]));
    const h1 = datan2(dFinal[2], dFinal[0]), p1 = datan2(dFinal[1], hypot(dFinal[0], dFinal[2]));
    const hh = h0 + wrap(h1 - h0) * w, pp = p0 + (p1 - p0) * w;
    return [dcos(pp) * dcos(hh), dsin(pp), dcos(pp) * dsin(hh)];
  };
  // speed profile along the curve: v ≤ cap, v ≤ ω_cap / (dθ/ds) (slow down where the view turns), |dv/dt| ≤ a_cap,
  // 0 at both ends; then an opening (moving min, then moving mean over ±0.75 m) that never exceeds any bound
  const dirs = dense.map((q, i) => viewAt(cum[i], q));
  const vcap = Math.min(speedCap, d.speed ?? (d.duration === undefined ? DEFAULT_SPEEDS.fly : speedCap));
  const wcap = 0.85 * MOTION_CAPS.viewOmegaDeg * DEG, acap = 0.85 * MOTION_CAPS.accel;
  const n = dense.length;
  const vmax = new Array(n).fill(vcap);
  // signed view rotation per metre (rotation vector κ, rad/m), smoothed over ±0.5 m; ω = |κ|·v and
  // dω/dt ≈ κ'·v² + κ·a, so v ≤ ω_cap/|κ| and v ≤ √(½·α_cap/|κ'|)
  const kap: Vec3[] = dense.map(() => [0, 0, 0]);
  for (let i = 1; i < n; i++) {
    const ds = cum[i] - cum[i - 1];
    if (ds < 1e-9) continue;
    const a = dirs[i - 1], b = dirs[i];
    const cr: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const sn = len(cr), c = clampN(dot(a, b), -1, 1);
    kap[i] = sn > 1e-12 ? mul(cr, datan2(sn, c) / sn / ds) : [0, 0, 0];
  }
  const KW = Math.max(1, Math.round((0.5 * (n - 1)) / Math.max(1e-9, L)));
  const kS = kap.map((_, i) => { let acc: Vec3 = [0, 0, 0], c = 0; for (let j = Math.max(1, i - KW); j <= Math.min(n - 1, i + KW); j++) { acc = addv(acc, kap[j]); c++; } return c ? mul(acc, 1 / c) : acc; });
  const alcap = 0.5 * 0.85 * MOTION_CAPS.viewAlphaDeg * DEG;
  for (let i = 1; i < n; i++) {
    const k = len(kS[i]);
    let v = k > 1e-9 ? wcap / k : Infinity;
    const ia = Math.max(1, i - KW), ib = Math.min(n - 1, i + KW); // κ' over a ±0.5 m stencil (the polyline's 5 cm kinks are noise)
    if (ib > ia) {
      const dk = len(sub(kS[ib], kS[ia])) / Math.max(1e-9, cum[ib] - cum[ia]);
      if (dk > 1e-9) v = Math.min(v, Math.sqrt(alcap / dk));
    }
    if (v < vmax[i]) vmax[i] = v;
    if (v < vmax[i - 1]) vmax[i - 1] = v;
  }
  // opening of the limits (moving min, then moving mean over ±0.75 m: never above any limit), then the
  // acceleration passes with v = 0 at both ends
  vmax[0] = vmax[1] ?? vcap; vmax[n - 1] = vmax[n - 2] ?? vcap;
  const W = Math.max(1, Math.round((0.75 * (n - 1)) / Math.max(1e-9, L)));
  const mn = vmax.map((_, i) => { let m = Infinity; for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) m = Math.min(m, vmax[j]); return m; });
  const vel = mn.map((_, i) => { let a = 0, c = 0; for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) { a += mn[j]; c++; } return a / c; });
  vel[0] = 0; vel[n - 1] = 0;
  // |a| ≤ a_cap and, where the view turns, |κ|·|a| ≤ ½·α_cap
  const acc = kS.map((k) => Math.min(acap, len(k) > 1e-9 ? alcap / len(k) : acap));
  for (let i = 1; i < n; i++) vel[i] = Math.min(vel[i], Math.sqrt(vel[i - 1] * vel[i - 1] + 2 * Math.min(acc[i], acc[i - 1]) * (cum[i] - cum[i - 1])));
  for (let i = n - 2; i >= 0; i--) vel[i] = Math.min(vel[i], Math.sqrt(vel[i + 1] * vel[i + 1] + 2 * Math.min(acc[i], acc[i + 1]) * (cum[i + 1] - cum[i])));
  const times = [0];
  for (let i = 1; i < n; i++) { const vv = vel[i - 1] + vel[i]; times.push(times[i - 1] + (vv > 1e-9 ? (2 * (cum[i] - cum[i - 1])) / vv : 0)); }
  const Tprof = times[n - 1];
  const want = over.duration ?? d.duration;
  if (want !== undefined && want + 1e-6 < Tprof) return { ok: false, diagnostic: { code: 'camera.direct.motion-cap', message: `direction ${intent.index}: this ${r2(L)} m route needs ≥ ${r2(Tprof)} s under the motion caps (≤ ${vcap} m/s, view ≤ ${MOTION_CAPS.viewOmegaDeg}°/s, ≤ ${MOTION_CAPS.accel} m/s²); ${want} s was asked` } };
  const dil = want !== undefined ? want / Math.max(1e-9, Tprof) : 1;
  const tl = timeline(ctx, intent, Tprof * dil);
  if ('code' in tl) return { ok: false, diagnostic: { code: tl.code, message: tl.message } };
  const keys: Key[] = [];
  let seg = 1;
  for (let i = 0; i <= tl.N; i++) {
    const t = (i / ctx.hz) / (tl.T / Math.max(1e-9, Tprof)); // profile time (quantised duration absorbed by the dilation)
    while (seg < n - 1 && times[seg] < t) seg++;
    const ta = times[seg - 1], tb = times[seg];
    const u = tb > ta ? clampN((t - ta) / (tb - ta), 0, 1) : 1;
    const sArc = i === tl.N ? L : cum[seg - 1] + (cum[seg] - cum[seg - 1]) * u;
    const p = along(dense, cum, sArc);
    const dist = Math.max(1, len(sub(finalTarget, p)));
    const pose = aimForSafeArea({ position: p, target: addv(p, mul(viewAt(sArc, p), dist)), fov: intent.fov }, ctx.safeBottom);
    keys.push({ t: q6(i / ctx.hz), position: pose.position, target: pose.target });
  }
  params.speedProfile = { capSpeed: vcap, minimumDuration: r2(Tprof), slowestCruise: r2(Math.min(...vel.slice(Math.floor(n * 0.1), Math.ceil(n * 0.9)))) };
  // where the route enters the room: what it passes over near the boundary (a half wall / counter; walls first,
  // then the highest), else the solids beside the opening at camera height
  if (poly) {
    const inIdx = dense.findIndex((q) => pointInPolygon(q[0], q[2], poly));
    if (inIdx > 0) {
      const at = dense[inIdx];
      const hDist = (q: { cx: number; cz: number; c: number; s: number; hx: number; hz: number }, x: number, z: number) => hypot(Math.max(0, Math.abs((x - q.cx) * q.c + (z - q.cz) * q.s) - q.hx), Math.max(0, Math.abs(-(x - q.cx) * q.s + (z - q.cz) * q.c) - q.hz));
      const tall = (q: { collide: boolean; y1: number }) => q.collide && q.y1 > ctx.groundY + 0.5; // floor-level parts are not the opening
      let over: { label: string; top: number; wall: boolean } | null = null;
      for (let j = 1; j < dense.length; j++) {
        if (cum[j] < cum[inIdx] - 2 || cum[j - 1] > cum[inIdx] + 0.5) continue; // 2 m before the boundary to 0.5 m after
        const a = dense[j - 1], b = dense[j];
        for (const i of ctx.world.candidates(a[0], a[2], b[0], b[2], 0.05)) {
          const q = ctx.world.solids[i];
          if (!tall(q) || q.y1 >= Math.min(a[1], b[1])) continue;
          const ym = (q.y0 + q.y1) / 2;
          if (!segmentPrism([a[0], ym, a[2]], [b[0], ym, b[2]], q)) continue; // the path passes over its footprint
          const cand = { label: q.o.label ?? q.o.id, top: q.y1, wall: q.o.kind === 'wall' };
          if (!over || (cand.wall && !over.wall) || (cand.wall === over.wall && cand.top > over.top + 1e-9)) over = cand;
        }
      }
      const near: { label: string; d: number }[] = [];
      for (const i of ctx.world.candidates(at[0], at[2], at[0], at[2], 1.5)) {
        const q = ctx.world.solids[i];
        if (!tall(q) || q.y0 > at[1] + 0.3 || q.y1 < at[1] - 0.5) continue; // beside the camera, not overhead / underfoot
        const dd = hDist(q, at[0], at[2]);
        if (dd <= 1.5) near.push({ label: q.o.label ?? q.o.id, d: dd });
      }
      near.sort((a, b) => a.d - b.d || (a.label < b.label ? -1 : 1));
      const sides = [...new Set(near.map((n) => `'${n.label}'`))].slice(0, 2);
      params.entry = { at: r3v(at), via: over ? `over '${over.label}' (top ${r2(over.top)} m)` : sides.length ? `through the opening beside ${sides.join(' and ')}` : 'through open space' };
    } else if (inIdx === 0) params.entry = { at: r3v(dense[0]), via: 'starts inside' };
  }
  const maxLayer = Math.max(...route.layers);
  Object.assign(params, {
    start: r3v(start), goal: r3v(goal), routeLength: r2(L), navmeshNodes: route.points.length, expanded: route.expanded, smoothing: sm.attempt, controlPoints: sm.control.length,
    straightLineBlockedBy: straight ? solidName(straight.solid) : null, maxLayerHeight: NAV_LAYERS[maxLayer], usedFlightLayer: NAV_LAYERS[maxLayer] >= FLIGHT_FROM,
    navmesh: { bounds: mesh.bounds, cell: mesh.cell, cameraRadius: mesh.radius, clearanceNeeded: r2(mesh.need), layers: NAV_LAYERS },
  });
  if (room) params.room = room.id;
  return { ok: true, keys, params, notes, ...(focus ? { focus } : {}) };
}

// ---- the whole pipeline: directions → program → planned, validated track ---------------------------------

export type DirectInput = {
  /** Static scene (camera collision + scene names). Add take structures as collision-only obstacles beforehand if wanted. */
  scene: SpatialScene;
  /** World for names (entities, regions) and the light (env.datetime). */
  world: WorldState;
  sampler: Sampler;
  duration: number;
  facts?: Facts;
  hz?: number;
  aspect?: number;
  safeBottom?: number;
  policy?: CameraPolicy;
  /** Planner alternates (solve.ts VARIANTS keys). Default [] = validate the computed move as is (phase 1). */
  variants?: string[];
  /** Phase 2 self-correction (correct.ts): simulate every shot against the take and apply ranked corrections. Default true; false = phase 1 (the computed move as is). */
  correct?: boolean;
};
export type DirectShotReport = {
  index: number;
  label: string;
  verb: string;
  t0: number;
  t1: number;
  subject: { kind: string; ref: string; id: string; label: string; ids: string[] };
  interior?: { id: string; label: string };
  lookAt?: { id: string; label: string; members: number };
  params: Record<string, unknown>;
  notes: string[];
  validation: SynthValidation;
  planner?: { invalidSamples: number; sweptCrossings: number; minReadability: number; meanReadability: number; readableFraction: number; cuts: number; rejected: boolean; reasons: string[] };
  /** Phase 2: the ranked self-correction applied to this shot (failure, samples, strategy, before / after, reason, what was tried). */
  corrections: DirectCorrection[];
  /** Phase 2: the final shot simulated against the take (every sample scored; `valid` = no failure). Absent with `correct: false`. */
  simulation?: ShotSimulation;
};
export type DirectReport = { shots: DirectShotReport[]; duration: number; samples: number; rejected: boolean; trackHash: string; caps: typeof MOTION_CAPS };
export type DirectResult = { ok: true; plan: ShotListPlan; shots: SynthShot[]; report: DirectReport } | { ok: false; diagnostics: Diagnostic[]; shots: DirectShotReport[] };

function shotReport(intent: ShotIntent, shot: SynthShot): DirectShotReport {
  const s = intent.subject;
  return {
    index: intent.index, label: intent.label, verb: intent.verb, t0: shot.t0, t1: shot.t1,
    subject: { kind: s.kind, ref: s.ref, id: s.id, label: s.label, ids: s.ids },
    ...(intent.interior ? { interior: { id: intent.interior.id, label: intent.interior.label } } : {}),
    ...(intent.lookAt ? { lookAt: { id: intent.lookAt.id, label: intent.lookAt.label, members: intent.lookAt.members?.length ?? 1 } } : {}),
    params: shot.params, notes: shot.notes, validation: shot.validation, corrections: shot.corrections,
    ...(shot.simulation ? { simulation: shot.simulation } : {}),
  };
}

/**
 * Directions → shot program → track. Each direction is validated, resolved at its start time, synthesized,
 * then the program (dense `path` shots; holds fill any gap before / between shots) is planned by the
 * existing shot-list planner, which scores collision, sweeps and readability. Deterministic.
 */
export function directCamera(directions: unknown[], input: DirectInput): DirectResult {
  const hz = input.hz ?? 10;
  const world = new CameraWorld(input.scene, input.policy);
  const groundY = input.scene.levels.find((l) => l.id === 0)?.y ?? 0;
  const semantic = new SemanticWorld(input.scene, input.world, input.facts);
  const sp = solarPosition(input.world.env.datetime);
  const sun = sp.elevationDeg > 0 ? { direction: sp.direction as Vec3, datetime: input.world.env.datetime } : null;
  const ctx: SynthContext = { world, scene: input.scene, sampler: input.sampler, hz, aspect: input.aspect ?? DEFAULT_ASPECT, safeBottom: input.safeBottom ?? 0, groundY, duration: input.duration, sun, policy: input.policy };
  const deps: CorrectDeps = { synthesize: synthesizeShot, validate: validateKeys, caps: { viewOmegaDeg: MOTION_CAPS.viewOmegaDeg, viewAlphaDeg: MOTION_CAPS.viewAlphaDeg, speedExterior: MOTION_CAPS.speedExterior, speedInterior: MOTION_CAPS.speedInterior, accel: MOTION_CAPS.accel } };
  const diagnostics: Diagnostic[] = [];
  const parsed: CameraDirection[] = [];
  directions.forEach((x, i) => { const r = parseDirection(x, i); if (r.ok) parsed.push(r.direction); else diagnostics.push(r.diagnostic); });
  if (!directions.length) diagnostics.push({ code: 'camera.direct.invalid', message: 'no directions given' });
  if (diagnostics.length) return { ok: false, diagnostics, shots: [] };
  const intents: ShotIntent[] = [], shots: SynthShot[] = [], reports: DirectShotReport[] = [];
  let tEnd = 0;
  let prev: PrevPose | undefined;
  for (let i = 0; i < parsed.length; i++) {
    const d = parsed[i];
    const t0 = Math.round((d.at ?? tEnd) * hz) / hz;
    if (t0 + 1e-9 < tEnd) { diagnostics.push({ code: 'camera.direct.overlap', message: `direction ${i}: starts at ${t0} s, before direction ${i - 1} ends (${tEnd} s)` }); break; }
    const c = compileDirection(d, i, t0, { semantic, datetime: input.world.env.datetime, duration: input.duration, sampler: input.sampler });
    if (!c.ok) { diagnostics.push(...c.diagnostics); break; }
    const cres = input.correct === false ? (() => { const r = synthesizeShot(c.intent, ctx, prev); return r.ok ? { ok: true as const, shots: [r.shot] } : r; })() : correctShot(c.intent, ctx, prev, deps);
    if (!cres.ok) { diagnostics.push(cres.diagnostic); break; }
    for (const sh of cres.shots) { intents.push(c.intent); shots.push(sh); reports.push(shotReport(c.intent, sh)); }
    const lastShot = cres.shots[cres.shots.length - 1];
    tEnd = lastShot.t1;
    const last = lastShot.keys[lastShot.keys.length - 1];
    prev = { position: last.position, target: last.target };
  }
  if (diagnostics.length) return { ok: false, diagnostics, shots: reports };
  // program windows: holds fill the gaps, one dense path shot per direction
  const windows: ShotWindow[] = [];
  let cursor = 0;
  shots.forEach((s, i) => {
    if (s.t0 > cursor + 1e-9) {
      const from = i ? shots[i - 1].keys[shots[i - 1].keys.length - 1] : s.keys[0];
      windows.push({ label: i ? `hold after '${shots[i - 1].label}'` : 'lead-in hold (before the first direction)', t0: cursor, t1: s.t0, spec: { kind: 'fixed', position: from.position, target: from.target, fov: i ? shots[i - 1].fov : s.fov, subjects: [] } });
    }
    const spec: ShotSpec = { kind: 'path', keys: s.keys, fov: s.fov, subjects: s.subjects };
    windows.push({ label: s.label, t0: s.t0, t1: s.t1, spec });
    cursor = s.t1;
  });
  const focusOf = new Map(shots.filter((s) => s.focus).map((s) => [s.focus!.id, s]));
  const sampler: Sampler = focusOf.size
    ? (t) => {
        const base = input.sampler(t);
        let out: Record<string, SubjectPose> | null = null;
        for (const [id, s] of focusOf) {
          if (t < s.t0 - 1e-6 || t > s.t1 + 1e-6) continue;
          const k = clampN(Math.round((t - s.t0) * hz), 0, s.focus!.points.length - 1);
          const pts = s.focus!.points[k];
          out ??= { ...base };
          out[id] = { p: pts[0], yaw: 0, points: pts, kind: 'component' };
        }
        return out ?? base;
      }
    : input.sampler;
  const plan = planShotList(windows, sampler, world, { hz, policy: input.policy, variants: input.variants ?? [], aspect: ctx.aspect, safeArea: { bottom: ctx.safeBottom } });
  for (const r of reports) {
    const ps = plan.shots.find((p) => p.label === r.label && Math.abs(p.t0 - r.t0) < 1e-6);
    if (!ps) continue;
    const pr = ps.report;
    r.planner = { invalidSamples: pr.invalidSamples, sweptCrossings: pr.sweptCrossings, minReadability: r2(pr.minReadability), meanReadability: r2(pr.meanReadability), readableFraction: r2(pr.readableFraction), cuts: pr.cuts.length, rejected: pr.rejected, reasons: pr.reasons.slice(0, 5) };
  }
  const trackHash = hashOf(plan.samples);
  return { ok: true, plan, shots, report: { shots: reports, duration: plan.duration, samples: plan.samples.length, rejected: plan.report.rejected, trackHash, caps: MOTION_CAPS } };
}
