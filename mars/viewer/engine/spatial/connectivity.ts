// Connectivity audit (lane NAV, tranche 2026-10-20). Gene: "pathfinding should be 100% reliable. we cant have world's
// accidentally making souls or other things immobile." A god-placed cottage on bench-hamlet was sealed off from
// everywhere (its door too tight at that yaw, a steep foundation bank in front of it): Souls were offered `walk:cottage`
// and every walk refused route.unreachable.
//
// This answers, for any standing point, "is it connected to the world's main walkable area?" — the same question the
// route planner (path.ts) answers for one pair of points, for the whole world at once, on the planner's own cells:
//
//  - Level 0 is labelled into connected components of the planner's passable cells (clearance >= body radius +
//    PLAN_MARGIN; the planner never cuts corners, so 4-connected labelling is exactly its reachability on one level).
//  - Ground worlds (tiled.ts): each 64 m tile is labelled on its own (the engine's fine tile, built once per content key),
//    tiles whose ground is all plain walkable ground with nothing on it are one component without building anything,
//    and components are joined across tile seams. Only tiles whose content key changed are relabelled, so the check
//    after a god edit costs the edited tiles, not the world.
//  - Flat worlds (Mars, old Eden, Little Martians): each level grid is labelled whole when the navigation epoch moves.
//  - Upper floors of ground worlds: each building's floors (upper surfaces within 1 m of each other) are rasterised as
//    the planner rasterises them (buildGridsOverFloors: the same cells) and labelled, cached by the building's content.
//  - Stairs and ramps join components exactly as the planner joins levels: its own link test (path.ts linkEdgeTest) on
//    the same cells, one directed edge per direction it allows.
//  - The main area is the component holding the world's arrival point (else the largest). A component is connected when
//    a walk joins it to the main area both ways (a stair one can climb but not come down is a trap, not a connection).
//    Points in one component share one verdict (`area`), so a sealed room is one finding, however many things are in it.
//
// Pure derived data over the planner's grids: nothing here is logged, and nothing changes the world.
import { dcos, dsin, hypot, type Vec2 } from '../core/math.ts';
import { buildGridsOverFloors, latticeIndex, latticeCentre, type LevelGrid } from './grid.ts';
import { GROUND_TILE_M, G_OUTSIDE, G_STEEP, G_WALK, type GroundField } from './ground.ts';
import { linkApproach, linkEdgeTest, PLAN_MARGIN, snap as snapCell } from './path.ts';
import type { Spatial } from './service.ts';
import { boxesOf } from './tiled.ts';
import { HUMAN_PROFILE, type Link, type Surface } from './types.ts';

/** Policy id of the audit's rules (what counts as connected, what a rescue picks): bump when they change. */
export const NAV_CONNECT_POLICY = 'nav-connect/1';
/** The planner's passable test for the default body (path.ts prepare: radius + PLAN_MARGIN). */
export const CONNECT_CLEAR = HUMAN_PROFILE.radius + PLAN_MARGIN;
/** A body cut off in a separate area at most this big (m², level 0) is stepped to the main area; a larger one (an island, a
 *  walled quarter) is a place it can live in and walk about, so it stays (the god hears of it). */
export const NAV_RESCUE_MAX_POCKET = 2500;
/** Clearance a rescue spot keeps (m): room to stand and turn, not a cell squeezed between two walls. */
export const RESCUE_CLEAR = CONNECT_CLEAR + 0.16;
/** Upper surfaces closer than this (m) are one building (rasterised together). */
const CLUSTER_GAP = 1;

/** One labelled tile: components, their sizes (cells), and the labels of its four edges (-1 = not passable).
 *  border: [0, per) the first row (j = 0), [per, 2per) the last row, [2per, 3per) the first column, [3per, 4per) the last. */
type TileLabels = { key: string; n: number; sizes: Int32Array; border: Int32Array; uniform: 0 | 1 | 2 };
/** A building's upper floors: its surfaces, and per level the grid the planner would build there, labelled. */
type Cluster = { key: string; box: [number, number, number, number]; members: Surface[]; levels: Map<number, { g: LevelGrid; labels: Int32Array }> };

export type ConnPoint = { id: string; p: Vec2; level?: number; tol?: number };
export type ConnVerdict = {
  id: string; level: number; ok: boolean;
  /** nav.no-standing-room: no passable cell within `tol`; nav.disconnected: standing room, but no walk joins it to the
   *  main area; nav.one-way: a walk joins it one way only (it can be entered and not left, or left and not entered). */
  code?: 'nav.no-standing-room' | 'nav.disconnected' | 'nav.one-way';
  /** The component it stands in: points sharing `area` share the verdict. */
  area?: string;
  /** The component's area (m², level 0), when not connected. */
  pocket?: number;
  /** Upper floors: the floor (surface id) it stands on, when not connected. */
  floor?: string;
};

