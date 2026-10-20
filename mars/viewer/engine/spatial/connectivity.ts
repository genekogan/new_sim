// Connectivity audit (lane NAV, tranche 2026-10-20). Gene: "pathfinding should be 100% reliable. we cant have world's
// accidentally making souls or other things immobile." A god-placed cottage on bench-hamlet was sealed off from
// everywhere (its door too tight at that yaw, a steep foundation bank in front of it): Souls were offered `walk:cottage`
// and every walk refused route.unreachable.
//
// This answers, for any standing point, "is it connected to the world's main walkable area?" — the same question the
// route planner (path.ts) answers for one pair of points, for the whole world at once:
//
//  - Level 0 is labelled into connected components of the planner's own passable cells (clearance >= body radius +
//    PLAN_MARGIN; the planner never cuts corners, so 4-connected labelling is exactly its reachability on one level).
//  - Ground worlds (tiled.ts): each 64 m tile is labelled on its own (the engine's fine tile, built once per content key),
//    tiles whose ground is all plain walkable ground with nothing on it are one component without building anything,
//    and components are joined across tile seams. Only tiles whose content key changed are relabelled, so the check
//    after a god edit costs the edited tiles, not the world.
//  - Flat worlds (Mars, old Eden, Little Martians): the level-0 grid is labelled whole when the navigation epoch moves.
//  - The main area is the component holding the world's arrival point (else the largest).
//  - Anything the labels cannot settle — a level-0 point outside the main component (it might be joined through an upper
//    floor's stairs), or a point on an upper floor — is settled by the planner itself, routing to the nearest point of
//    the main area. So the verdict is never more optimistic than a real walk.
//
// Pure derived data over the planner's grids: nothing here is logged, and nothing changes the world.
import type { Vec2 } from '../core/math.ts';
import { latticeIndex, latticeCentre, type LevelGrid } from './grid.ts';
import { GROUND_TILE_M, G_OUTSIDE, G_STEEP, G_WALK, type GroundField } from './ground.ts';
import { PLAN_MARGIN } from './path.ts';
import type { Spatial } from './service.ts';
import { HUMAN_PROFILE } from './types.ts';

/** Policy id of the audit's rules (what counts as connected, what a rescue picks): bump when they change. */
export const NAV_CONNECT_POLICY = 'nav-connect/1';
/** The planner's passable test for the default body (path.ts prepare: radius + PLAN_MARGIN). */
export const CONNECT_CLEAR = HUMAN_PROFILE.radius + PLAN_MARGIN;
/** Clearance a rescue spot keeps (m): room to stand and turn, not a cell squeezed between two walls. */
export const RESCUE_CLEAR = CONNECT_CLEAR + 0.16;

/** One labelled tile: components, their sizes (cells), and the labels of its four edges (-1 = not passable).
 *  border: [0, per) the first row (j = 0), [per, 2per) the last row, [2per, 3per) the first column, [3per, 4per) the last. */
type TileLabels = { key: string; n: number; sizes: Int32Array; border: Int32Array; uniform: 0 | 1 | 2 };

export type ConnPoint = { id: string; p: Vec2; level?: number; tol?: number };
export type ConnVerdict = {
  id: string; level: number; ok: boolean;
  /** How it was settled: the labels alone, or the planner (upper floors; joined only through other levels). */
  via: 'grid' | 'planner';
  /** nav.no-standing-room: no passable cell within `tol`; nav.disconnected: standing room, but no walk joins it to the
   *  main area. */
  code?: 'nav.no-standing-room' | 'nav.disconnected';
  /** The pocket's area (m², level 0), when disconnected. */
  pocket?: number;
};
export type RouteProbe = (from: { p: Vec2; level: number }, to: { p: Vec2; level: number }) => boolean;

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

/**
 * Level-0 connectivity of one Spatial service. `update(world)` after a sync relabels what changed; `rootAt` / `check` /
 * `nearestMain` read the labels. Holds per tile only its edge labels (~10 kB); full label rasters of a few recently read
 * tiles are kept in a small LRU and rebuilt (from the engine's fine tile) when read again.
 */
