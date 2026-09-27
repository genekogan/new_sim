// Swept-formation collision checks against a level's clearance field.
// Conservative: every disc of the formation cover (load rectangle + carrier
// bodies) must have clearance ≥ disc radius + margin at every sample, and
// samples are spaced so no disc moves more than SAMPLE metres between them
// (margin ≥ SAMPLE/2 then covers the motion between samples).
import { angleDelta, type Vec2 } from '../core/math.ts';
import type { LevelGrid } from '../spatial/grid.ts';
import type { Formation, SE2 } from './formation.ts';

/** Max displacement of any formation point between two checked samples (m). */
export const SAMPLE = 0.08;
/** Planning margin beyond disc radius: half the sample spacing + raster/EDT error allowance. */
export const PLAN_MARGIN = SAMPLE / 2 + 0.02;

export type Motion =
  | { kind: 'line'; a: SE2; b: SE2 } // translate + rotate uniformly (in-place rotation when a.xz == b.xz)
  | { kind: 'arc'; a: SE2; R: number; dth: number }; // constant-curvature arc, forward

export type Hit = { disc: number; p: Vec2; q: SE2 };

export function motionAt(m: Motion, t: number): SE2 {
  if (m.kind === 'line') {
    const d = angleDelta(m.a.th, m.b.th);
    return { x: m.a.x + (m.b.x - m.a.x) * t, z: m.a.z + (m.b.z - m.a.z) * t, th: m.a.th + d * t };
  }
  const sg = m.dth >= 0 ? 1 : -1;
  const th = m.a.th + m.dth * t;
  return {
    x: m.a.x + m.R * sg * (Math.sin(th) - Math.sin(m.a.th)),
    z: m.a.z - m.R * sg * (Math.cos(th) - Math.cos(m.a.th)),
    th,
  };
}

export const motionEnd = (m: Motion) => (m.kind === 'line' ? m.b : motionAt(m, 1));

/** Centre path length and absolute heading change of a motion. */
export function motionSize(m: Motion): { len: number; rot: number } {
  if (m.kind === 'arc') return { len: Math.abs(m.R * m.dth), rot: Math.abs(m.dth) };
  return { len: Math.hypot(m.b.x - m.a.x, m.b.z - m.a.z), rot: Math.abs(angleDelta(m.a.th, m.b.th)) };
}

/** Upper bound on the displacement of any formation point over the motion. */
export function motionDisp(m: Motion, f: Formation): number {
  const { len, rot } = motionSize(m);
  return len + f.extent * rot;
}

/** First disc (index) whose clearance is insufficient at pose q, or -1. */
export function poseHit(g: LevelGrid, f: Formation, q: SE2, margin: number, out?: { p: Vec2 }): number {
  const c = Math.cos(q.th), s = Math.sin(q.th);
  const { x0, z0, cell, nx, nz, clearance } = g;
  for (let k = 0; k < f.discs.length; k++) {
    const d = f.discs[k];
    const px = q.x + d.c[0] * c - d.c[1] * s, pz = q.z + d.c[0] * s + d.c[1] * c;
    const i = Math.floor((px - x0) / cell), j = Math.floor((pz - z0) / cell);
    const cl = i < 0 || j < 0 || i >= nx || j >= nz ? 0 : clearance[j * nx + i];
    if (cl < d.r + margin) {
      if (out) out.p = [px, pz];
      return k;
    }
  }
  return -1;
}

/** Number of samples (excluding t = 0) so that no point moves more than SAMPLE between samples. */
export const samplesFor = (m: Motion, f: Formation) => Math.max(1, Math.ceil(motionDisp(m, f) / SAMPLE));

/** Check a motion at samples t ∈ (0, 1]. Returns the first hit or null. Optionally collects the sampled poses. */
export function sweep(g: LevelGrid, f: Formation, m: Motion, margin = PLAN_MARGIN, collect?: SE2[]): Hit | null {
  const n = samplesFor(m, f);
  const out = { p: [0, 0] as Vec2 };
  for (let k = 1; k <= n; k++) {
    const q = motionAt(m, k / n);
    const d = poseHit(g, f, q, margin, out);
    if (d >= 0) return { disc: d, p: out.p, q };
    collect?.push(q);
  }
  return null;
}

/**
 * Grid-distance field (m) to `goal` over cells with clearance ≥ `thresh`
 * (8-connected Dijkstra). Stops `margin` metres beyond the first time the
 * cell `stopCell` is settled, so the search region stays bounded.
 */
export function distanceField(g: LevelGrid, goal: Vec2, thresh: number, stopCell: number, margin: number): Float32Array {
  const N = g.nx * g.nz;
  const dist = new Float32Array(N).fill(Infinity);
  const gi = Math.floor((goal[0] - g.x0) / g.cell), gj = Math.floor((goal[1] - g.z0) / g.cell);
  if (gi < 0 || gj < 0 || gi >= g.nx || gj >= g.nz) return dist;
  const heap = new Heap();
  const g0 = gj * g.nx + gi;
  dist[g0] = 0;
  heap.push(g0, 0);
  const done = new Uint8Array(N);
  let limit = Infinity;
  const D = g.cell, DD = g.cell * Math.SQRT2;
  while (heap.size) {
    const c = heap.pop();
    if (done[c]) continue;
    const dc = dist[c];
    if (dc > limit) { dist[c] = Infinity; continue; }
    done[c] = 1;
    if (c === stopCell) limit = dc + margin;
    const ci = c % g.nx, cj = (c - ci) / g.nx;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
        const n = nj * g.nx + ni;
        if (done[n] || g.clearance[n] < thresh) continue;
        const t = dc + (di && dj ? DD : D);
        if (t < dist[n]) { dist[n] = t; heap.push(n, t); }
      }
  }
  // drop tentative (unsettled) values so the field is exact where finite
  for (let c = 0; c < N; c++) if (!done[c]) dist[c] = Infinity;
  return dist;
}

/** Deterministic binary min-heap over (value, key); ties broken by insertion order. */
export class Heap {
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