const ALL = new Int32Array(0), NONE = new Int32Array(0);

/** Label the passable cells (clearance >= t) of an nx × nz grid into 4-connected components. */
export function labelComponents(cl: Float32Array, nx: number, nz: number, t: number): { labels: Int32Array; n: number; sizes: number[] } {
  const N = nx * nz, labels = new Int32Array(N).fill(-1), q = new Int32Array(N), sizes: number[] = [];
  let n = 0;
  for (let s = 0; s < N; s++) {
    if (labels[s] >= 0 || !(cl[s] >= t)) continue;
    const id = n++; let head = 0, tail = 0, size = 0;
    labels[s] = id; q[tail++] = s;
    while (head < tail) {
      const c = q[head++]; size++;
      const i = c % nx;
      if (i > 0 && labels[c - 1] < 0 && cl[c - 1] >= t) { labels[c - 1] = id; q[tail++] = c - 1; }
      if (i < nx - 1 && labels[c + 1] < 0 && cl[c + 1] >= t) { labels[c + 1] = id; q[tail++] = c + 1; }
      if (c >= nx && labels[c - nx] < 0 && cl[c - nx] >= t) { labels[c - nx] = id; q[tail++] = c - nx; }
      if (c < N - nx && labels[c + nx] < 0 && cl[c + nx] >= t) { labels[c + nx] = id; q[tail++] = c + nx; }
    }
    sizes.push(size);
  }
  return { labels, n, sizes };
}

/** Whether a ground tile is plain walkable ground (1), nothing walkable (2: outside the world or too steep), or neither
 *  (0), judged on its 1 m media out to 3 m past its edges (the fine raster's apron and water test read 2 m + 1 cell). */
export function mediaClass(f: GroundField, tx: number, tz: number): 0 | 1 | 2 {
  const x0 = tx * GROUND_TILE_M - 3, z0 = tz * GROUND_TILE_M - 3, n = GROUND_TILE_M + 6;
  let walk = true, none = true;
  for (let j = 0; j < n && (walk || none); j++) {
    const z = z0 + j, ttz = Math.floor(z / GROUND_TILE_M), cj = z - ttz * GROUND_TILE_M;
    for (let i = 0; i < n; i++) {
      const x = x0 + i, ttx = Math.floor(x / GROUND_TILE_M), m = f.mediaTile(ttx, ttz)[cj * GROUND_TILE_M + (x - ttx * GROUND_TILE_M)];
      if (m !== G_WALK) walk = false;
      if (m !== G_OUTSIDE && m !== G_STEEP) none = false;
      if (!walk && !none) break;
    }
  }
  return walk ? 1 : none ? 2 : 0;
}

/** World AABB of an oriented box. */
function aabb(o: { c: Vec2; half: Vec2; yaw: number }, grow = 0): [number, number, number, number] {
  const c = Math.abs(dcos(o.yaw)), s = Math.abs(dsin(o.yaw)), hx = c * o.half[0] + s * o.half[1] + grow, hz = s * o.half[0] + c * o.half[1] + grow;
  return [o.c[0] - hx, o.c[1] - hz, o.c[0] + hx, o.c[1] + hz];
}
function fnv(s: string, h = 0x811c9dc5): number { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; }

/**
 * Connectivity of one Spatial service. `update()` after a sync relabels what changed; `check` / `nearestMain` / `rootAt`
 * read the labels. Holds per tile only its edge labels (~10 kB); full label rasters of a few recently read tiles are
 * kept in a small LRU and rebuilt (from the engine's fine tile) when read again.
 */
