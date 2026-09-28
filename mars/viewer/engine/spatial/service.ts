// Spatial service: composes base static geometry with the current world's
// entities, keeps grids in sync (navigation epoch), and answers route /
// clearance queries. Construction mutates entities; the next query sees the
// new topology (spec §10 "construction must alter future navigation").
import { hashOf } from '../core/hash.ts';
import { dcos, dsin, rot2, type OBB2, type Vec2 } from '../core/math.ts';
import type { Entity, WorldState } from '../world/types.ts';
import { CATALOG, def } from '../world/catalog.ts';
import { buildGrids, gridsWithObstacles, StaticRaster, updateGrids, type GridSet } from './grid.ts';
import { findRoute, prepareCorridor, type Place, type RouteOpts, type RouteResult } from './path.ts';
import type { AgentProfile, Link, Obstacle, SpatialScene, Surface } from './types.ts';
import type { Profiler } from '../runtime/profile.ts';

/** Phases in which a component physically occupies space as a static obstacle. */
const STATIC_PHASES = new Set(['stored', 'reserved', 'staged', 'placed', 'installed', 'raising']);
/** Non-human entity that blocks walking where it stands: a static phase, or no phase and a catalog `obstacle` fixture (chair, bench, campfire). */
const isStatic = (e: Entity) => e.kind !== 'human' && (e.phase ? STATIC_PHASES.has(e.phase) : CATALOG[e.def]?.obstacle === true);
/**
 * What sync's change test reads of one static entity: id, def, phase, pose (p, yaw, pitch, roll),
 * connections (socket / to / toSocket, flattened) and support kind — exactly the fields the old
 * `hashOf([id, def, phase, pose, connections ?? [], support?.kind ?? ''])` key hashed. Numbers are
 * compared with ===, which agrees with that key's JSON text (-0 = 0; undefined ≠ 0 for pitch/roll).
 * Actions mutate `pose.p` and push onto `connections` in place, so values are copied, not referenced.
 */
type NavSnap = { id: string; def: string; phase: string | undefined; x: number; y: number; z: number; yaw: number; pitch: number | undefined; roll: number | undefined; conn: string[]; support: string };

function navSnap(e: Entity, s?: NavSnap): NavSnap {
  const conn: string[] = [];
  if (e.connections) for (const c of e.connections) conn.push(c.socket, c.to, c.toSocket);
  const p = e.pose.p, support = e.support?.kind ?? '';
  if (!s) return { id: e.id, def: e.def, phase: e.phase, x: p[0], y: p[1], z: p[2], yaw: e.pose.yaw, pitch: e.pose.pitch, roll: e.pose.roll, conn, support };
  s.id = e.id; s.def = e.def; s.phase = e.phase; s.x = p[0]; s.y = p[1]; s.z = p[2];
  s.yaw = e.pose.yaw; s.pitch = e.pose.pitch; s.roll = e.pose.roll; s.conn = conn; s.support = support;
  return s;
}

function sameNav(s: NavSnap, e: Entity): boolean {
  const p = e.pose.p, pose = e.pose;
  if (s.id !== e.id || s.def !== e.def || s.phase !== e.phase || s.x !== p[0] || s.y !== p[1] || s.z !== p[2] || s.yaw !== pose.yaw || s.pitch !== pose.pitch || s.roll !== pose.roll || s.support !== (e.support?.kind ?? '')) return false;
  const cs = e.connections, conn = s.conn;
  if ((cs ? cs.length * 3 : 0) !== conn.length) return false;
  if (cs) for (let i = 0, k = 0; i < cs.length; i++, k += 3) {
    const c = cs[i];
    if (c.socket !== conn[k] || c.to !== conn[k + 1] || c.toSocket !== conn[k + 2]) return false;
  }
  return true;
}

/** Bounded memo of people-augmented grids (each holds full-size rasters). */
const AROUND_CACHE = 8;
/** Height band a standing person blocks above their feet. */
const PERSON_H = 1.8;

