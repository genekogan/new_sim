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
/** A point (the free cell within 0.3 m), or the free cell nearest any of pts within r (else within `far`, when given). */
export type WayKey = Vec2 | { pts: Vec2[]; r: number; far?: number };
export type WayRoom = { polygon: Vec2[]; floor: number; id: string };

const inPoly = (poly: Vec2[], x: number, z: number) => { let k = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) k = !k; } return k; };
/** inPoly for many points: the same crossing test on flat arrays, a point off the polygon's bounds outside without one
 *  (no edge straddles a z beyond them; every straddling edge crosses right of a point left of them, an even count; x
 *  keeps 1e-6 m of slack for rounding in the crossing). */
const insideOf = (poly: Vec2[]) => {
  const n = poly.length, px = Float64Array.from(poly, (p) => p[0]), pz = Float64Array.from(poly, (p) => p[1]);
  const xa = Math.min(...px) - 1e-6, xb = Math.max(...px) + 1e-6, za = Math.min(...pz), zb = Math.max(...pz);
  return (x: number, z: number) => {
    if (z < za || z >= zb || x < xa || x > xb) return false;
    let k = false;
    for (let i = 0, j = n - 1; i < n; j = i++) { const xi = px[i], zi = pz[i], xj = px[j], zj = pz[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) k = !k; }
    return k;
  };
};
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

/** Where a Soul sent to a piece stands: 0.75 m in front of each seat (searched SEAT_R round), else the free spot nearest it. */
// SEAT_R 0.5 m (lane BSGEN, 2026-10-21; was 1.5 m, which let a seat keep its key across the room while its own front was shut
// in: the shop stool behind the counter, a townhouse sofa; 0.75 m left eight fuzz townhouse places worse in the walk).
export const SEAT_R = 0.5, SEAT_FAR = 1.5;
export function approachOf(baked: { slots?: { kind: string; p: readonly number[]; yaw: number }[]; box: readonly number[] }, at: readonly number[], yaw: number): WayKey {
  const c = Math.cos(yaw), s = Math.sin(yaw), w = ([x, z]: readonly number[]): Vec2 => [at[0] + x * c + z * s, at[1] - x * s + z * c];
  const seats = (baked.slots ?? []).filter((x) => x.kind === 'seat');
  if (seats.length) return { pts: seats.map((x) => w([x.p[0] + Math.sin(x.yaw) * 0.75, x.p[2] + Math.cos(x.yaw) * 0.75])), r: SEAT_R };
  return { pts: [[at[0], at[1]]], r: Math.hypot(baked.box[0], baked.box[2]) / 2 + 1.5 };
}
/** The keys a piece adds to the ways check: one per seat (a Soul is sent to each seat on its own), else approachOf's one. */
// A piece being placed needs each seat's own front (within SEAT_R) reached from the doors. A piece already standing keeps
// SEAT_FAR as a fallback for a seat with no free cell within SEAT_R (`far`): it then still holds the room's ways round it as
// before rather than dropping out of the check (lane BSGEN: without it, fuzz f-townhouse-270-s45's kitchen table took the
// middle of the room and its walk goal ended in a pocket).
export function approachKeys(baked: Parameters<typeof approachOf>[0], at: readonly number[], yaw: number, far?: number): WayKey[] {
  const a = approachOf(baked, at, yaw);
  if (Array.isArray(a)) return [a];
  return a.pts.length > 1 || far ? a.pts.map((p) => ({ pts: [p], r: a.r, ...(far && a.r === SEAT_R ? { far } : {}) })) : [a];
}

/** Where the room's frame sits in the world (a building's world pose: x, z, yaw, scale): the ways are then labelled on the
 *  walk raster itself (world 0.1 m lattice, each blocker rasterised as the planner does it, clearance from cell centres),
 *  so the answer is the planner's for this placement. Without a pose, the exact-geometry rule (clearR per side) holds at
 *  any yaw and offset. */
export type WayPose = { x: number; z: number; yaw: number; s?: number };

/** The group each key falls in (a body walking inside `room` past `blockers`); a key with no room to stand is in none
 *  (a negative label of its own). `r` overrides every blocker's clearance (m, exact rule only). */
