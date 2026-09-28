// Global route planning (spec §10): multi-level A* over clearance grids with
// explicit contextual links (stairs) — the Recast/Detour "navmesh + off-mesh
// connection" pattern expressed on rasters. Routes are corridors: polylines
// whose every segment has a guaranteed clearance ≥ agent radius, so the mover
// can smooth inside them and never needs collision sliding to make progress.
import { add2, dist2, rot2, sub2, type Vec2 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import { cellOf, centreOf, latticeCentre, nearestBlocker, segmentClearance, type GridSet, type LevelGrid } from './grid.ts';
import type { AgentProfile, Link, SpatialScene } from './types.ts';

export type Place = { level: number; p: Vec2 };
export type WalkLeg = { kind: 'walk'; level: number; points: Vec2[]; minClearance: number };
export type LinkLeg = { kind: 'link'; link: Link; ascending: boolean };
export type Leg = WalkLeg | LinkLeg;
export type Route = { legs: Leg[]; length: number; expanded: number };
export type RouteResult = { ok: true; route: Route } | { ok: false; diagnostic: Diagnostic };

const SQ2 = Math.SQRT2;
export const PLAN_MARGIN = 0.06; // m
const COMFORT = 0.9; // m of clearance beyond which there is no wall penalty
const WALL_PENALTY = 1.2;

type LinkEdge = { link: Link; ascending: boolean; toLevel: number; toCell: number; cost: number; approach: Vec2 };

/** Where to stand before traversing a link, facing along its heading (no side entry). */
export function linkApproach(link: Link, ascending: boolean, back = 0.7): { entry: Place; approach: Vec2; exit: Place } {
  const dir = rot2([1, 0], link.heading);
  if (ascending) return { entry: link.from, approach: sub2(link.from.p, [dir[0] * back, dir[1] * back]), exit: link.to };
  return { entry: link.to, approach: add2(link.to.p, [dir[0] * back, dir[1] * back]), exit: link.from };
}

export type RouteOpts = {
  goalTolerance?: number;
  allowUnusableLinks?: boolean;
  maxExpand?: number;
  /**
   * 'exact' (default): full-grid A*. 'corridor': coarse-to-fine — A* on a 0.5 m max-clearance grid
   * picks a corridor, then the same fine A* runs restricted to cells within CORRIDOR_HALO of it;
   * any failure falls back to the exact search (so failures and their diagnostics are identical).
   * Faster on long routes but NOT guaranteed to return the exact route (docs/engineering/PLANNING_BUDGET.md).
   */
  planner?: 'exact' | 'corridor';
};

/** Corridor planner: coarse cell size (m) and fine-search halo around the coarse path (m). */
export const CORRIDOR_CELL = 0.5;
export const CORRIDOR_HALO = 1.5;

type Prep = { r: number; lvIds: number[]; idxOf: Map<number, number>; N: number; gs: LevelGrid; gg: LevelGrid; sLv: number; gLv: number; s: number; gt: number; edges: Map<number, LinkEdge[]> };
type Found = { goalId: number; chain: number[]; viaLink: Map<number, LinkEdge>; expanded: number };

export function findRoute(grids: GridSet, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts = {}): RouteResult {
  const prep = prepare(grids, scene, profile, start, goal, opts);
  if ('ok' in prep) return prep;
  if (opts.planner === 'corridor') {
    const r = corridorRoute(grids, scene, profile, start, goal, opts, prep);
    if (r) return r;
  }
  const found = search(grids, prep, opts, null);
  if (!found) {
    const { r } = prep;
    if (!opts.allowUnusableLinks && scene.links.some((l) => !l.usable)) {
      const alt = findRoute(grids, scene, profile, start, goal, { ...opts, allowUnusableLinks: true, planner: 'exact' });
      if (alt.ok) {
        const needed = alt.route.legs.filter((l): l is LinkLeg => l.kind === 'link' && !l.link.usable).map((l) => l.link);
        return fail(
          'route.link-unusable',
          `no usable route: it would require ${needed.map((l) => `${l.kind} ${l.id} (${l.reason ?? 'not usable'})`).join(', ')}`,
          goal,
          needed.map((l) => l.id),
        );
      }
    }
    return fail('route.unreachable', `no route from level ${start.level} (${fmt(start.p)}) to level ${goal.level} (${fmt(goal.p)}) for a ${r} m-radius agent`, goal);
  }
  if ('ok' in found) return found;
  return assemble(grids, prep, start, goal, found, found.expanded);
}

/** Snap start/goal and build the contextual link edges; a failure is the final diagnostic. */
function prepare(grids: GridSet, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts): Prep | RouteResult {
  // plan with a margin above the body radius: corridor clearance is sampled at cell centres, and
  // the walker's continuous position may sit up to half a cell off them
  const r = profile.radius + PLAN_MARGIN;
  const lvIds = [...grids.levels.keys()].sort((a, b) => a - b);
  const idxOf = new Map(lvIds.map((l, i) => [l, i]));
  const g0 = grids.levels.get(lvIds[0])!;
  const N = g0.nx * g0.nz;
  const gs = grids.levels.get(start.level), gg = grids.levels.get(goal.level);
  if (!gs || !gg) return fail('route.unknown-level', `level ${!gs ? start.level : goal.level} does not exist`);
  const passable = (g: LevelGrid, c: number) => c >= 0 && g.clearance[c] >= r;
  const s = snap(gs, start.p, r, 0.5);
  if (s < 0)
    return fail('route.start-blocked', `start (${fmt(start.p)}) on level ${start.level} is not standable${blk(gs, start.p)}`, start);
  const gt = snap(gg, goal.p, r, opts.goalTolerance ?? 0.35);
  if (gt < 0)
    return fail('route.goal-blocked', `destination (${fmt(goal.p)}) on level ${goal.level} has no standing room for a ${r} m-radius agent${blk(gg, goal.p)}`, goal);

  // contextual link edges
  const edges = new Map<number, LinkEdge[]>();
  for (const link of scene.links) {
    if (!link.usable && !opts.allowUnusableLinks) continue;
    if (link.width < 2 * r) continue;
    for (const ascending of [true, false]) {
      const { entry, approach, exit } = linkApproach(link, ascending);
      const ge = grids.levels.get(entry.level), gx = grids.levels.get(exit.level);
      if (!ge || !gx) continue;
      const ca = cellOf(ge, approach), cx = snap(gx, linkApproach(link, !ascending).approach, r, 0.4);
      if (!passable(ge, ca) || cx < 0) continue;
      if (segmentClearance(ge, approach, entry.p) < r * 0.9) continue;
      const len = dist2(approach, entry.p) + pathLen(link.path) + dist2(exit.p, centreOf(gx, cx));
      const id = idxOf.get(entry.level)! * N + ca;
      const list = edges.get(id) ?? [];
      list.push({ link, ascending, toLevel: exit.level, toCell: cx, cost: len * 1.25, approach });
      edges.set(id, list);
    }
  }
  return { r, lvIds, idxOf, N, gs, gg, sLv: idxOf.get(start.level)!, gLv: idxOf.get(goal.level)!, s, gt, edges };
}

/**
 * The A* core. Search state lives in reused, generation-stamped scratch (no per-call 10 MB
 * allocation + fill): gScore/came of a cell are valid iff stamp === gen, closed iff shut === gen.
 * Unmasked, the expansion order, relaxation arithmetic and heap order (key, then insertion) are
 * exactly the reference A*'s, so routes are bit-identical (engine/test/planning.test.ts vs
 * engine/test/path-reference.ts). `mask` (cells with mask.stamp === mask.gen) restricts the search.
 * Returns null when the goal is unreachable, a diagnostic when the expansion limit is hit.
 */
function search(grids: GridSet, prep: Prep, opts: RouteOpts, mask: { stamp: Uint32Array; gen: number } | null): Found | RouteResult | null {
  const { r, lvIds, idxOf, N, gg, s, gt, edges, sLv, gLv } = prep;
  const total = lvIds.length * N;
  const S = scratchFor(total);
  const gen = S.gen;
  const { gScore, came, pos, stamp, shut } = S;
  const viaLink = new Map<number, LinkEdge>();
  const heap = S.heap;
  heap.reset(pos);
  const Ls = lvIds.map((id) => grids.levels.get(id)!);
  const startId = sLv * N + s, goalId = gLv * N + gt;
  const goalC = centreOf(gg, gt);
  const gx0 = goalC[0], gz0 = goalC[1];
  // octile distance from a cell centre to the goal cell centre (same float ops as centreOf)
  const hAt = (g: LevelGrid, i: number, j: number) => {
    const dx = Math.abs(latticeCentre(g.ox + i, g.cell) - gx0), dz = Math.abs(latticeCentre(g.oz + j, g.cell) - gz0);
    return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz);
  };
  const h = (lv: number, c: number) => {
    const g = Ls[lv];
    return hAt(g, c % g.nx, Math.floor(c / g.nx));
  };
  const ms = mask?.stamp, mg = mask?.gen ?? 0;
  stamp[startId] = gen;
  gScore[startId] = 0;
  came[startId] = -1;
  heap.push(startId, h(sLv, s), false);
  let expanded = 0;
  const maxExpand = opts.maxExpand ?? 4_000_000;
  const hasEdges = edges.size > 0;
  while (heap.size) {
    const cur = heap.pop();
    if (shut[cur] === gen) continue; // (a closed cell re-queued by a relaxation, as in the reference)
    shut[cur] = gen;
    if (cur === goalId) break;
    if (++expanded > maxExpand) return fail('route.search-limit', `route search exceeded ${maxExpand} expansions`);
    const lv = Math.floor(cur / N), c = cur - lv * N;
    const g = Ls[lv];
    const nx = g.nx, nz = g.nz, cl = g.clearance, base = lv * N, gc = gScore[cur];
    const straight = g.cell, diag = SQ2 * g.cell;
    const ci = c % nx, cj = (c - ci) / nx;
    for (let dj = -1; dj <= 1; dj++) {
      const nj = cj + dj;
      if (nj < 0 || nj >= nz) continue;
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di;
        if (ni < 0 || ni >= nx) continue;
        const n = nj * nx + ni;
        const cn = cl[n];
        if (!(cn >= r)) continue;
        if (di && dj && (!(cl[cj * nx + ni] >= r) || !(cl[nj * nx + ci] >= r))) continue; // no corner cutting
        const nid = base + n;
        if (ms && ms[nid] !== mg) continue;
        const w = 1 + (cn < COMFORT ? (WALL_PENALTY * (COMFORT - cn)) / COMFORT : 0);
        const t = gc + (di && dj ? diag : straight) * w;
        const fresh = stamp[nid] !== gen;
        if (fresh || t < gScore[nid]) {
          stamp[nid] = gen;
          gScore[nid] = t;
          came[nid] = cur;
          if (viaLink.size) viaLink.delete(nid);
          heap.push(nid, t + hAt(g, ni, nj), !fresh && pos[nid] >= 0);
        }
      }
    }
    if (!hasEdges) continue;
    for (const e of edges.get(cur) ?? []) {
      const tl = idxOf.get(e.toLevel)!;
      const nid = tl * N + e.toCell;
      if (ms && ms[nid] !== mg) continue;
      const t = gc + e.cost;
      const fresh = stamp[nid] !== gen;
      if (fresh || t < gScore[nid]) {
        stamp[nid] = gen;
        gScore[nid] = t;
        came[nid] = cur;
        viaLink.set(nid, e);
        heap.push(nid, t + h(tl, e.toCell), !fresh && pos[nid] >= 0);
      }
    }
  }
  if (shut[goalId] !== gen) return null;
  const chain: number[] = [];
  for (let id = goalId; id !== -1; id = came[id]) chain.push(id);
  chain.reverse();
  return { goalId, chain, viaLink, expanded };
}