/** A temporary obstacle for gridsAround/routeAround: a person id (height from the world, or `y`) or `<entity>#i` load disc. */
export type AroundPerson = { id: string; p: Vec2; y?: number };

function aroundObstacle(world: WorldState, q: AroundPerson): { o: Obstacle; foot?: number } {
  const e = world.entities[q.id] ?? world.entities[q.id.split('#')[0]];
  const obb = { c: q.p, half: [0.3, 0.3] as Vec2, yaw: 0 };
  if (q.y === undefined && e && e.kind !== 'human') {
    const f = entityFootprint(e);
    return { o: { id: q.id, obb, y0: f.y0, y1: f.y1, kind: 'solid', label: `${e.label ?? e.id} (moving)` } };
  }
  const foot = q.y ?? e?.pose.p[1] ?? 0;
  return { o: { id: q.id, obb, y0: foot, y1: foot + PERSON_H, kind: 'solid', label: `person ${q.id}` }, foot };
}

/** World-space box corners for an entity (handles yaw/pitch/roll). */
export function entityCorners(e: Entity): [number, number, number][] {
  const [sx, sy, sz] = def(e.def).size;
  const out: [number, number, number][] = [];
  const cy = dcos(e.pose.yaw), syw = dsin(e.pose.yaw);
  const cp = dcos(e.pose.pitch ?? 0), sp = dsin(e.pose.pitch ?? 0);
  const cr = dcos(e.pose.roll ?? 0), sr = dsin(e.pose.roll ?? 0);
  // local box: x∈[-sx/2,sx/2], y∈[0,sy] (origin at base centre), z∈[-sz/2,sz/2]
  for (const x of [-sx / 2, sx / 2]) for (const y of [0, sy]) for (const z of [-sz / 2, sz / 2]) {
    // roll about Z
    let X = x * cr - y * sr, Y = x * sr + y * cr, Z = z;
    // pitch about X
    const Y2 = Y * cp - Z * sp, Z2 = Y * sp + Z * cp;
    Y = Y2; Z = Z2;
    // yaw about Y (counter-clockwise from above in x/z): x' = x cos - z sin, z' = x sin + z cos
    const X3 = X * cy - Z * syw, Z3 = X * syw + Z * cy;
    X = X3; Z = Z3;
    out.push([e.pose.p[0] + X, e.pose.p[1] + Y, e.pose.p[2] + Z]);
  }
  return out;
}

/** Tight yaw-aligned ground footprint + vertical span of an entity. */
export function entityFootprint(e: Entity, pad = 0): { obb: OBB2; y0: number; y1: number } {
  const cs = entityCorners(e);
  let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y, z] of cs) {
    const l = rot2([x - e.pose.p[0], z - e.pose.p[2]], -e.pose.yaw);
    ax = Math.min(ax, l[0]); bx = Math.max(bx, l[0]); az = Math.min(az, l[1]); bz = Math.max(bz, l[1]);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const lc: Vec2 = [(ax + bx) / 2, (az + bz) / 2];
  const c = rot2(lc, e.pose.yaw);
  return { obb: { c: [e.pose.p[0] + c[0], e.pose.p[2] + c[1]], half: [(bx - ax) / 2 + pad, (bz - az) / 2 + pad], yaw: e.pose.yaw }, y0, y1 };
}

export type SceneContribution = { obstacles?: Obstacle[]; surfaces?: Surface[]; links?: Link[] };
/** Mars-specific construction semantics can contribute walkable decks / stairs (see construction/). */
export type Contributor = (world: WorldState, base: SpatialScene) => SceneContribution;