export class NavConnectivity {
  readonly spatial: Spatial;
  readonly t: number;
  private anchors: () => Vec2[];
  /** Ground: per tile "tx,tz" its labels; flat: the one entry "flat". */
  private tiles = new Map<string, TileLabels>();
  private ext: [number, number, number, number] = [0, 0, -1, -1];
  private per = 0;
  private flat: { g: LevelGrid; labels: Int32Array; key: string } | null = null;
  private parent = new Int32Array(0);
  private base = new Map<string, number>();
  private rootSize = new Map<number, number>();
  private lru = new Map<string, { labels: Int32Array; clearance: Float32Array }>();
  private mediaMemo = new Map<string, 0 | 1 | 2>();
  /** The main component's root (-1: no walkable ground at all). */
  main = -1;
  /** What the labels were last built from (changes exactly when the level-0 static world does). */
  version = '';
  stats = { updates: 0, relabelled: 0, reused: 0, uniform: 0, lastMs: 0, lastRelabelled: 0 };

  constructor(spatial: Spatial, opts: { anchors: () => Vec2[]; clear?: number }) {
    this.spatial = spatial; this.anchors = opts.anchors; this.t = opts.clear ?? CONNECT_CLEAR;
  }

  /** Relabel what changed since the last update (call after spatial.sync(world)). Returns the tiles relabelled. */
  update(): number {
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
      let changed = false;
      for (let tz = ext[1]; tz <= ext[3]; tz++) for (let tx = ext[0]; tx <= ext[2]; tx++) {
        const id = `${tx},${tz}`, te = g.tileEntry(tx, tz, obstacles);
        seen.add(id);
        let uni: 0 | 1 | 2 = 0;
        if (!te.rel.length) { const mk = `${g.field.id}|${id}`; uni = this.mediaMemo.get(mk) ?? 0; if (!this.mediaMemo.has(mk)) { uni = mediaClass(g.field, tx, tz); this.mediaMemo.set(mk, uni); } }
        const key = uni ? `${g.field.id}|u${uni}` : te.key, old = this.tiles.get(id);
        if (old?.key === key) { this.stats.reused++; continue; }
        changed = true; relabelled++;
        if (uni === 1) { this.tiles.set(id, { key, n: 1, sizes: Int32Array.of(this.per * this.per), border: ALL, uniform: 1 }); this.stats.uniform++; continue; }
        if (uni === 2) { this.tiles.set(id, { key, n: 0, sizes: new Int32Array(0), border: NONE, uniform: 2 }); this.stats.uniform++; continue; }
        const ft = g.fineTile(tx, tz, te.rel, te.key), per = this.per;
        const { labels, n, sizes } = labelComponents(ft.clearance, per, per, this.t);
        const border = new Int32Array(4 * per);
        for (let i = 0; i < per; i++) { border[i] = labels[i]; border[per + i] = labels[(per - 1) * per + i]; border[2 * per + i] = labels[i * per]; border[3 * per + i] = labels[i * per + per - 1]; }
        this.tiles.set(id, { key, n, sizes: Int32Array.from(sizes), border, uniform: 0 });
        this.lru.set(key, { labels, clearance: ft.clearance }); this.trimLru();
      }
      for (const id of [...this.tiles.keys()]) if (!seen.has(id)) { this.tiles.delete(id); changed = true; }
      const ver = `${g.field.id}|${sp.baseId}|${sp.epoch}`;
      if (changed || this.version === '') this.join();
      this.version = ver;
    }
    this.stats.updates++; this.stats.relabelled += relabelled; this.stats.lastRelabelled = relabelled; this.stats.lastMs = performance.now() - t0;
    return relabelled;
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

  /** The component root and clearance of the lattice cell (I, J), or root -1 when it is not passable. */
  private cellAt(I: number, J: number): { root: number; clear: number } {
    if (this.flat) {
      const g = this.flat.g, i = I - g.ox, j = J - g.oz;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return { root: -1, clear: 0 };
      const k = j * g.nx + i, l = this.flat.labels[k];
      return { root: l < 0 ? -1 : this.find(l), clear: g.clearance[k] };
    }
    const per = this.per; if (!per) return { root: -1, clear: 0 };
    const tx = Math.floor(I / per), tz = Math.floor(J / per), id = `${tx},${tz}`, t = this.tiles.get(id);
    if (!t || !t.n) return { root: -1, clear: 0 };
    const b = this.base.get(id)!;
    if (t.uniform === 1) return { root: this.find(b), clear: 9 };
    let hit = this.lru.get(t.key);
    if (!hit) {
      const g = this.spatial.ground!, te = g.tileEntry(tx, tz, this.spatial.scene.obstacles);
      if (te.key !== t.key) return { root: -1, clear: 0 };   // the world changed since update(): unlabelled
      const ft = g.fineTile(tx, tz, te.rel, te.key);
      hit = { labels: labelComponents(ft.clearance, per, per, this.t).labels, clearance: ft.clearance };
      this.lru.set(t.key, hit); this.trimLru();
    } else { this.lru.delete(t.key); this.lru.set(t.key, hit); }
    const k = (J - tz * per) * per + (I - tx * per), l = hit.labels[k];
    return { root: l < 0 ? -1 : this.find(b + l), clear: hit.clearance[k] };
  }