export function wayLabels(room: { polygon: Vec2[] }, keys: WayKey[], blockers: WayBlocker[], o: { r?: number; pose?: WayPose } = {}): number[] {
  return wayGrid(room, blockers, o).labels(keys);
}
/** A room's walk grid past some blockers: label keys on it, or add one more blocker. Adding redoes only the cells near the
 *  new blocker (a blocker only ever takes cells away), so furnishing tries pose after pose on one grid per room. */
export type WayGrid = { labels(keys: WayKey[], hint?: WayHint): number[]; plus(b: WayBlocker): WayGrid };
/** Where each key stood on a grid (filled by labels): on a grid with more blockers a key whose cell is still free stands
 *  there again (the nearest free cell of fewer free cells, when it is still free, is the same one). */
export type WayHint = { cells: number[] };
export function wayGrid(room: { polygon: Vec2[] }, blockers: WayBlocker[], o: { r?: number; pose?: WayPose } = {}): WayGrid {
  const g = o.pose && o.r === undefined ? rasterFree(room, blockers, o.pose) : exactFree(room, blockers, o.r);
  const of = (g: FreeGrid): WayGrid => ({ labels: (keys, hint) => labelsOn(g, keys, hint), plus: (b) => of(g.plus(b)) });
  return of(g);
}
// labelsOn's work arrays, kept between calls (furnishing labels thousands of grids): lab -1 and keyCell 0 on [0, n)
let buf = { lab: new Int32Array(0), st: new Int32Array(0), keyCell: new Uint8Array(0) };
const scratch = (n: number) => {
  if (buf.lab.length < n) buf = { lab: new Int32Array(n), st: new Int32Array(n), keyCell: new Uint8Array(n) };
  buf.lab.fill(-1, 0, n); buf.keyCell.fill(0, 0, n);
  return buf;
};
function labelsOn({ nx, nz, free, cellOf }: FreeGrid, keys: WayKey[], hint?: WayHint): number[] {
  const was = hint?.cells, cells = keys.map((k, n) => {
    const h = was?.[n]; if (h !== undefined && h >= 0 && free[h]) return h;
    const { pts, r, far } = Array.isArray(k) ? { pts: [k as Vec2], r: 0.3, far: undefined } : k as { pts: Vec2[]; r: number; far?: number };
    const c = cellOf(pts, r);
    return c < 0 && far ? cellOf(pts, far) : c;
  });
  if (hint) hint.cells = cells;
  // 4-connected floods from each key's cell in turn (a cell is labelled when pushed); a flood stops once every key's cell
  // is labelled, as no later key then reads an unlabelled cell
  const { lab, st, keyCell } = scratch(nx * nz);
  let pending = 0;
  for (const c of cells) if (c >= 0 && !keyCell[c]) { keyCell[c] = 1; pending++; }
  let next = 0;
  return cells.map((c0) => {
    if (c0 < 0) return -1 - next++;
    if (lab[c0] < 0) {
      const L = next++; let n = 0; lab[c0] = L; st[n++] = c0; pending--;
      while (n && pending) {
        const c = st[--n], i = c % nx;
        let q = c + 1; if (i + 1 < nx && free[q] && lab[q] < 0) { lab[q] = L; st[n++] = q; pending -= keyCell[q]; }
        q = c - 1; if (i > 0 && free[q] && lab[q] < 0) { lab[q] = L; st[n++] = q; pending -= keyCell[q]; }
        q = c + nx; if (q < nx * nz && free[q] && lab[q] < 0) { lab[q] = L; st[n++] = q; pending -= keyCell[q]; }
        q = c - nx; if (q >= 0 && free[q] && lab[q] < 0) { lab[q] = L; st[n++] = q; pending -= keyCell[q]; }
      }
    }
    return lab[c0];
  });
}
type FreeGrid = { nx: number; nz: number; free: Uint8Array; cellOf(pts: Vec2[], r: number): number; world(i: number, j: number): Vec2; plus(b: WayBlocker): FreeGrid };
/** The free cell nearest any of `pts` within r (room frame), on a grid whose cell centres (room frame) are (cx[q], cz[q]),
 *  as a whole-grid scan finds it (the first of equals in scan order). `at` are the pts in grid index coordinates and f the
 *  grid cells per room-frame metre: only cells that can be within r are read, and once a near window finds a cell only those
 *  as near as it. */