export class Spatial {
  base: SpatialScene;
  /** Identity of the static base this service represents (defaults to hashOf(base)). A crop of a
   *  campus is a performance view of the same base and shares the campus content hash. */
  baseId: string;
  cell: number;
  contributors: Contributor[];
  /** Route planner for route()/routeAround() (path.ts RouteOpts.planner); 'exact' unless opted in. */
  planner: 'exact' | 'corridor';
  /** routeAround proves unreachable goals early (path.ts RouteOpts.proveUnreachable); identical results either way. */
  proveUnreachable = true;
  /** Patch the previous grids on sync (grid.ts updateGrids, bit-identical) instead of rebuilding; default on. */
  incremental: boolean;
  scene!: SpatialScene;
  grids!: GridSet;
  epoch = 0;
  /** Set by `rt.profile = true`: wall ms per method (spatial.route includes its spatial.sync). */
  prof?: Profiler;
  /** Navigation-relevant snapshot of the static entities (in world order) at the last rebuild. */
  private snaps: NavSnap[] = [];
  /** Rasters of the base obstacles (they lead every synced scene's obstacle list). */
  private raster: StaticRaster;

  constructor(base: SpatialScene, opts: { cell?: number; contributors?: Contributor[]; baseId?: string; planner?: 'exact' | 'corridor'; incremental?: boolean } = {}) {
    this.base = base;
    this.baseId = opts.baseId ?? hashOf(base);
    this.cell = opts.cell ?? 0.1;
    this.contributors = opts.contributors ?? [];
    this.planner = opts.planner ?? 'exact';
    this.incremental = opts.incremental ?? true;
    this.raster = new StaticRaster(base.obstacles, base.bounds, this.cell);
  }

  /** Rebuild derived scene/grids iff navigation-relevant world content changed. */
  sync(world: WorldState): boolean {
    const p = this.prof;
    if (!p) return this.syncNow(world);
    const t0 = p.now();
    const rebuilt = this.syncNow(world);
    p.add(rebuilt ? 'spatial.sync.rebuild' : 'spatial.sync', p.now() - t0);
    return rebuilt;
  }

  private syncNow(world: WorldState): boolean {
    if (!this.navChanged(world) && this.scene) return false;
    const obstacles: Obstacle[] = [...this.base.obstacles];
    const surfaces: Surface[] = [...this.base.surfaces];
    const links: Link[] = [...this.base.links];
    const levels = [...this.base.levels];
    for (const e of Object.values(world.entities)) {
      if (!isStatic(e)) continue;
      const f = entityFootprint(e);
      obstacles.push({ id: e.id, obb: f.obb, y0: f.y0, y1: f.y1, kind: 'component', label: e.label ?? def(e.def).label });
    }
    for (const c of this.contributors) {
      const r = c(world, this.base);
      if (r.obstacles) obstacles.push(...r.obstacles);
      if (r.surfaces) for (const s of r.surfaces) {
        surfaces.push(s);
        if (!levels.some((l) => l.id === s.level)) levels.push({ id: s.level, y: s.y, label: s.label ?? `level ${s.level}` });
      }
      if (r.links) links.push(...r.links);
    }
    const prev = this.scene;
    this.scene = { bounds: this.base.bounds, levels, surfaces, obstacles, links };
    // construction changes a few components: patch only their cells (and the clearance they can reach)
    const grids = () => (this.incremental && prev && updateGrids(this.grids, prev, this.scene, this.cell, this.raster)) || buildGrids(this.scene, this.cell, this.raster, this.incremental);
    this.grids = this.prof ? this.prof.time('spatial.sync.grids', grids) : grids();
    if (this.planner === 'corridor') prepareCorridor(this.grids);
    this.epoch++;
    return true;
  }

  /**
   * Whether any navigation-relevant field of the static entities (or their set / order) differs from
   * the last call; refreshes the snapshots. Allocation-free when nothing changed (~35k calls a run),
   * and changes exactly when the former sha256 key over the same fields would (planning.test.ts).
   */
  private navChanged(world: WorldState): boolean {
    const snaps = this.snaps;
    let n = 0, changed = false;
    for (const id in world.entities) {
      const e = world.entities[id];
      if (!isStatic(e)) continue;
      const s = snaps[n];
      if (!s) { snaps.push(navSnap(e)); changed = true; }
      else if (!sameNav(s, e)) { navSnap(e, s); changed = true; }
      n++;
    }
    if (snaps.length !== n) { snaps.length = n; changed = true; }
    return changed;
  }

