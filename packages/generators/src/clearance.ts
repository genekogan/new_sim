// One clearance rule for everything that makes walkable geometry (lane BS1, BUILDSAFE, 2026-10-21): building plans,
// stairs, doors and furnishing ask this module how much exact room a body needs, so what they lay out is what the walk
// planner lets a Soul through, at any yaw and any place on the 0.1 m walk raster.
//
// The walk planner (mars/viewer/engine/spatial) plans a 0.28 m body with a 0.06 m margin: a raster cell is passable when
// its clearance is >= 0.34 m. The raster loses room on top of that: a solid blocks every cell it touches (a piece of
// furniture; up to half a cell diagonal more on a turned box), clearance runs from cell centre to the nearest blocked
// centre minus half a cell, and the cells on a way sit wherever the lattice puts them. A wall piece at least a cell thick
// (door-raster/1) blocks only the cells whose centre it covers, so it loses less. Measured on the real raster
// (team/scratch/t4/bs1/probe/gap.ts; clearance.test in apps/server keeps it true), over 19 yaws and 25 sub-cell offsets:
//   exact gap between            passes sometimes from   always from
//   two wall pieces (a doorway)        0.62 m               0.86 m
//   a wall and a piece                 0.68 m               0.94 m
//   two pieces                         0.72 m               1.00 m   (0.90 m passes 34% of poses)
// so each side of a way takes PLAN_R plus its raster's slop: clearR('conservative') 0.50 m, clearR('centre') 0.43 m.
// The furnish check used 0.34 m on exact boxes and let hillside-home living rooms pass that nav cut in half (WALK2).
import type { Vec2 } from './types.ts';

/** The walking body (mars HUMAN_RADIUS) and the planner's margin (spatial/path.ts PLAN_MARGIN); asserted equal in a test. */
export const BODY_R = 0.28;
export const PLAN_MARGIN = 0.06;
/** The walk raster's cell (m). */
export const NAV_CELL = 0.1;
/** The clearance a raster cell needs to be walked (m): the planner's passable test. */
export const PLAN_R = BODY_R + PLAN_MARGIN;
/** How a solid is rasterised: every cell it touches ('conservative', furniture, rails, posts) or the cells whose centre
 *  it covers ('centre', door-raster/1: building/1 wall pieces at least WALL_RASTER_MIN thick). */
export type Raster = 'conservative' | 'centre';
export const RASTER_SLOP: Readonly<Record<Raster, number>> = Object.freeze({ conservative: 0.16, centre: 0.09 });
/** door-raster/1: wall pieces at least this thick raster by cell centres. */
export const WALL_RASTER_MIN = NAV_CELL;
/** How the walk raster draws a building/1 collider: its wall pieces (tag `wall:f<k>…`) a cell thick or more by centres. */
export function rasterOf(o: { tag?: string; half: readonly number[]; raster?: Raster }): Raster {
  if (o.raster) return o.raster;
  return /^wall:f\d/.test(o.tag ?? '') && 2 * Math.min(o.half[0], o.half[1]) >= WALL_RASTER_MIN ? 'centre' : 'conservative';
}
/** Exact distance (m) a body's centre must keep from a solid of this raster for the planner to walk it. */
export const clearR = (r: Raster = 'conservative') => PLAN_R + RASTER_SLOP[r];
/** Exact clear width (m) between two solids that a body is sure to pass (a doorway between walls: clearWay('centre')). */
export const clearWay = (a: Raster = 'conservative', b: Raster = a) => clearR(a) + clearR(b);
/** Where the planner steps on and off a flight: this far beyond its end (spatial Link default approach). */
export const LINK_STEP_M = 0.7;

// ---------------------------------------------------------------------------------------------- ways through a room
// Every doorway and stair end on a room's floor, and every piece's approach, must stay reachable from the others for a
// body (lane SEALED; moved here from tools/god-skill/lib/furnish.mjs so plans, stairs and furnishing share it). The room is
// a 0.1 m grid in its own frame; a cell is free inside the room polygon and clearR(raster) or more from every blocker
// (as an expanded box). Keys are 0.45 m inside each doorway and the planner's step-off point LINK_STEP_M beyond each
// stair end.