/** Cell chain → legs (string-pulled walk legs + link legs). */
function assemble(grids: GridSet, prep: Prep, start: Place, goal: Place, found: Found, expanded: number): RouteResult {
  const { r, lvIds, N, gg, gt } = prep;
  const { chain, viaLink } = found;
  const goalC = centreOf(gg, gt);
  const legs: Leg[] = [];
  let pts: Vec2[] = [start.p];
  let curLv = start.level;
  for (let k = 1; k < chain.length; k++) {
    const id = chain[k];
    const e = viaLink.get(id);
    const g = grids.levels.get(lvIds[Math.floor(id / N)])!;
    if (e) {
      const { entry, exit } = linkApproach(e.link, e.ascending);
      pts.push(e.approach, entry.p);
      legs.push(walkLeg(grids.levels.get(curLv)!, pts, r));
      legs.push({ kind: 'link', link: e.link, ascending: e.ascending });
      pts = [exit.p];
      curLv = e.toLevel;
    } else pts.push(centreOf(g, id % N));
  }
  // a snapped goal (its own cell has no standing room) ends at the snapped standable cell centre, never
  // at the raw goal (review H2); walk_to reports the snap distance
  const end = gt === cellOf(gg, goal.p) ? goal.p : goalC;
  if (dist2(end, pts[pts.length - 1]) > 1e-9 || pts.length === 1) pts.push(end);
  legs.push(walkLeg(grids.levels.get(curLv)!, pts, r, true));
  const length = legs.reduce((s, l) => s + (l.kind === 'walk' ? pathLen2(l.points) : pathLen(l.link.path)), 0);
  return { ok: true, route: { legs, length, expanded } };
}

