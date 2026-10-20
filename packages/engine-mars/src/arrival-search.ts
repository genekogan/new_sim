// arrival-search/1 (lane ARR, 2026-10-20). Where a new Soul stands when the world's arrival point cannot take it: built
// over (bench-hamlet's giant telescope on (0,0)), crowded, under water, too steep, or walled in by buildings.
//
// Pure reads over the level-0 standing geometry the engine already has (clearance of a body's disc, ground media, the
// bodies standing there). Nothing here moves, reserves or logs anything: the server puts the spot it returns into the
// birth as a birth-near/1 hint {at, first:true}, so the birth event carries the exact place and replay never searches.
//
// - Candidates: every 0.25 m lattice point within 16 m of the arrival point, nearest first; beyond that, rings whose
//   spacing grows with the distance (0.5 m at 16 m, 4 m from 128 m) out to the farthest corner of the world's bounds.
// - A candidate is a standing spot when a body's disc is clear of solids there, the ground is walkable or wadeable (not
//   deep water, steep or outside the world) and nobody stands within 0.8 m.
// - It must also lie in the world's open walkable area, never in a sealed pocket (a walled courtyard, a ring of
//   buildings): a flood over the 0.25 m lattice of points with a clear disc (water counts: bodies swim) must reach 30 m
//   from it or cover 7,500 m². Two lattice neighbours 0.25 m apart that both clear a 0.28 m disc have no solid between
//   them, so the flood never leaks through a wall. Each sealed pocket is flooded once, then skipped.
// - When no candidate is open (a small or fully enclosed world) the nearest spot of the largest pocket is used.
// - null only when the world has no standing ground at all.
type Vec2 = [number, number];

export const ARRIVAL_LATTICE_M = 0.25, ARRIVAL_FINE_M = 16, ARRIVAL_ESCAPE_M = 30, ARRIVAL_POCKET_CAP = 120_000, ARRIVAL_PERSON_M = 0.8;

export type ArrivalGround = {
  /** Clearance (m) of the level-0 standing disc at q (0 off the world's grids). Callers may cap it at `radius`. */
  clear(q: Vec2): number;
  /** Ground medium at q: 0 walk, 1 wade, 2 swim, 3 steep, 4 outside. Worlds without ground: always 0. */
  medium(q: Vec2): number;
  bounds: readonly [number, number, number, number];
  /** Bodies standing on level 0 (x, z). */
  people: readonly Vec2[];
  radius: number;
  cos(a: number): number; sin(a: number): number;
};
export type ArrivalPocket = { open: boolean; size: number };
export type ArrivalSpot = { at: Vec2; open: boolean; size: number; distance: number; checked: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const S = ARRIVAL_LATTICE_M, OFF = 1 << 20, SPAN = 1 << 21;
const key = (i: number, j: number) => (i + OFF) * SPAN + (j + OFF);

/** One search's view of the lattice anchored at `o` (lattice point (i, j) is o + (i, j) × 0.25 m). */
class Lattice {
  private passCache = new Map<number, boolean>();
  constructor(readonly g: ArrivalGround, readonly o: Vec2) {}
  at(i: number, j: number): Vec2 { return [r3(this.o[0] + i * S), r3(this.o[1] + j * S)]; }
  private inside(q: Vec2) { const [x0, z0, x1, z1] = this.g.bounds; return q[0] > x0 && q[0] < x1 && q[1] > z0 && q[1] < z1; }
  /** A body's disc is clear here and the ground is walkable, wadeable or swimmable: a flood may pass. */
  passable(i: number, j: number): boolean {
    const k = key(i, j), hit = this.passCache.get(k); if (hit !== undefined) return hit;
    const q = this.at(i, j), ok = this.inside(q) && this.g.clear(q) >= this.g.radius && this.g.medium(q) <= 2;
    this.passCache.set(k, ok); return ok;
  }
  /** Passable, not deep water, and nobody within 0.8 m: a body may be born here. */
  standable(i: number, j: number): boolean {
    if (!this.passable(i, j)) return false;
    const q = this.at(i, j); if (this.g.medium(q) > 1) return false;
    return !this.g.people.some(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < ARRIVAL_PERSON_M);
  }
  /** Flood from (i, j): open when it reaches 30 m away or the cap; else the pocket's cells. */
  pocket(si: number, sj: number): { open: true; size: number } | { open: false; cells: number[] } {
    if (!this.passable(si, sj)) return { open: false, cells: [] };
    const reach2 = (ARRIVAL_ESCAPE_M / S) ** 2, seen = new Set<number>([key(si, sj)]), qi = [si], qj = [sj];
    for (let h = 0; h < qi.length; h++) {
      const i = qi[h], j = qj[h];
      if ((i - si) ** 2 + (j - sj) ** 2 >= reach2 || seen.size >= ARRIVAL_POCKET_CAP) return { open: true, size: seen.size };
      for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) {
        const k = key(ni, nj); if (seen.has(k) || !this.passable(ni, nj)) continue;
        seen.add(k); qi.push(ni); qj.push(nj);
      }
    }
    return { open: false, cells: [...seen] };
  }
}