export class NavConnectivity {
  readonly spatial: Spatial;
  readonly t: number;
  private anchors: () => Vec2[];
  /** Ground: per tile "tx,tz" its labels. */
  private tiles = new Map<string, TileLabels>();
  private ext: [number, number, number, number] = [0, 0, -1, -1];
  private per = 0;
  private flat: { g: LevelGrid; labels: Int32Array; key: string } | null = null;
  private parent = new Int32Array(0);
  private base = new Map<string, number>();
  private rootSize = new Map<number, number>();
  private lru = new Map<string, { labels: Int32Array; clearance: Float32Array }>();
  private mediaMemo = new Map<string, 0 | 1 | 2>();
  /** Level-0 labels changed since the last join (a budgeted update can stop part way). */
  private dirty = true;
  /** Ground worlds: buildings' upper floors by content key; flat worlds: each upper level grid's labels. */
  private clusters: Cluster[] = [];
  private clusterMemo = new Map<string, Cluster>();
  private flatUpper = new WeakMap<LevelGrid, Int32Array>();
  /** Components joined to the main area both ways (node ids: `0:<root>` level 0, `u<cluster>:<level>:<label>` upper). */
  private good = new Set<string>();
  private fwd = new Set<string>();
  private bwd = new Set<string>();
  private graphVer = '';
  /** Each stair verdict by what it read (see graph()). */
  private linkMemo = new Map<string, { a: string; b: string } | null>();
  /** The main component's root (-1: no walkable ground at all). */
  main = -1;
  /** What the labels were last built from (changes exactly when the static world does). */
  version = '';
  /** False while a budgeted update has tiles left to label (check/nearestMain need a complete one). */
  ready = false;
  stats = { updates: 0, relabelled: 0, reused: 0, uniform: 0, lastMs: 0, lastRelabelled: 0, graphMs: 0, clusterMs: 0, links: 0, edges: 0, clusters: 0, clusterBuilds: 0, linkHits: 0 };

  constructor(spatial: Spatial, opts: { anchors: () => Vec2[]; clear?: number }) {
    this.spatial = spatial; this.anchors = opts.anchors; this.t = opts.clear ?? CONNECT_CLEAR;
  }

  /**
   * Relabel what changed since the last update (call after spatial.sync(world)). `budgetMs`: stop labelling tiles once
   * this much time is spent (a background warm-up), leaving `ready` false; the next update carries on. Returns `ready`.
   */
  update(budgetMs = Infinity): boolean {
    const t0 = performance.now(), sp = this.spatial, g = sp.ground;
    let relabelled = 0;
    if (!g) {
      const lv = sp.grids.levels.get(0);
      const key = `${sp.baseId}|${sp.epoch}|${lv ? `${lv.ox},${lv.oz},${lv.nx},${lv.nz}` : ''}`;
      if (this.flat?.key !== key || this.version !== key) {
        this.tiles.clear(); this.lru.clear();
        if (lv) {
          const { labels, n, sizes } = labelComponents(lv.clearance, lv.nx, lv.nz, this.t);
          this.flat = { g: lv, labels, key };
          this.parent = Int32Array.from({ length: n }, (_, i) => i);
          this.rootSize = new Map(sizes.map((s, i) => [i, s]));
        } else { this.flat = null; this.parent = new Int32Array(0); this.rootSize.clear(); }
        relabelled = 1; this.version = key; this.findMain();
      }
    } else {
      this.flat = null;
      const obstacles = sp.scene.obstacles, ext = g.extentTiles();
      this.per = g.per; this.ext = ext;
      const seen = new Set<string>();
      for (let tz = ext[1]; tz <= ext[3]; tz++) for (let tx = ext[0]; tx <= ext[2]; tx++) {
        const id = `${tx},${tz}`, te = g.tileEntry(tx, tz, obstacles);
        seen.add(id);
        let uni: 0 | 1 | 2 = 0;
        if (!te.rel.length) { const mk = `${g.field.id}|${id}`; uni = this.mediaMemo.get(mk) ?? 0; if (!this.mediaMemo.has(mk)) { uni = mediaClass(g.field, tx, tz); this.mediaMemo.set(mk, uni); } }
        const key = uni ? `${g.field.id}|u${uni}` : te.key, old = this.tiles.get(id);
        if (old?.key === key) { this.stats.reused++; continue; }
        if (relabelled && performance.now() - t0 > budgetMs) { this.ready = false; this.finishStats(t0, relabelled); return false; }
        this.dirty = true; relabelled++;
        if (uni === 1) { this.tiles.set(id, { key, n: 1, sizes: Int32Array.of(this.per * this.per), border: ALL, uniform: 1 }); this.stats.uniform++; continue; }
        if (uni === 2) { this.tiles.set(id, { key, n: 0, sizes: new Int32Array(0), border: NONE, uniform: 2 }); this.stats.uniform++; continue; }
        // (keep = false: a tile the engine's windows do not hold is built for its labels without evicting theirs)
        const ft = g.fineTile(tx, tz, te.rel, te.key, false), per = this.per;
        const { labels, n, sizes } = labelComponents(ft.clearance, per, per, this.t);
        const border = new Int32Array(4 * per);
        for (let i = 0; i < per; i++) { border[i] = labels[i]; border[per + i] = labels[(per - 1) * per + i]; border[2 * per + i] = labels[i * per]; border[3 * per + i] = labels[i * per + per - 1]; }
        this.tiles.set(id, { key, n, sizes: Int32Array.from(sizes), border, uniform: 0 });
        this.lru.set(key, { labels, clearance: ft.clearance }); this.trimLru();
      }
      for (const id of [...this.tiles.keys()]) if (!seen.has(id)) { this.tiles.delete(id); this.dirty = true; }
      const ver = `${g.field.id}|${sp.baseId}|${sp.epoch}`;
      if (this.dirty || this.version === '') { this.join(); this.dirty = false; }
      this.version = ver;
    }
    // the stairs graph: rebuilt when the static world moved (an upper-floor edit leaves level 0 alone but moves the epoch)
    const gv = `${this.version}|${sp.epoch}|${this.main}|${this.parent.length}`;
    if (gv !== this.graphVer || relabelled) { this.graph(); this.graphVer = gv; }
    this.ready = true;
    this.finishStats(t0, relabelled);
    return true;
  }
  private finishStats(t0: number, relabelled: number) {
    this.stats.updates++; this.stats.relabelled += relabelled; this.stats.lastRelabelled = relabelled; this.stats.lastMs = performance.now() - t0;
  }