/**
 * Coarse-to-fine: A* over a max-clearance coarse grid (optimistic: a coarse cell is open if any of
 * its fine cells is, so every fine route has a coarse image) between the fine start/goal cells,
 * then the fine A* restricted to fine cells within CORRIDOR_HALO of that coarse path. null (→ the
 * exact search) whenever either stage fails, so only successful routes can differ from 'exact'.
 */
function corridorRoute(grids: GridSet, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts, prep: Prep): RouteResult | null {
  const f = Math.max(2, Math.round(CORRIDOR_CELL / grids.cell));
  const coarse = coarseGrids(grids, f);
  const cPrep = prepare(coarse, scene, profile, { level: start.level, p: centreOf(prep.gs, prep.s) }, { level: goal.level, p: centreOf(prep.gg, prep.gt) }, { ...opts, goalTolerance: 0 });
  if ('ok' in cPrep) return null;
  const cFound = search(coarse, cPrep, opts, null);
  if (!cFound || 'ok' in cFound) return null;
  const { N, lvIds } = prep;
  const S = scratchFor(lvIds.length * N);
  if (!S.mask) S.mask = new Uint32Array(S.total);
  if (S.maskGen >= 0xfffffffe) { S.maskGen = 0; S.mask.fill(0); }
  const mgen = ++S.maskGen;
  const k = Math.ceil(CORRIDOR_HALO / (f * grids.cell));
  const Nc = cPrep.N;
  for (const id of cFound.chain) {
    const lv = Math.floor(id / Nc), c = id - lv * Nc;
    const cg = coarse.levels.get(lvIds[lv])!, g = grids.levels.get(lvIds[lv])!;
    // coarse lattice cell K covers fine lattice cells K·f … K·f + f − 1 (see coarseGrids)
    const ci = cg.ox + (c % cg.nx), cj = cg.oz + Math.floor(c / cg.nx);
    const i0 = Math.max(0, (ci - k) * f - g.ox), i1 = Math.min(g.nx, (ci + k + 1) * f - g.ox);
    const j0 = Math.max(0, (cj - k) * f - g.oz), j1 = Math.min(g.nz, (cj + k + 1) * f - g.oz);
    for (let j = j0; j < j1; j++) for (let i = i0, row = lv * N + j * g.nx; i < i1; i++) S.mask[row + i] = mgen;
  }
  const found = search(grids, prep, opts, { stamp: S.mask, gen: mgen });
  if (!found || 'ok' in found) return null;
  return assemble(grids, prep, start, goal, found, cFound.expanded + found.expanded);
}