/** A blocker: an OBB in the room's frame; `raster`/`tag` pick its clearance (default conservative). */
export type WayBlocker = { c: readonly number[]; half: readonly number[]; yaw: number; tag?: string; raster?: Raster };
/** A key: a point (the free cell within 0.3 m), or { pts, r }: the free cell nearest any of pts within r. */
export type WayKey = Vec2 | { pts: Vec2[]; r: number };
export type WayRoom = { polygon: Vec2[]; floor: number; id: string };

const inPoly = (poly: Vec2[], x: number, z: number) => { let k = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) k = !k; } return k; };
const inBox = (b: WayBlocker, x: number, z: number, r: number) => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.c[0], dz = z - b.c[1]; return Math.abs(dx * c - dz * s) < b.half[0] + r && Math.abs(dx * s + dz * c) < b.half[1] + r; };

/** The keys of a room: 0.45 m inside each of its doorways, and each stair end's step-off point on its floor. */
export function roomKeys(room: WayRoom, doors: { level: number; from?: string; to?: string; at: readonly number[]; yaw: number }[], links: { from: number; to: number; path: readonly (readonly number[])[] }[]): Vec2[] {
  const keys: Vec2[] = [];
  for (const d of doors) {
    if (d.level !== room.floor || (d.from !== room.id && d.to !== room.id)) continue;
    const n = [Math.sin(d.yaw), Math.cos(d.yaw)];
    for (const k of [0.45, -0.45]) { const p: Vec2 = [d.at[0] + n[0] * k, d.at[1] + n[1] * k]; if (inPoly(room.polygon, p[0], p[1])) { keys.push(p); break; } }
  }
  for (const l of links) for (const [end, next, level] of [[l.path[0], l.path[1], l.from], [l.path[l.path.length - 1], l.path[l.path.length - 2], l.to]] as const) {
    if (level !== room.floor || !next) continue;
    // straight on, else sideways (a flight that starts against a wall), else the end itself
    const dx = end[0] - next[0], dz = end[1] - next[1], m = Math.hypot(dx, dz) || 1, u = [dx / m, dz / m];
    const p = ([[u[0], u[1]], [-u[1], u[0]], [u[1], -u[0]], [0, 0]] as const).map(([a, b]): Vec2 => [end[0] + a * LINK_STEP_M, end[1] + b * LINK_STEP_M]).find(([x, z]) => inPoly(room.polygon, x, z));
    if (p) keys.push(p);
  }
  return keys;
}

/** Where a Soul sent to a piece stands: 0.75 m in front of each seat (searched 1.5 m round), else the free spot nearest it. */
export function approachOf(baked: { slots?: { kind: string; p: readonly number[]; yaw: number }[]; box: readonly number[] }, at: readonly number[], yaw: number): WayKey {
  const c = Math.cos(yaw), s = Math.sin(yaw), w = ([x, z]: readonly number[]): Vec2 => [at[0] + x * c + z * s, at[1] - x * s + z * c];
  const seats = (baked.slots ?? []).filter((x) => x.kind === 'seat');
  if (seats.length) return { pts: seats.map((x) => w([x.p[0] + Math.sin(x.yaw) * 0.75, x.p[2] + Math.cos(x.yaw) * 0.75])), r: 1.5 };
  return { pts: [[at[0], at[1]]], r: Math.hypot(baked.box[0], baked.box[2]) / 2 + 1.5 };
}

/** Where the room's frame sits in the world (a building's world pose: x, z, yaw, scale): the ways are then labelled on the
 *  walk raster itself (world 0.1 m lattice, each blocker rasterised as the planner does it, clearance from cell centres),
 *  so the answer is the planner's for this placement. Without a pose, the exact-geometry rule (clearR per side) holds at
 *  any yaw and offset. */
export type WayPose = { x: number; z: number; yaw: number; s?: number };

/** The group each key falls in (a body walking inside `room` past `blockers`); a key with no room to stand is in none
 *  (a negative label of its own). `r` overrides every blocker's clearance (m, exact rule only). */
