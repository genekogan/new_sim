// FROZEN reference copy of spatial/path.ts findRoute as of f46f658 (before the
// planning-budget work). Test-only: planning.test.ts asserts the production
// planner returns bit-identical routes. Do not edit or "improve" this file.
import { dist2, type Vec2, hypot } from '../core/math.ts';
import { cellOf, centreOf, nearestBlocker, segmentClearance, type GridSet, type LevelGrid } from '../spatial/grid.ts';
import type { AgentProfile, SpatialScene } from '../spatial/types.ts';
import { linkApproach, PLAN_MARGIN, type Leg, type LinkLeg, type Place, type RouteResult, type WalkLeg } from '../spatial/path.ts';

const SQ2 = Math.SQRT2;
const COMFORT = 0.9;
const WALL_PENALTY = 1.2;

type LinkEdge = { link: import('../spatial/types.ts').Link; ascending: boolean; toLevel: number; toCell: number; cost: number; approach: Vec2 };

export function findRouteReference(
  grids: GridSet,
  scene: SpatialScene,
  profile: AgentProfile,
  start: Place,
  goal: Place,
  opts: { goalTolerance?: number; allowUnusableLinks?: boolean; maxExpand?: number } = {},
): RouteResult {
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

  const total = lvIds.length * N;
  const gScore = new Float64Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const viaLink = new Map<number, LinkEdge>();
  const closed = new Uint8Array(total);
  const heap = new Heap();
  const startId = idxOf.get(start.level)! * N + s, goalId = idxOf.get(goal.level)! * N + gt;
  const goalC = centreOf(gg, gt);
  const h = (lv: number, c: number) => {
    const g = grids.levels.get(lvIds[lv])!;
    const p = centreOf(g, c);
    const dx = Math.abs(p[0] - goalC[0]), dz = Math.abs(p[1] - goalC[1]);
    return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz);
  };
  gScore[startId] = 0;
  heap.push(startId, h(idxOf.get(start.level)!, s));
  let expanded = 0;
  const maxExpand = opts.maxExpand ?? 4_000_000;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalId) break;
    if (++expanded > maxExpand) return fail('route.search-limit', `route search exceeded ${maxExpand} expansions`);
    const lv = Math.floor(cur / N), c = cur - lv * N;
    const g = grids.levels.get(lvIds[lv])!;
    const ci = c % g.nx, cj = (c - ci) / g.nx;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
        const n = nj * g.nx + ni;
        if (!passable(g, n)) continue;
        if (di && dj && (!passable(g, cj * g.nx + ni) || !passable(g, nj * g.nx + ci))) continue; // no corner cutting
        const cl = g.clearance[n];
        const w = 1 + (cl < COMFORT ? (WALL_PENALTY * (COMFORT - cl)) / COMFORT : 0);
        const nid = lv * N + n;
        const t = gScore[cur] + (di && dj ? SQ2 : 1) * g.cell * w;
        if (t < gScore[nid]) {
          gScore[nid] = t;
          came[nid] = cur;
          viaLink.delete(nid);
          heap.push(nid, t + h(lv, n));
        }
      }
    for (const e of edges.get(cur) ?? []) {
      const tl = idxOf.get(e.toLevel)!;
      const nid = tl * N + e.toCell;
      const t = gScore[cur] + e.cost;
      if (t < gScore[nid]) {
        gScore[nid] = t;
        came[nid] = cur;
        viaLink.set(nid, e);
        heap.push(nid, t + h(tl, e.toCell));
      }
    }
  }
  if (!closed[goalId]) {
    if (!opts.allowUnusableLinks && scene.links.some((l) => !l.usable)) {
      const alt = findRouteReference(grids, scene, profile, start, goal, { ...opts, allowUnusableLinks: true });
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

  // reconstruct into legs
  const chain: number[] = [];
  for (let id = goalId; id !== -1; id = came[id]) chain.push(id);
  chain.reverse();
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

const pathLen = (p: [number, number, number][]) => p.slice(1).reduce((s, q, i) => s + hypot(q[0] - p[i][0], q[1] - p[i][1], q[2] - p[i][2]), 0);
const pathLen2 = (p: Vec2[]) => p.slice(1).reduce((s, q, i) => s + dist2(q, p[i]), 0);
const fmt = (p: Vec2) => `${p[0].toFixed(2)}, ${p[1].toFixed(2)}`;
const blk = (g: LevelGrid, p: Vec2) => {
  const b = nearestBlocker(g, p);
  return b ? ` (blocked by ${b})` : cellOf(g, p) >= 0 && !g.free[cellOf(g, p)] ? ' (no floor here)' : '';
};
function fail(code: string, message: string, at?: Place, subjects?: string[]): RouteResult {
  return { ok: false, diagnostic: { code, message, subjects, at: at ? [at.p[0], 0, at.p[1]] : undefined } };
}

/** Deterministic binary min-heap (ties broken by insertion order). */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  private o: number[] = [];
  private n = 0;
  size = 0;
  push(val: number, key: number) {
    let i = this.size++;
    this.k[i] = key; this.v[i] = val; this.o[i] = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(p, i)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.v[0];
    const last = --this.size;
    if (last > 0) {
      this.k[0] = this.k[last]; this.v[0] = this.v[last]; this.o[0] = this.o[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private less(a: number, b: number) {
    return this.k[a] < this.k[b] || (this.k[a] === this.k[b] && this.o[a] < this.o[b]);
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
    [this.o[a], this.o[b]] = [this.o[b], this.o[a]];
  }
}