/** Build (memoise) the corridor planner's coarse grids now, e.g. at grid-rebuild time instead of inside the first route. */
export function prepareCorridor(grids: GridSet) {
  coarseGrids(grids, Math.max(2, Math.round(CORRIDOR_CELL / grids.cell)));
}

/**
 * Max-clearance coarsening (factor f) of every level, memoised per fine LevelGrid. Lattice-aligned:
 * coarse lattice cell K (cell f·cell) covers fine lattice cells K·f … K·f + f − 1, so the blocks do
 * not depend on the fine grid's origin.
 */
const coarseCache = new WeakMap<LevelGrid, Map<number, LevelGrid>>();
function coarseGrids(grids: GridSet, f: number): GridSet {
  const levels = new Map<number, LevelGrid>();
  for (const [id, g] of grids.levels) {
    let byF = coarseCache.get(g);
    if (!byF) coarseCache.set(g, (byF = new Map()));
    let cg = byF.get(f);
    if (!cg) {
      const ox = Math.floor(g.ox / f), oz = Math.floor(g.oz / f);
      const nx = g.nx ? Math.floor((g.ox + g.nx - 1) / f) - ox + 1 : 0, nz = g.nz ? Math.floor((g.oz + g.nz - 1) / f) - oz + 1 : 0;
      const clearance = new Float32Array(nx * nz), free = new Uint8Array(nx * nz);
      for (let j = 0; j < g.nz; j++)
        for (let i = 0, cj = (Math.floor((g.oz + j) / f) - oz) * nx; i < g.nx; i++) {
          const v = g.clearance[j * g.nx + i], c = cj + Math.floor((g.ox + i) / f) - ox;
          if (v > clearance[c]) clearance[c] = v;
          if (g.free[j * g.nx + i]) free[c] = 1;
        }
      cg = { level: g.level, y: g.y, cell: g.cell * f, nx, nz, ox, oz, x0: ox * g.cell * f, z0: oz * g.cell * f, free, clearance, blockers: new Map() };
      byF.set(f, cg);
    }
    levels.set(id, cg);
  }
  return { cell: grids.cell * f, levels };
}

