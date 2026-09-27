// Spatial service: composes base static geometry with the current world's
// entities, keeps grids in sync (navigation epoch), and answers route /
// clearance queries. Construction mutates entities; the next query sees the
// new topology (spec §10 "construction must alter future navigation").
import { hashOf } from '../core/hash.ts';
import { dcos, dsin, rot2, type OBB2, type Vec2 } from '../core/math.ts';
import type { Entity, WorldState } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { buildGrids, gridsWithObstacles, StaticRaster, type GridSet } from './grid.ts';
import { findRoute, type Place, type RouteResult } from './path.ts';
import type { AgentProfile, Link, Obstacle, SpatialScene, Surface } from './types.ts';

/** Phases in which a component physically occupies space as a static obstacle. */
const STATIC_PHASES = new Set(['stored', 'reserved', 'staged', 'placed', 'installed', 'raising']);
/** Bounded memo of people-augmented grids (each holds full-size rasters). */
const AROUND_CACHE = 8;

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
  scene!: SpatialScene;
  grids!: GridSet;
  epoch = 0;
  private key = '';
  /** Rasters of the base obstacles (they lead every synced scene's obstacle list). */
  private raster: StaticRaster;

  constructor(base: SpatialScene, opts: { cell?: number; contributors?: Contributor[]; baseId?: string } = {}) {
    this.base = base;
    this.baseId = opts.baseId ?? hashOf(base);
    this.cell = opts.cell ?? 0.1;
    this.contributors = opts.contributors ?? [];
    this.raster = new StaticRaster(base.obstacles, base.bounds, this.cell);
  }

  /** Rebuild derived scene/grids iff navigation-relevant world content changed. */
  sync(world: WorldState): boolean {
    const relevant = Object.values(world.entities)
      .filter((e) => e.kind !== 'human' && e.phase && STATIC_PHASES.has(e.phase))
      .map((e) => [e.id, e.def, e.phase, e.pose, e.connections ?? [], e.support?.kind ?? '']);
    const key = hashOf(relevant);
    if (key === this.key && this.scene) return false;
    this.key = key;
    const obstacles: Obstacle[] = [...this.base.obstacles];
    const surfaces: Surface[] = [...this.base.surfaces];
    const links: Link[] = [...this.base.links];
    const levels = [...this.base.levels];
    for (const e of Object.values(world.entities)) {
      if (e.kind === 'human' || !e.phase || !STATIC_PHASES.has(e.phase)) continue;
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
    this.scene = { bounds: this.base.bounds, levels, surfaces, obstacles, links };
    this.grids = buildGrids(this.scene, this.cell, this.raster);
    this.epoch++;
    return true;
  }

  route(world: WorldState, profile: AgentProfile, start: Place, goal: Place, opts?: Parameters<typeof findRoute>[5]): RouteResult {
    this.sync(world);
    return findRoute(this.grids, this.scene, profile, start, goal, opts);
  }

  level(id: number) {
    return this.grids.levels.get(id);
  }

  private aroundCache = new Map<string, { scene: SpatialScene; grids: GridSet }>();
  /**
   * Grids of the current scene with the given standing people added as soft obstacles (for
   * replanning around them). Exact — identical to buildGrids of the augmented scene — but built
   * incrementally from the synced grids and memoised per (epoch, ordered people, exact positions).
   */
  gridsAround(world: WorldState, people: { id: string; p: Vec2 }[]): { scene: SpatialScene; grids: GridSet } {
    this.sync(world);
    const key = `${this.epoch}|${people.map((q) => `${q.id}@${q.p[0]},${q.p[1]}`).join(';')}`;
    let hit = this.aroundCache.get(key);
    if (hit) {
      this.aroundCache.delete(key);
      this.aroundCache.set(key, hit);
      return hit;
    }
    // people as obstacles: 0.3 m half-width so corridors pass ≥ 0.58 m from them (the hard
    // separation guard is 0.54 m); the route start snaps within 0.5 m if someone stands close
    const extra: Obstacle[] = people.map((q) => ({ id: q.id, obb: { c: q.p, half: [0.3, 0.3], yaw: 0 }, y0: 0, y1: 1.8, kind: 'solid', label: `person ${q.id}` }));
    hit = { scene: { ...this.scene, obstacles: [...this.scene.obstacles, ...extra] }, grids: gridsWithObstacles(this.grids, extra) };
    for (const k of this.aroundCache.keys()) if (this.aroundCache.size >= AROUND_CACHE || !k.startsWith(`${this.epoch}|`)) this.aroundCache.delete(k);
    this.aroundCache.set(key, hit);
    return hit;
  }

  /** One-off route treating standing people as temporary obstacles (a walker blocked by someone not moving). */
  routeAround(world: WorldState, profile: AgentProfile, start: Place, goal: Place, people: { id: string; p: Vec2 }[]): RouteResult {
    const { scene, grids } = this.gridsAround(world, people);
    return findRoute(grids, scene, profile, start, goal);
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
    const n = g.nx * g.nz;
    lab = new Int32Array(n).fill(-1);
    const isNarrow = (c: number) => g.clearance[c] >= r && g.clearance[c] < 2 * r + margin;
    let next = 0;
    const stack: number[] = [];
    for (let c = 0; c < n; c++) {
      if (lab[c] !== -1 || !isNarrow(c)) continue;
      lab[c] = next;
      stack.push(c);
      while (stack.length) {
        const k = stack.pop()!;
        const i = k % g.nx, j = (k - i) / g.nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
          const m = nj * g.nx + ni;
          if (lab[m] === -1 && isNarrow(m)) { lab[m] = next; stack.push(m); }
        }
      }
      next++;
    }
    this.narrowCache.set(key, lab);
    return lab;
  }
}