export function wayLabels(room: { polygon: Vec2[] }, keys: WayKey[], blockers: WayBlocker[], o: { r?: number; pose?: WayPose } = {}): number[] {
  const g = o.pose && o.r === undefined ? rasterFree(room, blockers, o.pose) : exactFree(room, blockers, o.r);
  const { nx, nz, free, cellOf } = g, lab = new Int32Array(nx * nz).fill(-1);
  let next = 0;
  return keys.map((k) => {
    const { pts, r } = Array.isArray(k) ? { pts: [k as Vec2], r: 0.3 } : k as { pts: Vec2[]; r: number };
    const c0 = cellOf(pts, r); if (c0 < 0) return -1 - next++;
    if (lab[c0] < 0) { const L = next++, st = [c0]; lab[c0] = L; while (st.length) { const c = st.pop()!, i = c % nx, j = Math.floor(c / nx); for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const q = b * nx + a; if (free[q] && lab[q] < 0) { lab[q] = L; st.push(q); } } } }
    return lab[c0];
  });
}
type FreeGrid = { nx: number; nz: number; free: Uint8Array; cellOf(pts: Vec2[], r: number): number; world(i: number, j: number): Vec2 };
/** The free cell nearest any of `pts` within r (room frame), on a grid whose cell centres are `centre(i, j)`. */
function nearest(nx: number, nz: number, free: Uint8Array, centre: (i: number, j: number) => Vec2, pts: Vec2[], r: number): number {
  let best = -1, bd = Infinity;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const q = j * nx + i; if (!free[q]) continue;
    const c = centre(i, j);
    for (const [x, z] of pts) { const d = Math.hypot(c[0] - x, c[1] - z); if (d <= r && d < bd) { bd = d; best = q; } }
  }
  return best;
}
function exactFree(room: { polygon: Vec2[] }, blockers: WayBlocker[], rAll?: number): FreeGrid {
  const CELL = NAV_CELL, xs = room.polygon.map((p) => p[0]), zs = room.polygon.map((p) => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs), nx = Math.ceil((Math.max(...xs) - x0) / CELL), nz = Math.ceil((Math.max(...zs) - z0) / CELL);
  const rOf = (b: WayBlocker) => rAll ?? clearR(rasterOf(b));
  const near = blockers.map((b) => ({ b, r: rOf(b), reach: Math.hypot(b.half[0], b.half[1]) + rOf(b) }))
    .filter(({ b, reach }) => b.c[0] + reach > x0 && b.c[0] - reach < x0 + nx * CELL && b.c[1] + reach > z0 && b.c[1] - reach < z0 + nz * CELL);
  const free = new Uint8Array(nx * nz), centre = (i: number, j: number): Vec2 => [x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const [x, z] = centre(i, j); free[j * nx + i] = inPoly(room.polygon, x, z) && !near.some(({ b, r }) => inBox(b, x, z, r)) ? 1 : 0; }
  return { nx, nz, free, cellOf: (pts, r) => nearest(nx, nz, free, centre, pts, r), world: centre };
}
/** The walk raster over the room at `pose`: a blocker blocks every cell it touches (conservative) or whose centre it covers
 *  (centre); a cell inside the room is walked when its centre is PLAN_R + half a cell or more from every blocked centre
 *  (spatial/grid.ts: clearance = centre to the nearest blocked centre minus half a cell). */