/** String-pull a cell path keeping every shortcut's clearance ≥ radius. Endpoints are preserved. */
function walkLeg(g: LevelGrid, raw: Vec2[], r: number, _final = false): WalkLeg {
  // (a snapped goal already arrives here as its cell centre; see findRoute)
  const pts = raw.filter((p, i) => i === 0 || i === raw.length - 1 || dist2(p, raw[i - 1]) > 1e-9);
  const out: Vec2[] = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && segmentClearance(g, pts[a], pts[b]) < r) b--;
    out.push(pts[b]);
    a = b;
  }
  let minClearance = Infinity;
  for (let i = 1; i < out.length; i++) minClearance = Math.min(minClearance, segmentClearance(g, out[i - 1], out[i]));
  return { kind: 'walk', level: g.level, points: out, minClearance };
}

function snap(g: LevelGrid, p: Vec2, r: number, tol: number): number {
  const c = cellOf(g, p);
  if (c >= 0 && g.clearance[c] >= r) return c;
  if (c < 0) return -1;
  const k = Math.ceil(tol / g.cell), ci = c % g.nx, cj = Math.floor(c / g.nx);
  let best = -1, bd = Infinity;
  for (let j = cj - k; j <= cj + k; j++)
    for (let i = ci - k; i <= ci + k; i++) {
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
      const n = j * g.nx + i;
      if (g.clearance[n] < r) continue;
      const d = (i - ci) ** 2 + (j - cj) ** 2;
      if (d < bd && d * g.cell * g.cell <= tol * tol) { bd = d; best = n; }
    }
  return best;
}

const pathLen = (p: [number, number, number][]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1], q[2] - p[i][2]), 0);
const pathLen2 = (p: Vec2[]) => p.slice(1).reduce((s, q, i) => s + dist2(q, p[i]), 0);
const fmt = (p: Vec2) => `${p[0].toFixed(2)}, ${p[1].toFixed(2)}`;
const blk = (g: LevelGrid, p: Vec2) => {
  const b = nearestBlocker(g, p);
  return b ? ` (blocked by ${b})` : cellOf(g, p) >= 0 && !g.free[cellOf(g, p)] ? ' (no floor here)' : '';
};
function fail(code: string, message: string, at?: Place, subjects?: string[]): RouteResult {
  return { ok: false, diagnostic: { code, message, subjects, at: at ? [at.p[0], 0, at.p[1]] : undefined } };
}