function nearest(nx: number, nz: number, free: Uint8Array, cx: Float64Array, cz: Float64Array, pts: Vec2[], r: number, at: Vec2[], f: number): number {
  const r2 = r * r * (1 + 1e-9) + 1e-12;
  const scan = ([ia, ib, ja, jb]: [number, number, number, number]): [number, number] => {
    let best = -1, bd = Infinity;
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const q = j * nx + i; if (!free[q]) continue;
      for (const [x, z] of pts) {
        // squares first: a cell surely beyond r or the best so far skips the exact hypot (1e-9 relative slack for rounding)
        const dx = cx[q] - x, dz = cz[q] - z, d2 = dx * dx + dz * dz;
        if (d2 > r2 || d2 > bd * bd * (1 + 1e-9) + 1e-12) continue;
        const d = Math.hypot(dx, dz); if (d <= r && d < bd) { bd = d; best = q; }
      }
    }
    return [best, bd];
  };
  const [b1, d1] = scan(windowOf(nx, nz, at, Math.min(r, 0.8) * f));
  return scan(windowOf(nx, nz, at, (b1 >= 0 ? d1 : r) * f))[0];
}
/** The cell centres of an nx by nz grid, as coordinate arrays. */
function centresOf(nx: number, nz: number, centre: (i: number, j: number) => Vec2): [Float64Array, Float64Array] {
  const cx = new Float64Array(nx * nz), cz = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const [x, z] = centre(i, j); cx[j * nx + i] = x; cz[j * nx + i] = z; }
  return [cx, cz];
}
/** Index bounds (clamped) of the cells whose centres can lie within `reach` of the points (grid coordinates u = i, v = j). */
function windowOf(nx: number, nz: number, at: Vec2[], reach: number): [number, number, number, number] {
  const us = at.map((p) => p[0]), vs = at.map((p) => p[1]);
  return [Math.max(0, Math.floor(Math.min(...us) - reach) - 1), Math.min(nx - 1, Math.ceil(Math.max(...us) + reach) + 1),
    Math.max(0, Math.floor(Math.min(...vs) - reach) - 1), Math.min(nz - 1, Math.ceil(Math.max(...vs) + reach) + 1)];
}
function exactFree(room: { polygon: Vec2[] }, blockers: WayBlocker[], rAll?: number): FreeGrid {
  const CELL = NAV_CELL, xs = room.polygon.map((p) => p[0]), zs = room.polygon.map((p) => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs), nx = Math.ceil((Math.max(...xs) - x0) / CELL), nz = Math.ceil((Math.max(...zs) - z0) / CELL);
  const rOf = (b: WayBlocker) => rAll ?? clearR(rasterOf(b));
  const nearOf = (b: WayBlocker) => { const r = rOf(b), reach = Math.hypot(b.half[0], b.half[1]) + r; return b.c[0] + reach > x0 && b.c[0] - reach < x0 + nx * CELL && b.c[1] + reach > z0 && b.c[1] - reach < z0 + nz * CELL ? { b, r } : null; };
  const near = blockers.map(nearOf).filter((x) => x !== null);
  const centre = (i: number, j: number): Vec2 => [x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL], [cx, cz] = centresOf(nx, nz, centre);
  const grid = (free: Uint8Array): FreeGrid => ({
    nx, nz, free, world: centre,
    cellOf: (pts, r) => nearest(nx, nz, free, cx, cz, pts, r, pts.map(([x, z]): Vec2 => [(x - x0) / CELL - 0.5, (z - z0) / CELL - 0.5]), 1 / CELL),
    plus(b) {
      const n = nearOf(b); if (!n) return grid(free);
      const out = free.slice(), e = (b.half[0] + b.half[1] + 2 * n.r) / CELL;
      const [ia, ib, ja, jb] = windowOf(nx, nz, [[(b.c[0] - x0) / CELL - 0.5, (b.c[1] - z0) / CELL - 0.5]], e);
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) { const q = j * nx + i; if (out[q] && inBox(b, cx[q], cz[q], n.r)) out[q] = 0; }
      return grid(out);
    },
  });
  const free = new Uint8Array(nx * nz);
  const inside = insideOf(room.polygon);
  for (let q = 0; q < nx * nz; q++) free[q] = inside(cx[q], cz[q]) && !near.some(({ b, r }) => inBox(b, cx[q], cz[q], r)) ? 1 : 0;
  return grid(free);
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
  /** Block the cells `b` covers; returns those not blocked before. */
  const stamp = (blocked: Uint8Array, b: WayBlocker): number[] => {
    const bc = toW(b.c), yaw = b.yaw + pose.yaw, cb = Math.cos(yaw), sb = Math.sin(yaw), hx = b.half[0] * sc, hz = b.half[1] * sc, fresh: number[] = [];
    const ex = Math.abs(hx * cb) + Math.abs(hz * sb) + CELL, ez = Math.abs(hx * sb) + Math.abs(hz * cb) + CELL;
    const ia = Math.max(0, Math.floor((bc[0] - ex) / CELL) - i0), ib = Math.min(nx - 1, Math.floor((bc[0] + ex) / CELL) - i0);
    const ja = Math.max(0, Math.floor((bc[1] - ez) / CELL) - j0), jb = Math.min(nz - 1, Math.floor((bc[1] + ez) / CELL) - j0);
    if (ia > ib || ja > jb) return fresh;
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
      if (hit && !blocked[j * nx + i]) { blocked[j * nx + i] = 1; fresh.push(j * nx + i); }
    }
    return fresh;
  };
  // clearance >= PLAN_R  <=>  every blocked centre at least PLAN_R + CELL / 2 away (the disc is symmetric, so a newly
  // blocked cell un-frees exactly the cells of the disc round it)
  const need = (PLAN_R + CELL / 2) / CELL, k = Math.ceil(need), disc: [number, number][] = [];
  for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) if (Math.hypot(di, dj) < need - 1e-9) disc.push([di, dj]);
  // Only the disc round a blocked cell with an unblocked 4-neighbour matters: the blocked cell nearest a free cell has one
  // (a step from it toward the free cell along its longer offset is a nearer cell, so it is not blocked).
  const unfree = (free: Uint8Array, blocked: Uint8Array, cells: number[]) => {
    for (const q of cells) {
      free[q] = 0;
      const i = q % nx, j = Math.floor(q / nx);
      if ((i + 1 >= nx || blocked[q + 1]) && (i < 1 || blocked[q - 1]) && (j + 1 >= nz || blocked[q + nx]) && (j < 1 || blocked[q - nx])) continue;
      for (const [di, dj] of disc) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < nz) free[b * nx + a] = 0; }
    }
  };
  const [lx, lz] = centresOf(nx, nz, (i, j) => toL(centre(i, j)));   // room frame
  const grid = (blocked: Uint8Array, free: Uint8Array): FreeGrid => ({
    nx, nz, free, world: centre,
    cellOf: (pts, r) => nearest(nx, nz, free, lx, lz, pts, r / sc, pts.map((p) => { const w = toW(p); return [w[0] / CELL - i0 - 0.5, w[1] / CELL - j0 - 0.5]; }), sc / CELL),
    plus(b) { const bl = blocked.slice(), fr = free.slice(); unfree(fr, bl, stamp(bl, b)); return grid(bl, fr); },
  });
  const blocked = new Uint8Array(nx * nz);
  for (const b of blockers) stamp(blocked, b);
  const free = new Uint8Array(nx * nz);
  const inside = insideOf(room.polygon);
  for (let q = 0; q < nx * nz; q++) if (!blocked[q] && inside(lx[q], lz[q])) free[q] = 1;
  unfree(free, blocked, [...blocked.keys()].filter((q) => blocked[q]));
  return grid(blocked, free);
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