function rasterFree(room: { polygon: Vec2[] }, blockers: WayBlocker[], pose: WayPose): FreeGrid {
  const CELL = NAV_CELL, sc = pose.s ?? 1, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  // generator convention: local (x, z) -> (x c + z s, -x s + z c)
  const toW = (p: readonly number[]): Vec2 => [pose.x + (p[0] * c + p[1] * s) * sc, pose.z + (-p[0] * s + p[1] * c) * sc];
  const toL = (p: Vec2): Vec2 => { const dx = (p[0] - pose.x) / sc, dz = (p[1] - pose.z) / sc; return [dx * c - dz * s, dx * s + dz * c]; };
  const poly = room.polygon.map(toW), reach = PLAN_R + CELL;
  const i0 = Math.floor((Math.min(...poly.map((p) => p[0])) - reach) / CELL), j0 = Math.floor((Math.min(...poly.map((p) => p[1])) - reach) / CELL);
  const nx = Math.floor((Math.max(...poly.map((p) => p[0])) + reach) / CELL) - i0 + 1, nz = Math.floor((Math.max(...poly.map((p) => p[1])) + reach) / CELL) - j0 + 1;
  const centre = (i: number, j: number): Vec2 => [(i0 + i + 0.5) * CELL, (j0 + j + 0.5) * CELL];
  const blocked = new Uint8Array(nx * nz);
  for (const b of blockers) {
    const bc = toW(b.c), yaw = b.yaw + pose.yaw, cb = Math.cos(yaw), sb = Math.sin(yaw), hx = b.half[0] * sc, hz = b.half[1] * sc;
    const ex = Math.abs(hx * cb) + Math.abs(hz * sb) + CELL, ez = Math.abs(hx * sb) + Math.abs(hz * cb) + CELL;
    const ia = Math.max(0, Math.floor((bc[0] - ex) / CELL) - i0), ib = Math.min(nx - 1, Math.floor((bc[0] + ex) / CELL) - i0);
    const ja = Math.max(0, Math.floor((bc[1] - ez) / CELL) - j0), jb = Math.min(nz - 1, Math.floor((bc[1] + ez) / CELL) - j0);
    if (ia > ib || ja > jb) continue;
    const cons = rasterOf(b) === 'conservative', h = CELL / 2 - 1e-9;
    // box axes in the world (generator convention): u = (cb, -sb), v = (sb, cb)
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const [px, pz] = centre(i, j), dx = px - bc[0], dz = pz - bc[1];
      const lu = dx * cb - dz * sb, lv = dx * sb + dz * cb;
      let hit: boolean;
      if (!cons) hit = Math.abs(lu) <= hx + 1e-9 && Math.abs(lv) <= hz + 1e-9;
      else {
        // separating axes: the cell's x / z and the box's u / v
        hit = Math.abs(dx) <= h + Math.abs(hx * cb) + Math.abs(hz * sb) && Math.abs(dz) <= h + Math.abs(hx * sb) + Math.abs(hz * cb)
          && Math.abs(lu) <= hx + h * (Math.abs(cb) + Math.abs(sb)) && Math.abs(lv) <= hz + h * (Math.abs(sb) + Math.abs(cb));
      }
      if (hit) blocked[j * nx + i] = 1;
    }
  }
  // clearance >= PLAN_R  <=>  every blocked centre at least PLAN_R + CELL / 2 away
  const need = (PLAN_R + CELL / 2) / CELL, k = Math.ceil(need), disc: [number, number][] = [];
  for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) if (Math.hypot(di, dj) < need - 1e-9) disc.push([di, dj]);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (blocked[j * nx + i] || !inPoly(room.polygon, ...toL(centre(i, j)))) continue;
    let ok = true;
    for (const [di, dj] of disc) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < nz && blocked[b * nx + a]) { ok = false; break; } }
    if (ok) free[j * nx + i] = 1;
  }
  return { nx, nz, free, cellOf: (pts, r) => nearest(nx, nz, free, (i, j) => toL(centre(i, j)), pts, r / sc), world: centre };
}
/** The walked cells' world centres over `room` at `pose` (what wayLabels floods; the raster agreement test reads it). */
export function freeCellsAt(room: { polygon: Vec2[] }, blockers: WayBlocker[], pose: WayPose): Vec2[] {
  const g = rasterFree(room, blockers, pose), out: Vec2[] = [];
  for (let q = 0; q < g.free.length; q++) if (g.free[q]) out.push(g.world(q % g.nx, Math.floor(q / g.nx)));
  return out;
}
/** Pairs among the first `n` labels that share a group. */
export const pairsOf = (labels: number[], n = labels.length) => { let k = 0; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (labels[a] === labels[b]) k++; return k; };
/** How many pairs of `keys` a body can walk between inside `room` past `blockers`. */
export function connectedPairs(room: { polygon: Vec2[] }, keys: WayKey[], blockers: WayBlocker[], o: { r?: number; pose?: WayPose } = {}): number { return keys.length < 2 ? 0 : pairsOf(wayLabels(room, keys, blockers, o)); }