/**
 * Deterministic indexed binary min-heap over cell ids, ordered by (key, insertion order) — a total
 * order. A push-duplicates heap (the reference) pops each queued cell at the minimum of its
 * entries; later entries are stale no-ops. So `push` of an already queued cell re-keys it in place
 * to (key, fresh order) only when key is strictly lower, and otherwise leaves it — the sequence of
 * effective pops is exactly the reference A*'s.
 * `pos[cell]` (−1 = not queued) is only meaningful for cells stamped in the current search.
 */
class Heap {
  private k = new Float64Array(1024);
  private v = new Int32Array(1024);
  private o = new Float64Array(1024);
  private n = 0;
  size = 0;
  pos: Int32Array = new Int32Array(0);
  reset(pos: Int32Array) {
    this.size = 0;
    this.n = 0;
    this.pos = pos;
  }
  /** Insert `val`, or re-key it if `queued` (caller knows pos[val] is current). */
  push(val: number, key: number, queued: boolean) {
    const ord = this.n++;
    let i: number;
    if (queued) {
      i = this.pos[val];
      // a lower g can round to the same f: the older (smaller-order) entry is then the one that
      // pops first in the reference, so the cell keeps its place
      if (!(key < this.k[i])) return;
    } else {
      if (this.size === this.k.length) this.grow();
      i = this.size++;
    }
    const k = this.k, v = this.v, o = this.o, pos = this.pos;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] < key || (k[p] === key && o[p] < ord)) break;
      k[i] = k[p]; v[i] = v[p]; o[i] = o[p]; pos[v[i]] = i;
      i = p;
    }
    k[i] = key; v[i] = val; o[i] = ord; pos[val] = i;
  }
  pop(): number {
    const k = this.k, v = this.v, o = this.o, pos = this.pos;
    const top = v[0];
    pos[top] = -1;
    const last = --this.size;
    if (last > 0) {
      const key = k[last], val = v[last], ord = o[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= last) break;
        let m = l;
        const r = l + 1;
        if (r < last && (k[r] < k[l] || (k[r] === k[l] && o[r] < o[l]))) m = r;
        if (key < k[m] || (key === k[m] && ord < o[m])) break;
        k[i] = k[m]; v[i] = v[m]; o[i] = o[m]; pos[v[i]] = i;
        i = m;
      }
      k[i] = key; v[i] = val; o[i] = ord; pos[val] = i;
    }
    return top;
  }
  private grow() {
    const n = this.k.length * 2;
    const k = new Float64Array(n), v = new Int32Array(n), o = new Float64Array(n);
    k.set(this.k); v.set(this.v); o.set(this.o);
    this.k = k; this.v = v; this.o = o;
  }
}

/** Reusable search workspaces keyed by search size (fine + coarse grids of the last scenes).
 *  findRoute is not reentrant while searching; its only recursion runs after its search is done. */
type Scratch = { total: number; gen: number; gScore: Float64Array; came: Int32Array; pos: Int32Array; stamp: Uint32Array; shut: Uint32Array; heap: Heap; mask?: Uint32Array; maskGen: number };
const scratches = new Map<number, Scratch>();
const SCRATCHES = 3;
function scratchFor(total: number): Scratch {
  let sc = scratches.get(total);
  if (!sc) {
    if (scratches.size >= SCRATCHES) scratches.delete(scratches.keys().next().value!);
    sc = { total, gen: 0, gScore: new Float64Array(total), came: new Int32Array(total), pos: new Int32Array(total), stamp: new Uint32Array(total), shut: new Uint32Array(total), heap: new Heap(), maskGen: 0 };
    scratches.set(total, sc);
  }
  if (sc.gen >= 0xfffffffe) {
    sc.gen = 0;
    sc.stamp.fill(0);
    sc.shut.fill(0);
  }
  sc.gen++;
  return sc;
}