  private get cell(): number { return this.flat?.g.cell ?? this.spatial.ground?.cell ?? this.spatial.cell; }

  /** The nearest passable cell within `tol` m of p (as the planner snaps a start or goal): its root and centre. */
  snap(p: Vec2, tol = 0.35): { root: number; at: Vec2 } | null {
    const c = this.cell, I = latticeIndex(p[0], c), J = latticeIndex(p[1], c), R = Math.ceil(tol / c);
    let best: { root: number; at: Vec2 } | null = null, bd = Infinity;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const x = latticeCentre(I + di, c), z = latticeCentre(J + dj, c), d = Math.hypot(x - p[0], z - p[1]);
      if (d > tol + 1e-9 || d >= bd) continue;
      const v = this.cellAt(I + di, J + dj); if (v.root < 0) continue;
      best = { root: v.root, at: [x, z] }; bd = d;
    }
    return best;
  }
  /** The component root at p (snapped within tol), -1 when no passable cell is that close. */
  rootAt(p: Vec2, tol = 0.35): number { return this.snap(p, tol)?.root ?? -1; }
  /** Area (m²) of a component. */
  areaOf(root: number): number { return Math.round((this.rootSize.get(root) ?? 0) * this.cell * this.cell * 10) / 10; }
  /** Components and the main one's share, for reports. */
  summary(): { components: number; mainArea: number; tiles: number } {
    return { components: this.rootSize.size, mainArea: this.areaOf(this.main), tiles: this.tiles.size || (this.flat ? 1 : 0) };
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
          const x = latticeCentre(I + di, c), z = latticeCentre(J + dj, c), d = Math.hypot(x - p[0], z - p[1]);
          if (d >= bd || d > maxR) continue;
          const v = this.cellAt(I + di, J + dj);
          if (v.root !== this.main || v.clear < minClear || avoid([x, z])) continue;
          best = [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]; bd = d;
        }
      }
    }
    return best;
  }

  /**
   * Verdicts for standing points. Level 0: the labels; a point outside the main component is re-checked by the planner
   * (`route`, to the nearest main point) before it is called disconnected. Upper floors: the planner, to the nearest main
   * point below. Without `route` an upper-floor point is reported unchecked as ok (via 'grid').
   */
  check(points: ConnPoint[], route?: RouteProbe): ConnVerdict[] {
    return points.map(({ id, p, level = 0, tol }) => {
      if (level === 0) {
        const s = this.snap(p, tol ?? 0.35);
        if (!s) return { id, level, ok: false, via: 'grid', code: 'nav.no-standing-room' } as ConnVerdict;
        if (s.root === this.main) return { id, level, ok: true, via: 'grid' } as ConnVerdict;
        const q = route ? this.nearestMain(p, 60, CONNECT_CLEAR + 0.02) : null;
        if (q && route!({ p: s.at, level: 0 }, { p: q, level: 0 })) return { id, level, ok: true, via: 'planner' } as ConnVerdict;
        return { id, level, ok: false, via: route ? 'planner' : 'grid', code: 'nav.disconnected', pocket: this.areaOf(s.root) } as ConnVerdict;
      }
      if (!route) return { id, level, ok: true, via: 'grid' } as ConnVerdict;
      const q = this.nearestMain(p, 60, CONNECT_CLEAR + 0.02);
      const ok = !!q && route({ p, level }, { p: q, level: 0 });
      return ok ? { id, level, ok: true, via: 'planner' } as ConnVerdict : { id, level, ok: false, via: 'planner', code: 'nav.disconnected' } as ConnVerdict;
    });
  }
}