  route(world: WorldState, profile: AgentProfile, start: Place, goal: Place, opts?: RouteOpts): RouteResult {
    const o = this.planner === 'exact' ? opts : { planner: this.planner, ...opts };
    if (this.prof) return this.prof.time('spatial.route', () => (this.sync(world), findRoute(this.grids, this.scene, profile, start, goal, o)));
    this.sync(world);
    return findRoute(this.grids, this.scene, profile, start, goal, o);
  }

  level(id: number) {
    return this.grids.levels.get(id);
  }

  /**
   * Grids of `scene`, a variant of the synced scene (same bounds, the base obstacles leading, some
   * obstacles removed or appended, any subset of its levels), patched from the synced grids by
   * updateGrids — bit-identical to `buildGrids(scene, cell)` (grid-incremental.test.ts); a full
   * build when the diff is not a pure add / remove. Call after sync(world).
   */
  gridsFor(scene: SpatialScene): GridSet {
    const run = () => updateGrids(this.grids, this.scene, scene, this.cell, this.raster) ?? buildGrids(scene, this.cell, this.raster);
    return this.prof ? this.prof.time('spatial.gridsFor', run) : run();
  }

  private aroundCache = new Map<string, { scene: SpatialScene; grids: GridSet }>();
  /**
   * Grids of the current scene with the given standing people added as soft obstacles (for
   * replanning around them), built incrementally from the synced grids and memoised per
   * (epoch, ordered people, exact positions and heights).
   *
   * A person occupies [foot, foot + 1.8 m] where foot = their pose y (or `q.y`), and is rasterised
   * only into levels whose floor lies in [foot − 0.3, foot + 1.8) — the level they stand on, not a
   * deck overhead or the ground under a deck (review M3). Anything else in `people` (e.g. carried-
   * load discs `<entity>#i`) keeps its entity's real height band under the usual per-level rule.
   */
  gridsAround(world: WorldState, people: AroundPerson[]): { scene: SpatialScene; grids: GridSet } {
    if (this.prof) return this.prof.time('spatial.gridsAround', () => this.gridsAroundNow(world, people));
    return this.gridsAroundNow(world, people);
  }

  private gridsAroundNow(world: WorldState, people: AroundPerson[]): { scene: SpatialScene; grids: GridSet } {
    this.sync(world);
    const placed = people.map((q) => aroundObstacle(world, q));
    const key = `${this.epoch}|${placed.map(({ o, foot }) => `${o.id}@${o.obb.c[0]},${o.obb.c[1]},${o.y0},${o.y1},${foot ?? ''}`).join(';')}`;
    let hit = this.aroundCache.get(key);
    if (hit) {
      this.aroundCache.delete(key);
      this.aroundCache.set(key, hit);
      return hit;
    }
    const extra = placed.map((x) => x.o);
    // people as obstacles: 0.3 m half-width so corridors pass ≥ 0.58 m from them (the hard
    // separation guard is 0.54 m); the route start snaps within 0.5 m if someone stands close.
    // Rasterise level by level so each person lands only on the levels at their own height.
    const levels = new Map(this.grids.levels);
    for (const [id, g] of this.grids.levels) {
      const here: Obstacle[] = [];
      for (const { o, foot } of placed) {
        if (foot === undefined) here.push(o);
        else if (g.y >= foot - 0.3 && g.y < foot + PERSON_H) here.push({ ...o, y0: g.y, y1: g.y + PERSON_H });
      }
      if (here.length) levels.set(id, gridsWithObstacles({ cell: this.grids.cell, levels: new Map([[id, g]]) }, here).levels.get(id)!);
    }
    hit = { scene: { ...this.scene, obstacles: [...this.scene.obstacles, ...extra] }, grids: { cell: this.grids.cell, levels } };
    for (const k of this.aroundCache.keys()) if (this.aroundCache.size >= AROUND_CACHE || !k.startsWith(`${this.epoch}|`)) this.aroundCache.delete(k);
    this.aroundCache.set(key, hit);
    return hit;
  }