/** Is `at` in the open walkable area (see the header), and how big is its pocket when it is not? */
export function arrivalPocket(g: ArrivalGround, at: Vec2): ArrivalPocket {
  const p = new Lattice(g, at).pocket(0, 0);
  return p.open ? { open: true, size: p.size } : { open: false, size: p.cells.length };
}

/** The nearest standing spot to `from` in the open walkable area (see the header); null when the world has none at all. */
export function searchArrival(g: ArrivalGround, from: Vec2): ArrivalSpot | null {
  const L = new Lattice(g, from), tried = new Set<number>(), pocketOf = new Map<number, number>();
  const pockets: { size: number; first: [number, number] }[] = [];
  let checked = 0;
  const done = (i: number, j: number, open: boolean, size: number): ArrivalSpot => {
    const at = L.at(i, j); return { at, open, size, distance: r3(Math.hypot(at[0] - from[0], at[1] - from[1])), checked };
  };
  const visit = (i: number, j: number): ArrivalSpot | null => {
    const k = key(i, j); if (tried.has(k)) return null; tried.add(k); checked++;
    if (!L.standable(i, j) || pocketOf.has(k)) return null;
    const p = L.pocket(i, j);
    if (p.open) return done(i, j, true, p.size);
    const id = pockets.length; pockets.push({ size: p.cells.length, first: [i, j] });
    for (const c of p.cells) pocketOf.set(c, id);
    return null;
  };
  // Within 16 m: every lattice point, nearest first.
  const n = Math.round(ARRIVAL_FINE_M / S), fine: [number, number, number][] = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const d = i * i + j * j; if (d <= n * n) fine.push([d, i, j]); }
  fine.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, i, j] of fine) { const hit = visit(i, j); if (hit) return hit; }
  // Beyond: rings out to the farthest corner of the world.
  const [x0, z0, x1, z1] = g.bounds;
  const far = Math.max(...[[x0, z0], [x0, z1], [x1, z0], [x1, z1]].map(([x, z]) => Math.hypot(x - from[0], z - from[1])));
  for (let rho = ARRIVAL_FINE_M + .5; rho <= far; rho += Math.min(4, Math.max(.5, rho / 32))) {
    const step = Math.min(4, Math.max(.5, rho / 32)), count = Math.ceil(2 * Math.PI * rho / step);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2, hit = visit(Math.round(rho * g.cos(a) / S), Math.round(rho * g.sin(a) / S));
      if (hit) return hit;
    }
  }
  // No open area anywhere: the nearest spot of the largest pocket (the first one found wins a tie: it is nearer).
  let best = -1; for (let id = 0; id < pockets.length; id++) if (best < 0 || pockets[id].size > pockets[best].size) best = id;
  return best < 0 ? null : done(pockets[best].first[0], pockets[best].first[1], false, pockets[best].size);
}