  private trimLru() { while (this.lru.size > 8) this.lru.delete(this.lru.keys().next().value!); }

  /** Union the tiles' components across seams; find the main component. */
  private join() {
    let total = 0;
    this.base.clear();
    for (const [id, t] of this.tiles) { this.base.set(id, total); total += t.n; }
    const parent = this.parent = new Int32Array(total);
    for (let i = 0; i < total; i++) parent[i] = i;
    const per = this.per, [x0, z0, x1, z1] = this.ext;
    const edge = (t: TileLabels, side: 0 | 1 | 2 | 3, k: number) => (t.uniform === 1 ? 0 : t.uniform === 2 ? -1 : t.border[side * per + k]);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      const a = this.tiles.get(`${tx},${tz}`)!; if (!a.n) continue;
      const ba = this.base.get(`${tx},${tz}`)!;
      if (tx < x1) { const b = this.tiles.get(`${tx + 1},${tz}`)!; if (b.n) { const bb = this.base.get(`${tx + 1},${tz}`)!; this.seam(a, b, ba, bb, 3, 2, edge); } }
      if (tz < z1) { const b = this.tiles.get(`${tx},${tz + 1}`)!; if (b.n) { const bb = this.base.get(`${tx},${tz + 1}`)!; this.seam(a, b, ba, bb, 1, 0, edge); } }
    }
    this.rootSize.clear();
    for (const [id, t] of this.tiles) { const b = this.base.get(id)!; for (let k = 0; k < t.n; k++) { const r = this.find(b + k); this.rootSize.set(r, (this.rootSize.get(r) ?? 0) + t.sizes[k]); } }
    this.findMain();
  }
  private seam(a: TileLabels, b: TileLabels, ba: number, bb: number, sa: 0 | 1 | 2 | 3, sb: 0 | 1 | 2 | 3, edge: (t: TileLabels, s: 0 | 1 | 2 | 3, k: number) => number) {
    if (a.uniform === 1 && b.uniform === 1) { this.union(ba, bb); return; }
    for (let k = 0; k < this.per; k++) { const la = edge(a, sa, k), lb = edge(b, sb, k); if (la >= 0 && lb >= 0) this.union(ba + la, bb + lb); }
  }
  private find(i: number): number { const p = this.parent; while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; }
  private union(a: number, b: number) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) { if (ra < rb) this.parent[rb] = ra; else this.parent[ra] = rb; } }

  private findMain() {
    this.main = -1;
    for (const a of this.anchors()) { const c = this.snap(a, 3); if (c) { this.main = c.root; return; } }
    let best = -1, size = -1;
    for (const [r, s] of this.rootSize) if (s > size || (s === size && r < best)) { best = r; size = s; }
    this.main = best;
  }

  /** The component root and clearance of the level-0 lattice cell (I, J), or root -1 when it is not passable. */
  private cellAt(I: number, J: number): { root: number; clear: number } {
    const v = this.cellLocal(I, J);
    return { root: v.label < 0 ? -1 : this.find(v.b + v.label), clear: v.clear };
  }
  /** The level-0 cell (I, J) as its tile's own label (b: the tile's base in the union-find; flat worlds: tile ''). */
  private cellLocal(I: number, J: number): { tile: string; b: number; label: number; clear: number } {
    const OFF = { tile: '', b: 0, label: -1, clear: 0 };
    if (this.flat) {
      const g = this.flat.g, i = I - g.ox, j = J - g.oz;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return OFF;
      const k = j * g.nx + i;
      return { tile: '', b: 0, label: this.flat.labels[k], clear: g.clearance[k] };
    }
    const per = this.per; if (!per) return OFF;
    const tx = Math.floor(I / per), tz = Math.floor(J / per), id = `${tx},${tz}`, t = this.tiles.get(id);
    if (!t || t.uniform === 2) return OFF;
    const b = this.base.get(id)!;
    if (t.uniform === 1) return { tile: id, b, label: 0, clear: 9 };
    let hit = this.lru.get(t.key);
    if (!hit) {
      const g = this.spatial.ground!, te = g.tileEntry(tx, tz, this.spatial.scene.obstacles);
      if (te.key !== t.key) return OFF;   // the world changed since update(): unlabelled
      const ft = g.fineTile(tx, tz, te.rel, te.key, false);
      hit = { labels: labelComponents(ft.clearance, per, per, this.t).labels, clearance: ft.clearance };
      this.lru.set(t.key, hit); this.trimLru();
    } else { this.lru.delete(t.key); this.lru.set(t.key, hit); }
    const k = (J - tz * per) * per + (I - tx * per);
    return { tile: id, b, label: hit.labels[k], clear: hit.clearance[k] };
  }

  private get cell(): number { return this.flat?.g.cell ?? this.spatial.ground?.cell ?? this.spatial.cell; }

  /** The nearest passable level-0 cell within `tol` m of p (as the planner snaps a start or goal): its root and centre. */
  snap(p: Vec2, tol = 0.35): { root: number; at: Vec2 } | null {
    const c = this.cell, I = latticeIndex(p[0], c), J = latticeIndex(p[1], c), R = Math.ceil(tol / c);
    let best: { root: number; at: Vec2 } | null = null, bd = Infinity;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const x = latticeCentre(I + di, c), z = latticeCentre(J + dj, c), d = hypot(x - p[0], z - p[1]);
      if (d > tol + 1e-9 || d >= bd) continue;
      const v = this.cellAt(I + di, J + dj); if (v.root < 0) continue;
      best = { root: v.root, at: [x, z] }; bd = d;
    }
    return best;
  }
  /** The level-0 component root at p (snapped within tol), -1 when no passable cell is that close. */
  rootAt(p: Vec2, tol = 0.35): number { return this.snap(p, tol)?.root ?? -1; }
  /** Whether a level-0 component is joined to the main area both ways (the main area itself, or through stairs). */
  connectedRoot(root: number): boolean { return root >= 0 && this.good.has(`0:${root}`); }
  /** Area (m²) of a level-0 component. */
  areaOf(root: number): number { return Math.round((this.rootSize.get(root) ?? 0) * this.cell * this.cell * 10) / 10; }
  /** Components and the main one's area, for reports. */
  summary(): { components: number; mainArea: number; tiles: number; clusters: number; connected: number } {
    return { components: this.rootSize.size, mainArea: this.areaOf(this.main), tiles: this.tiles.size || (this.flat ? 1 : 0), clusters: this.clusters.length, connected: this.good.size };
  }

  /**
   * A level-0 grid patch (the planner's cells: the engine's fine tiles) round p, half-size `half` m, with each cell's
   * component root: what the link test reads at a stair's foot. Flat worlds: the level-0 grid itself.
   */
  private patch0(p: Vec2, half: number): { g: LevelGrid; node: (c: number) => string | null; ref: (c: number) => string | null } | null {
    if (this.flat) { const f = this.flat; return { g: f.g, node: (c) => (f.labels[c] < 0 ? null : `0:${this.find(f.labels[c])}`), ref: () => null }; }
    const c = this.cell, I0 = latticeIndex(p[0] - half, c), J0 = latticeIndex(p[1] - half, c), nx = latticeIndex(p[0] + half, c) - I0 + 1, nz = latticeIndex(p[1] + half, c) - J0 + 1;
    const clearance = new Float32Array(nx * nz), cells: { tile: string; b: number; label: number }[] = new Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const v = this.cellLocal(I0 + i, J0 + j); clearance[j * nx + i] = v.clear; cells[j * nx + i] = v; }
    const g: LevelGrid = { level: 0, y: 0, cell: c, nx, nz, ox: I0, oz: J0, x0: I0 * c, z0: J0 * c, free: new Uint8Array(0), clearance, blockers: new Map() };
    return { g, node: (k) => (cells[k].label < 0 ? null : `0:${this.find(cells[k].b + cells[k].label)}`), ref: (k) => (cells[k].label < 0 ? null : `T${cells[k].tile}#${cells[k].label}`) };
  }
  /** What a level-0 patch round p (half-size `half`) reads: the content keys of the tiles under it (ground worlds). */
  private patch0Key(p: Vec2, half: number): string {
    const c = this.cell, per = this.per;
    const tx0 = Math.floor(latticeIndex(p[0] - half, c) / per), tx1 = Math.floor(latticeIndex(p[0] + half, c) / per);
    const tz0 = Math.floor(latticeIndex(p[1] - half, c) / per), tz1 = Math.floor(latticeIndex(p[1] + half, c) / per);
    let k = '';
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) k += `${tx},${tz}=${this.tiles.get(`${tx},${tz}`)?.key ?? '-'};`;
    return k;
  }
  /** A memoised node ref back to a node id: level-0 refs are tile-local ("T<tile>#<label>"), upper ones content-keyed already. */
  private resolve(ref: string): string | null {
    if (ref[0] !== 'T') return ref;
    const h = ref.indexOf('#'), b = this.base.get(ref.slice(1, h));
    return b === undefined ? null : `0:${this.find(b + Number(ref.slice(h + 1)))}`;
  }

  /** The upper-level grid holding p (a building's floor; flat worlds: the level grid) and its component node ids. */
  private upperAt(level: number, p: Vec2, tol: number): { g: LevelGrid; node: (c: number) => string | null; floor?: string; ck: string } | null {
    const sp = this.spatial;
    if (!sp.ground) {
      const g = sp.grids.levels.get(level); if (!g) return null;
      let labels = this.flatUpper.get(g);
      if (!labels) { labels = labelComponents(g.clearance, g.nx, g.nz, this.t).labels; this.flatUpper.set(g, labels); }
      const L = labels;
      return { g, node: (c) => (L[c] < 0 ? null : `f${level}:${L[c]}`), ck: '' };
    }
    let fallback: { g: LevelGrid; node: (c: number) => string | null; floor?: string; ck: string } | null = null;
    for (let ci = 0; ci < this.clusters.length; ci++) {
      const cl = this.clusters[ci], b = cl.box;
      if (p[0] < b[0] - tol || p[0] > b[2] + tol || p[1] < b[1] - tol || p[1] > b[3] + tol) continue;
      const lv = cl.levels.get(level); if (!lv) continue;
      const L = lv.labels, hit = { g: lv.g, node: (c: number) => (L[c] < 0 ? null : `u${cl.key}:${level}:${L[c]}`), floor: cl.members.find((s) => s.level === level)?.id, ck: `${cl.key}:${level}` };
      if (snapCell(lv.g, p, this.t, tol) >= 0) return hit;
      fallback ??= hit;
    }
    return fallback;
  }

  /** Cluster the upper surfaces into buildings and (re)build the grids of those whose content changed. */
  private buildClusters() {
    const sp = this.spatial, scene = sp.scene, cell = this.cell;
    const ups = scene.surfaces.filter((s) => s.level !== 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const boxes = ups.map((s) => aabb(s.obb, CLUSTER_GAP / 2));
    const par = ups.map((_, i) => i), f = (i: number): number => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const order = ups.map((_, i) => i).sort((a, b) => boxes[a][0] - boxes[b][0]);
    for (let x = 0; x < order.length; x++) {
      const a = boxes[order[x]];
      for (let y = x + 1; y < order.length; y++) {
        const b = boxes[order[y]]; if (b[0] > a[2]) break;
        if (b[1] <= a[3] && b[3] >= a[1]) { const ra = f(order[x]), rb = f(order[y]); if (ra !== rb) par[Math.max(ra, rb)] = Math.min(ra, rb); }
      }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < ups.length; i++) { const r = f(i); const g = groups.get(r); if (g) g.push(i); else groups.set(r, [i]); }
    const obs = scene.obstacles, ob = boxesOf(obs), out: Cluster[] = [], memo = new Map<string, Cluster>();
    for (const idx of groups.values()) {
      const members = idx.map((i) => ups[i]);
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const i of idx) { const b = aabb(ups[i].obb, CLUSTER_GAP); box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]); }
      const inBox = [];
      for (let k = 0; k < obs.length; k++) if (ob[4 * k + 2] >= box[0] && ob[4 * k] <= box[2] && ob[4 * k + 3] >= box[1] && ob[4 * k + 1] <= box[3]) inBox.push(obs[k]);
      const ids = [...new Set(members.map((s) => s.level))].sort((a, b) => a - b);
      let h = fnv(`${cell}|${box.join(',')}`), h2 = 0x050c5d1f;
      const mix = (k: string) => { h = fnv(k, h); h2 = fnv(k, h2 ^ 0x9e3779b9); };
      for (const s of members) mix(`s${s.id}|${s.level}|${s.y}|${s.obb.c}|${s.obb.half}|${s.obb.yaw}`);
      for (const l of scene.levels) if (ids.includes(l.id)) mix(`l${l.id}|${l.y}`);
      for (const o of inBox) mix(`o${o.id}|${o.obb.c}|${o.obb.half}|${o.obb.yaw}|${o.y0},${o.y1}`);
      const key = `${h.toString(16)}${h2.toString(16)}`;
      let cl = this.clusterMemo.get(key) ?? memo.get(key);
      if (!cl) {
        this.stats.clusterBuilds++;
        const levels = new Map<number, { g: LevelGrid; labels: Int32Array }>();
        for (const id of ids) {
          const sub = { bounds: box, levels: scene.levels.filter((l) => l.id === id), surfaces: members.filter((s) => s.level === id), obstacles: inBox, links: [] };
          const g = buildGridsOverFloors(sub, cell).levels.get(id);
          if (g) levels.set(id, { g, labels: labelComponents(g.clearance, g.nx, g.nz, this.t).labels });
        }
        cl = { key, box, members, levels };
      }
      memo.set(key, cl); out.push(cl);
    }
    this.clusters = out; this.clusterMemo = memo; this.stats.clusters = out.length;
  }

  /** The stairs graph: components as nodes, the planner's link edges between them; then which are joined to main. */
  private graph() {
    const t0 = performance.now(), sp = this.spatial, r = this.t, radius = HUMAN_PROFILE.radius;
    if (sp.ground) this.buildClusters(); else this.clusters = [];
    this.stats.clusterMs = performance.now() - t0;
    const fwdAdj = new Map<string, string[]>(), bwdAdj = new Map<string, string[]>();
    const at = (level: number, p: Vec2, half: number) => (level === 0 ? this.patch0(p, half) : this.upperAt(level, p, half));
    let edges = 0;
    const tasks: { link: Link; ascending: boolean }[] = [];
    for (const link of sp.scene.links) if (link.usable && link.width >= 2 * r) tasks.push({ link, ascending: true }, { link, ascending: false });
    // tile by tile, as check
    const order = this.byTile(tasks.map((x) => linkApproach(x.link, x.ascending).approach));
    // each verdict memoised by what it reads: the link, and the tiles (level 0) or the floor cluster (upper) at both feet;
    // a level-0 foot's component is kept tile-local, so a far-away edit that renumbers the roots costs nothing here
    const memo = new Map<string, { a: string; b: string } | null>(), ground = !!sp.ground;
    for (const k of order) {
      const { link, ascending } = tasks[k];
      const { entry, approach, exit } = linkApproach(link, ascending), far = linkApproach(link, !ascending).approach;
      const he = hypot(entry.p[0] - approach[0], entry.p[1] - approach[1]) + 0.3;
      let mk = '';
      if (ground) {
        const side = (level: number, p: Vec2, half: number) => (level === 0 ? this.patch0Key(p, half) : this.upperAt(level, p, half)?.ck ?? '-');
        mk = `${link.id}|${ascending}|${JSON.stringify([link.from, link.to, link.heading, link.approach, link.width])}|${side(entry.level, approach, he)}|${side(exit.level, far, 0.6)}`;
        const was = this.linkMemo.get(mk);
        if (was !== undefined) {
          memo.set(mk, was); this.stats.linkHits++;
          const a = was && this.resolve(was.a), b = was && this.resolve(was.b);
          if (!a || !b || a === b) continue;
          edges++;
          (fwdAdj.get(a) ?? fwdAdj.set(a, []).get(a)!).push(b);
          (bwdAdj.get(b) ?? bwdAdj.set(b, []).get(b)!).push(a);
          continue;
        }
      }
      const ge = at(entry.level, approach, he), gx = at(exit.level, far, 0.6);
      if (!ge || !gx) { if (ground) memo.set(mk, null); continue; }
      const t = linkEdgeTest(link, ascending, ge.g, gx.g, r, radius);
      const ref = (side: typeof ge, c: number) => ('ref' in side ? side.ref(c) : side.node(c));
      if (ground) { const ra = t.ok ? ref(ge, t.ca) : null, rb = t.ok ? ref(gx, t.cx) : null; memo.set(mk, ra && rb ? { a: ra, b: rb } : null); }
      if (!t.ok) continue;
      const a = ge.node(t.ca), b = gx.node(t.cx);
      if (!a || !b || a === b) continue;
      edges++;
      (fwdAdj.get(a) ?? fwdAdj.set(a, []).get(a)!).push(b);
      (bwdAdj.get(b) ?? bwdAdj.set(b, []).get(b)!).push(a);
    }
    const reach = (adj: Map<string, string[]>, from: string) => {
      const seen = new Set<string>([from]), q = [from];
      while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
      return seen;
    };
    this.good = new Set();
    if (this.main >= 0) {
      const m = `0:${this.main}`;
      this.fwd = reach(fwdAdj, m); this.bwd = reach(bwdAdj, m);
      for (const n of this.fwd) if (this.bwd.has(n)) this.good.add(n);
    } else { this.fwd = new Set(); this.bwd = new Set(); }
    this.linkMemo = memo;
    this.stats.links = tasks.length / 2; this.stats.edges = edges; this.stats.graphMs = performance.now() - t0;
  }

  /**
   * The nearest point of the main area to p with room to stand (clearance >= minClear), searched in square rings of cells
   * out to maxR m; ties go to the nearer cell centre, then the lower lattice index (deterministic). Null when none.
   */
  nearestMain(p: Vec2, maxR = 40, minClear = RESCUE_CLEAR, avoid: (q: Vec2) => boolean = () => false): Vec2 | null {
    if (this.main < 0) return null;
    const c = this.cell, I = latticeIndex(p[0], c), J = latticeIndex(p[1], c), R = Math.ceil(maxR / c);
    let best: Vec2 | null = null, bd = Infinity;
    for (let r = 0; r <= R; r++) {
      if (best && (r - 1) * c > bd) break;   // every cell of this ring is farther than the best found
      for (let dj = -r; dj <= r; dj++) {
        const edgeRow = dj === -r || dj === r;
        for (let di = -r; di <= r; di += edgeRow ? 1 : 2 * r || 1) {
          const x = latticeCentre(I + di, c), z = latticeCentre(J + dj, c), d = hypot(x - p[0], z - p[1]);
          if (d >= bd || d > maxR) continue;
          const v = this.cellAt(I + di, J + dj);
          if (v.clear < minClear || !this.connectedRoot(v.root) || avoid([x, z])) continue;
          best = [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]; bd = d;
        }
      }
    }
    return best;
  }

  /** Verdicts for standing points, one per component (`area`): joined to the main area both ways, or not. */
  check(points: ConnPoint[]): ConnVerdict[] {
    // tile by tile (a tile's full labels are rebuilt when they have left the small LRU), answers in the callers' order
    const out = new Array<ConnVerdict>(points.length);
    for (const k of this.byTile(points.map((q) => q.p))) out[k] = this.verdict(points[k]);
    return out;
  }
  /** Indices of points ordered by the 64 m tile they lie in (stable). */
  private byTile(ps: Vec2[]): number[] {
    const key = (p: Vec2) => Math.floor(p[0] / GROUND_TILE_M) * 100003 + Math.floor(p[1] / GROUND_TILE_M);
    return ps.map((_, i) => i).sort((a, b) => key(ps[a]) - key(ps[b]) || a - b);
  }
  private verdict({ id, p, level = 0, tol = 0.35 }: ConnPoint): ConnVerdict {
    let node: string | null = null, pocket: number | undefined, floor: string | undefined;
    if (level === 0) {
      const s = this.snap(p, tol);
      if (s) { node = `0:${s.root}`; pocket = this.areaOf(s.root); }
    } else {
      const u = this.upperAt(level, p, tol), c = u ? snapCell(u.g, p, this.t, tol) : -1;
      if (u && c >= 0) { node = u.node(c); floor = u.floor; }
    }
    if (!node) return { id, level, ok: false, code: 'nav.no-standing-room' };
    if (this.good.has(node)) return { id, level, ok: true, area: node };
    const code = this.fwd.has(node) || this.bwd.has(node) ? 'nav.one-way' : 'nav.disconnected';
    return { id, level, ok: false, code, area: node, ...(level === 0 ? { pocket } : { floor }) };
  }
}