  /** One-off route treating standing people as temporary obstacles (a walker blocked by someone not moving). */
  routeAround(world: WorldState, profile: AgentProfile, start: Place, goal: Place, people: AroundPerson[], explainUnusable?: (linkId: string) => boolean): RouteResult {
    const run = () => {
      const { scene, grids } = this.gridsAround(world, people);
      // a people-avoidance replan fails often (walled in, a pocket cut off): prove it early (path.ts proveUnreachable)
      const opts: RouteOpts = { proveUnreachable: this.proveUnreachable, explainUnusable };
      if (this.planner !== 'exact') opts.planner = this.planner;
      return findRoute(grids, scene, profile, start, goal, opts);
    };
    return this.prof ? this.prof.time('spatial.routeAround', run) : run();
  }

  private narrowCache = new Map<string, Int32Array>();
  /**
   * Connected components of "single-file" cells: standable for radius r but
   * too tight for two agents to pass (clearance < 2r + margin). Each component
   * is a traffic resource that opposing walkers must take turns through.
   */
  narrow(level: number, r: number, margin = 0.15): Int32Array {
    const key = `${this.epoch}:${level}:${r}:${margin}`;
    let lab = this.narrowCache.get(key);
    if (lab) return lab;
    if (this.narrowCache.size > 16) this.narrowCache.clear();
    const g = this.grids.levels.get(level)!;
    // labels depend only on (clearance, nx, nz, r, margin): a construction step that flips no cell of
    // this level keeps its clearance array (grid.ts updateGrids), so its labels carry over unchanged
    const byArr = narrowLabels.get(g.clearance);
    const sub = `${g.nx}:${g.nz}:${r}:${margin}`;
    lab = byArr?.get(sub) ?? narrowComponents(g.clearance, g.nx, g.nz, r, margin);
    if (!byArr) narrowLabels.set(g.clearance, new Map([[sub, lab]]));
    else byArr.set(sub, lab);
    this.narrowCache.set(key, lab);
    return lab;
  }
}

/** narrow() labels per clearance array (never mutated after it is built; PLANNING_BUDGET.md §6). */
const narrowLabels = new WeakMap<Float32Array, Map<string, Int32Array>>();

/**
 * 4-connected components of the cells with r ≤ clearance < 2r + margin, numbered in the order of
 * their first cell in row-major scan (so the numbering does not depend on the flood order).
 */
export function narrowComponents(cl: Float32Array, nx: number, nz: number, r: number, margin: number): Int32Array {
  const n = nx * nz;
  const lab = new Int32Array(n).fill(-1);
  const hi = 2 * r + margin;
  const stack = narrowStack.length >= n ? narrowStack : (narrowStack = new Int32Array(n));
  let next = 0;
  for (let c = 0; c < n; c++) {
    if (lab[c] !== -1) continue;
    const v = cl[c];
    if (!(v >= r && v < hi)) continue;
    lab[c] = next;
    let top = 0;
    stack[top++] = c;
    while (top) {
      const k = stack[--top];
      const i = k % nx;
      let m: number, w: number;
      if (i + 1 < nx && lab[(m = k + 1)] === -1 && (w = cl[m]) >= r && w < hi) { lab[m] = next; stack[top++] = m; }
      if (i > 0 && lab[(m = k - 1)] === -1 && (w = cl[m]) >= r && w < hi) { lab[m] = next; stack[top++] = m; }
      if (k + nx < n && lab[(m = k + nx)] === -1 && (w = cl[m]) >= r && w < hi) { lab[m] = next; stack[top++] = m; }
      if (k >= nx && lab[(m = k - nx)] === -1 && (w = cl[m]) >= r && w < hi) { lab[m] = next; stack[top++] = m; }
    }
    next++;
  }
  return lab;
}
let narrowStack = new Int32Array(0);
