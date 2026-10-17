// Desert near-field generators (lane MARSLAND-NEAR): half-buried tyres, lines and rings of tyres,
// creosote scrub with dry grass tufts, tyre-track marks, and the playa noise the `playa` ground
// palette and the scrub share (bushes and grass follow the darker drainage veins, as on the
// Salton Sea playa). Pure and deterministic: the viewer instances the result, the server and the
// skill can count it. Decor only: no colliders (tyres are ≤ 0.4 m proud of the ground and bushes are
// sparse; Souls walk across tyres and between bushes; a god who wants a barrier uses fence/1).
import { bounds2, boxOfBounds, n, pointInPoly, polylineLength, rng } from './geom.ts';
import type { Value } from './fields.ts';
import type { Baked, Generator, Shape, Vec2 } from './types.ts';

// ---------------------------------------------------------------- noise

/** Integer hash → [0, 1). */
function h2(ix: number, iz: number, k: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
/** Smooth value noise in [0, 1] at unit cell size. */
export function vnoise(x: number, z: number, k = 0): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h2(ix, iz, k), b = h2(ix + 1, iz, k), c = h2(ix, iz + 1, k), d = h2(ix + 1, iz + 1, k);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Fractal value noise in [0, 1]: `oct` octaves from cell size `scale` m down. */
export function fbm(x: number, z: number, scale: number, oct = 3, k = 0): number {
  let s = 0, w = 0, a = 1, f = 1 / scale;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f, k + i * 17); w += a; a *= 0.5; f *= 2.03; }
  return s / w;
}
const sstep = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
/**
 * The playa's drainage veins: 0 off a vein … 1 in its centre. Contour lines of warped noise at two
 * scales (≈ 70 m and ≈ 25 m apart), thin and wandering like the tan veins in the drone frames.
 */
export function playaVein(x: number, z: number): number {
  const wx = x + (fbm(x, z, 60, 2, 5) - 0.5) * 50, wz = z + (fbm(x, z, 60, 2, 9) - 0.5) * 50;
  const big = 1 - Math.abs(fbm(wx, wz, 90, 2, 21) * 2 - 1);      // ridge where the noise crosses 0.5
  const small = 1 - Math.abs(fbm(wx * 1.1, wz * 1.1, 32, 2, 33) * 2 - 1);
  const thin = sstep(0.955, 0.995, big), fine = sstep(0.97, 0.997, small) * (0.35 + 0.65 * fbm(x, z, 40, 1, 41));
  const breakup = sstep(0.32, 0.62, fbm(x, z, 45, 2, 47));        // veins come and go, never one long river
  return Math.max(thin * (0.25 + 0.75 * breakup), fine * 0.75 * breakup);
}
/** Large soft patches in [-1, 1]: crusted (light) vs dusty (tan) ground, ≈ 40–200 m blobs. */
export function playaPatch(x: number, z: number): number { return (fbm(x, z, 140, 3, 51) - 0.5) * 2; }

// ---------------------------------------------------------------- tyres

/** One tyre: position, heading, pose (0 upright, 1 flat, 2 leaning), lean angle, how much is sunk (m), scale, tone. */
export type TirePose = { x: number; z: number; yaw: number; pose: 0 | 1 | 2; lean: number; sink: number; s: number; tone: number };
const TIRE_TRIS = 192;

/** A closed ellipse (semi-axes rx along local x, rz along local z) around (cx, cz), turned by yaw (three.js sense). */
export function ellipsePath(cx: number, cz: number, rx: number, rz: number, yaw = 0, segs = 96): Vec2[] {
  const out: Vec2[] = [], co = Math.cos(yaw), si = Math.sin(yaw);
  for (let i = 0; i <= segs; i++) { const a = (i / segs) * Math.PI * 2, lx = Math.cos(a) * rx, lz = Math.sin(a) * rz; out.push([cx + lx * co + lz * si, cz - lx * si + lz * co]); }
  return out;
}

const isClosed = (p: Vec2[]) => p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5;

/**
 * Tyres along a path: spacing with jitter, gaps of 1..gapMax slots, clusters of 2..clusterMax
 * tyres, strays tossed off the line, and (closed lines) a few loose heaps inside. Same seed, same tyres.
 */
export function tireLine(path0: Vec2[], params: Record<string, Value>, seed: number, cap = 4000): TirePose[] {
  const closed = params.closed === true || (params.closed !== false && isClosed(path0));
  const path = closed && !isClosed(path0) ? [...path0, path0[0]] : path0;
  const D = n(params.diameter, 0.62), spacing = Math.max(D * 1.05, n(params.spacing, 1.5)), jitter = Math.min(0.9, Math.max(0, n(params.jitter, 0.35)));
  const gapP = n(params.gaps, 0.08), gapMax = Math.max(1, Math.round(n(params.gapMax, 4))), clusterP = n(params.clusters, 0.07), clusterMax = Math.max(2, Math.round(n(params.clusterMax, 4)));
  const strayP = n(params.strays, 0.05), strayDist = n(params.strayDist, 12), flatP = n(params.flat, 0.1), burial = Math.min(0.9, Math.max(0, n(params.burial, 0.35)));
  const heaps = closed ? Math.max(0, Math.round(n(params.innerClusters, 2))) : 0;
  const rnd = rng(((seed | 0) ^ 0x71e5) || 1);
  const L = polylineLength(path); if (L < 0.5) return [];
  // arc-length sampler
  const seg: { a: Vec2; d: Vec2; s0: number; len: number }[] = []; let acc = 0;
  for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1e-6) continue; seg.push({ a, d: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], s0: acc, len }); acc += len; }
  let si = 0;
  const at = (s: number) => { s = Math.min(L, Math.max(0, s)); if (s < seg[si].s0) si = 0; while (si < seg.length - 1 && s > seg[si].s0 + seg[si].len) si++; const g = seg[si], t = s - g.s0; return { x: g.a[0] + g.d[0] * t, z: g.a[1] + g.d[1] * t, dx: g.d[0], dz: g.d[1] }; };
  const out: TirePose[] = [];
  const sinkFor = (pose: 0 | 1 | 2, s: number) => (pose === 1 ? 0.06 + 0.06 * rnd() : D * (burial + (rnd() - 0.5) * 0.16)) * s;
  const put = (x: number, z: number, heading: number, pose: 0 | 1 | 2) => {
    const s = 0.92 + rnd() * 0.16;
    out.push({ x, z, yaw: heading, pose, lean: pose === 2 ? (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.45) : (rnd() - 0.5) * 0.12, sink: sinkFor(pose, s), s, tone: rnd() });
  };
  const poseOf = (): 0 | 1 | 2 => { const r = rnd(); return r < flatP ? 1 : r < flatP + 0.12 ? 2 : 0; };
  // three.js yaw for a tyre whose rolling plane is along (dx, dz): its local +x axis is the tread direction
  const yawAlong = (dx: number, dz: number) => Math.atan2(-dz, dx);
  const end = closed ? L - spacing * 0.5 : L;
  for (let s = 0; s <= end && out.length < cap;) {
    const r = rnd();
    if (r < gapP) { s += spacing * (1 + Math.floor(rnd() * gapMax)); continue; }
    const p = at(s), nx = -p.dz, nz = p.dx;
    if (r < gapP + clusterP) {
      const k = 2 + Math.floor(rnd() * (clusterMax - 1));
      for (let i = 0; i < k; i++) { const off = (rnd() - 0.5) * D * 1.6, along = i * D * 0.95; const q = at(s + along); put(q.x + nx * off, q.z + nz * off, yawAlong(q.dx, q.dz) + (rnd() - 0.5) * 0.9, rnd() < 0.3 ? 1 : poseOf()); }
      s += (k - 1) * D * 0.95 + spacing * (1 + (rnd() - 0.5) * 2 * jitter);
      continue;
    }
    const off = (rnd() - 0.5) * 0.5;
    put(p.x + nx * off, p.z + nz * off, yawAlong(p.dx, p.dz) + (rnd() - 0.5) * 0.35, poseOf());
    s += spacing * (1 + (rnd() - 0.5) * 2 * jitter);
  }
  // strays: tossed off the line, either side
  const line = out.length, strays = Math.round(line * strayP);
  for (let i = 0; i < strays && out.length < cap; i++) {
    const p = at(rnd() * L), side = rnd() < 0.5 ? -1 : 1, d = 1.5 + rnd() * Math.max(0.5, strayDist - 1.5);
    put(p.x - p.dz * side * d, p.z + p.dx * side * d, rnd() * 6.283, rnd() < 0.45 ? 1 : poseOf());
  }
  // heaps inside a closed line: 3..6 tyres around a point between the centroid and the line
  if (heaps) {
    let cx = 0, cz = 0; for (const [x, z] of path) { cx += x; cz += z; } cx /= path.length; cz /= path.length;
    for (let h = 0; h < heaps && out.length < cap; h++) {
      const p = at(rnd() * L), t = 0.25 + rnd() * 0.5, hx = cx + (p.x - cx) * t, hz = cz + (p.z - cz) * t, k = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < k; i++) { const a = rnd() * 6.283, d = rnd() * 2.2; put(hx + Math.cos(a) * d, hz + Math.sin(a) * d, rnd() * 6.283, rnd() < 0.55 ? 1 : poseOf()); }
    }
  }
  return out;
}

/** Ring points in world space for a tire-ring/1 entity at (px, pz) turned by yaw. */
export function tireRingPath(px: number, pz: number, yaw: number, params: Record<string, Value>): Vec2[] {
  const rx = n(params.rx, 55), rz = n(params.rz, 100), segs = Math.max(24, Math.min(400, Math.round((Math.PI * (rx + rz)) / 3)));
  return ellipsePath(px, pz, rx, rz, yaw, segs);
}

const LINE_PARAMS = {
  diameter: { type: 'number', min: 0.3, max: 1.6, default: 0.62, doc: 'tyre outer diameter (m)' },
  burial: { type: 'number', min: 0, max: 0.9, default: 0.35, doc: 'fraction of the diameter sunk into the ground (upright tyres)' },
  spacing: { type: 'number', min: 0.5, max: 30, default: 1.5, doc: 'mean distance between tyres along the line (m)' },
  jitter: { type: 'number', min: 0, max: 0.9, default: 0.35, doc: 'spacing randomness (fraction)' },
  gaps: { type: 'number', min: 0, max: 0.6, default: 0.08, doc: 'chance a slot starts a gap' },
  gapMax: { type: 'int', min: 1, max: 20, default: 4, doc: 'longest gap, in slots' },
  clusters: { type: 'number', min: 0, max: 0.6, default: 0.07, doc: 'chance a slot holds a cluster' },
  clusterMax: { type: 'int', min: 2, max: 8, default: 4, doc: 'most tyres in a cluster' },
  strays: { type: 'number', min: 0, max: 1, default: 0.05, doc: 'stray tyres per line tyre, tossed off the line' },
  strayDist: { type: 'number', min: 1, max: 60, default: 12, doc: 'how far strays land from the line (m)' },
  innerClusters: { type: 'int', min: 0, max: 20, default: 2, doc: 'loose heaps of 3–6 tyres inside a closed line' },
  flat: { type: 'number', min: 0, max: 1, default: 0.1, doc: 'share of tyres lying flat (the rest upright, a few leaning)' },
  color: { type: 'color', default: '#1d1c1b', doc: 'rubber colour' },
} as const;

export const tireGen: Generator = {
  id: 'tire/1', form: 'point', owner: 'MARSLAND', doc: 'An old car tyre half-buried in the ground: upright (sunk by `burial`), flat, or leaning. Decor, no collider.',
  params: {
    diameter: LINE_PARAMS.diameter, burial: LINE_PARAMS.burial,
    pose: { type: 'enum', values: ['upright', 'flat', 'leaning'], default: 'upright' },
    color: LINE_PARAMS.color,
  },
  physics({ params }) {
    const D = n(params.diameter, 0.62), pose = params.pose, b = n(params.burial, 0.35), w = D * 0.33;
    const box: [number, number, number] = pose === 'flat' ? [D, w * 0.6, D] : [D, Math.max(0.05, D * (1 - b)), w];
    return { box, colliders: [], slots: [], tris: TIRE_TRIS };
  },
};

function lineBaked(path: Vec2[], params: Record<string, Value>, seed: number, what: string): Baked {
  const t = tireLine(path, params, seed);
  return { box: boxOfBounds(bounds2(path, n(params.strayDist, 12)), n(params.diameter, 0.62)), colliders: [], slots: [], tris: t.length * TIRE_TRIS, notes: [`${t.length} tyres ${what} (one instanced mesh, decor: Souls walk across)`] };
}
export const tireLineGen: Generator = {
  id: 'tire-line/1', form: 'path', owner: 'MARSLAND', doc: 'Old tyres along a path (a closed path, first point = last, is a ring): spacing jitter, gaps, clusters, strays off the line, heaps inside. One instanced mesh. Decor, no colliders.',
  params: { ...LINE_PARAMS, closed: { type: 'bool', doc: 'force closed/open (default: closed when the path ends where it starts)' } },
  physics({ params, shape, seed }) { return lineBaked(shape?.path ?? [[-10, 0], [10, 0]], params, seed, 'along the line'); },
};
export const tireRingGen: Generator = {
  id: 'tire-ring/1', form: 'point', owner: 'MARSLAND', doc: 'An elliptical ring of old tyres around the entity (an old dirt race track): semi-axes rx (local x) and rz (local z), turned with the entity. Same scatter rules as tire-line/1.',
  params: { rx: { type: 'number', min: 3, max: 195, default: 55, doc: 'semi-axis along local x (m)' }, rz: { type: 'number', min: 3, max: 195, default: 100, doc: 'semi-axis along local z (m)' }, ...LINE_PARAMS },
  physics({ params, seed }) {
    const b = lineBaked(tireRingPath(0, 0, 0, params), { ...params, closed: true }, seed, 'in the ring');
    return { ...b, box: [2 * n(params.rx, 55) + 2, n(params.diameter, 0.62), 2 * n(params.rz, 100) + 2] };
  },
};

// ---------------------------------------------------------------- creosote scrub

/** Plant kinds the scrub draws (the viewer has one instanced mesh per kind). */
export const SCRUB_KINDS = ['creosote-a', 'creosote-b', 'creosote-c', 'tuft-straw', 'tuft-sage'] as const;
export type ScrubPoint = { x: number; z: number; k: number; s: number; yaw: number; tone: number };
const DIRS: Record<string, Vec2> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [0.7071, -0.7071], nw: [-0.7071, -0.7071], se: [0.7071, 0.7071], sw: [-0.7071, 0.7071] };
type Clear = [number, number, number];
const clearsOf = (v: unknown): Clear[] => (Array.isArray(v) ? (v as Clear[]).filter((c) => Array.isArray(c) && c.length >= 3 && c.every((x) => typeof x === 'number')).slice(0, 64) : []);

/**
 * Creosote bushes and dry grass tufts over an area: low density, denser `toward` a side by
 * `gradient`, following the playa veins by `veins`, loosely clumped by `cluster`, kept out of the
 * `clear` circles and wherever `blocked(x, z)` says (solids, roads; the viewer passes it).
 */
export function scrubPoints(area: Vec2[], params: Record<string, Value>, seed: number, blocked: (x: number, z: number) => boolean = () => false, cap = 30000): ScrubPoint[] {
  const density = n(params.density, 0.0015), grass = n(params.grass, 3), g = Math.min(1, Math.max(0, n(params.gradient, 0.6))), veins = Math.min(1, Math.max(0, n(params.veins, 0.6)));
  const cluster = Math.min(1, Math.max(0, n(params.cluster, 0.35))), hMin = n(params.minHeight, 0.4), hMax = Math.max(hMin, n(params.maxHeight, 1.6)), spacing = n(params.minSpacing, 2.5);
  const dir = DIRS[String(params.toward ?? 'none')] ?? null, clears = clearsOf(params.clear);
  const [x0, z0, x1, z1] = bounds2(area), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = Math.max(1, (x1 - x0) / 2), hz = Math.max(1, (z1 - z0) / 2), A = (x1 - x0) * (z1 - z0);
  const grad = (x: number, z: number) => { if (!dir || !g) return 1; const t = Math.max(-1, Math.min(1, ((x - cx) / hx) * dir[0] + ((z - cz) / hz) * dir[1])); return 1 + g * t; };
  const clump = (x: number, z: number) => 1 - cluster + cluster * 2 * fbm(x, z, 35, 2, 77);
  const out: ScrubPoint[] = [];
  const cell = Math.max(0.5, spacing), grid = new Map<string, Vec2[]>();
  const free = (x: number, z: number, sp: number) => { const gx = Math.floor(x / cell), gz = Math.floor(z / cell), s2 = sp * sp; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const [px, pz] of grid.get(`${gx + dx},${gz + dz}`) ?? []) if ((px - x) ** 2 + (pz - z) ** 2 < s2) return false; return true; };
  const mark = (x: number, z: number) => { const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`; const l = grid.get(k); if (l) l.push([x, z]); else grid.set(k, [[x, z]]); };
  const inClear = (x: number, z: number) => clears.some(([qx, qz, r]) => (x - qx) ** 2 + (z - qz) ** 2 < r * r);
  // two passes: bushes (follow the veins a little), then grass (hugs the veins)
  const passes: { dens: number; vein: number; bush: boolean; seedK: number }[] = [
    { dens: density, vein: veins, bush: true, seedK: 0x3c05 },
    { dens: density * grass, vein: Math.min(1, veins * 1.4), bush: false, seedK: 0x6a55 },
  ];
  // The same area is scattered twice in a viewer (the bake's physics() counts it, the mesh places it with `blocked`):
  // the random stream and each trial's noise test depend only on the stream position, so both are memoised per
  // (area, params, seed) and a second call replays them; only `blocked` and spacing are evaluated again.
  const memo = scrubMemo([area, seed, cap, density, grass, g, veins, cluster, String(params.toward ?? 'none'), clears]);   // what the verdicts read
  for (const [pi, ps] of passes.entries()) {
    if (ps.dens <= 0) continue;
    const maxMult = (1 + (dir ? g : 0)) * (1 - ps.vein + ps.vein / VEIN_MEAN) * (1 + cluster);
    const tries = Math.min(cap * 4, Math.floor(A * ps.dens * maxMult)), gen = rng(((seed | 0) ^ ps.seedK) || 1);
    let j = 0; const rnd = () => { j++; return gen(); };
    for (let i = 0; i < tries && out.length < cap; i++) {
      const at = j, x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), r = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      let pass = memo.get(pi, at);
      if (pass === undefined) {
        pass = pointInPoly(x, z, area) && !(r * maxMult > grad(x, z) * (1 - ps.vein + (ps.vein * playaVein(x, z)) / VEIN_MEAN) * clump(x, z)) && !inClear(x, z);
        memo.set(pi, at, pass);
      }
      if (!pass || blocked(x, z)) continue;
      if (ps.bush) {
        if (!free(x, z, spacing)) continue;
        const h = hMin + (hMax - hMin) * Math.pow(r2, 1.6);
        out.push({ x, z, k: Math.floor(r3 * 3), s: h, yaw: r4 * 6.283, tone: rnd() }); mark(x, z);
      } else {
        if (!free(x, z, 0.9)) continue;
        out.push({ x, z, k: r3 < 0.7 ? 3 : 4, s: 0.25 + 0.4 * r2, yaw: r4 * 6.283, tone: rnd() });
      }
    }
  }
  return out;
}

// A few recent scatters (key = everything the verdicts read): each trial's noise verdict by its position in the pass's
// random stream (the stream itself is a cheap xorshift and is regenerated). One byte per stream position.
type ScrubMemo = { get(pass: number, at: number): boolean | undefined; set(pass: number, at: number, ok: boolean): void };
const scrubMemos = new Map<string, ScrubMemo>();
function scrubMemo(inputs: unknown[]): ScrubMemo {
  const key = JSON.stringify(inputs);
  let m = scrubMemos.get(key);
  if (m) { scrubMemos.delete(key); scrubMemos.set(key, m); return m; }
  const marks: Uint8Array[] = [];   // 0 unknown, 1 pass, 2 fail
  m = {
    get(pass, at) { const v = marks[pass]?.[at]; return v === 1 ? true : v === 2 ? false : undefined; },
    set(pass, at, ok) {
      let a = marks[pass] ?? new Uint8Array(1024);
      if (at >= a.length) { const b = new Uint8Array(Math.max(at + 1, a.length * 2)); b.set(a); a = b; }
      marks[pass] = a; a[at] = ok ? 1 : 2;
    },
  };
  scrubMemos.set(key, m);
  while (scrubMemos.size > 4) scrubMemos.delete(scrubMemos.keys().next().value!);
  return m;
}

/** Mean of playaVein over a large area (measured), so `density` stays the true average whatever `veins` is. */
const VEIN_MEAN = 0.047;
const SCRUB_TRIS = [208, 208, 182, 14, 14];
export const desertScrubGen: Generator = {
  id: 'desert-scrub/1', form: 'area', owner: 'MARSLAND', doc: 'Sparse desert scrub: creosote bushes (3 shapes, 0.4–1.6 m) and dry grass tufts that follow the playa veins; denser toward a side; keeps off buildings and roads and out of `clear` circles. Five instanced meshes for any area. Decor, no colliders.',
  params: {
    density: { type: 'number', min: 0, max: 0.2, default: 0.0015, doc: 'bushes per m² on average (0.0015 ≈ one per 670 m²)' },
    grass: { type: 'number', min: 0, max: 20, default: 3, doc: 'grass tufts per bush' },
    toward: { type: 'enum', values: ['none', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'], default: 'none', doc: 'denser toward this side of the area (engine north = −z)' },
    gradient: { type: 'number', min: 0, max: 1, default: 0.6, doc: 'how much denser (1 = from none at one side to double at the other)' },
    veins: { type: 'number', min: 0, max: 1, default: 0.6, doc: 'how much plants follow the playa drainage veins' },
    cluster: { type: 'number', min: 0, max: 1, default: 0.35, doc: '0 even … 1 clumped' },
    minHeight: { type: 'number', min: 0.2, max: 3, default: 0.4 }, maxHeight: { type: 'number', min: 0.2, max: 3, default: 1.6 },
    minSpacing: { type: 'number', min: 0.5, max: 30, default: 2.5, doc: 'between bushes (m)' },
    clear: { type: 'json', doc: '[[x, z, r], …] circles kept bare (a camp, a plaza)' },
  },
  physics({ params, shape, seed }) {
    const area = shape?.area ?? ([[-20, -20], [20, -20], [20, 20], [-20, 20]] as Vec2[]);
    // The scatter is only counted here (tris, notes): it runs when something reads them (budgets, god plans, a skill),
    // not on every viewer's bake before the arrival card (~400 ms of playa noise on a 4x-throttled phone for mars-two).
    let counted: { tris: number; notes: string[] } | undefined;
    const count = () => counted ??= (() => {
      const pts = scrubPoints(area, params, seed);
      const per = [0, 0, 0, 0, 0]; let tris = 0; for (const p of pts) { per[p.k]++; tris += SCRUB_TRIS[p.k]; }
      return { tris, notes: [`${per[0] + per[1] + per[2]} creosote bushes, ${per[3] + per[4]} grass tufts (before exclusions; 5 instanced meshes, decor)`] };
    })();
    return { box: boxOfBounds(bounds2(area), n(params.maxHeight, 1.6)), colliders: [], slots: [], get tris() { return count().tris; }, get notes() { return count().notes; } };
  },
};
export const creosoteGen: Generator = {
  id: 'creosote/1', form: 'point', owner: 'MARSLAND', doc: 'One creosote bush: a rounded open clump of small dark olive leaf clusters on thin grey stems. Decor, no collider.',
  params: { height: { type: 'number', min: 0.3, max: 3, default: 1 }, variant: { type: 'int', min: 0, max: 2, default: 0 }, color: { type: 'color', default: '#56603f', doc: 'leaf colour' } },
  physics({ params }) { const h = n(params.height, 1); return { box: [h * 1.4, h, h * 1.3], colliders: [], slots: [], tris: SCRUB_TRIS[Math.min(2, Math.max(0, Math.round(n(params.variant, 0))))] }; },
};

// ---------------------------------------------------------------- tyre tracks

/** Centre lines of vehicle tracks wandering over an area (random-walk curvature: arcs, S-bends, donuts). */
export function trackLines(area: Vec2[], params: Record<string, Value>, seed: number): Vec2[][] {
  const count = Math.max(0, Math.min(400, Math.round(n(params.count, 60)))), lmin = n(params.minLength, 40), lmax = Math.max(lmin, n(params.maxLength, 180)), curl = n(params.curl, 0.5);
  const [x0, z0, x1, z1] = bounds2(area), rnd = rng(((seed | 0) ^ 0x7ac5) || 1), step = 2, out: Vec2[][] = [];
  for (let tries = 0; out.length < count && tries < count * 8; tries++) {
    let x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (!pointInPoly(x, z, area)) continue;
    let h = rnd() * 6.283, k = (rnd() - 0.5) * 0.06 * curl; const L = lmin + (lmax - lmin) * rnd(), line: Vec2[] = [[x, z]];
    const donut = rnd() < 0.12 * curl;          // a few tight loops (donuts)
    for (let s = 0; s < L; s += step) {
      k += (rnd() - 0.5) * 0.02 * curl; k = Math.max(-0.08, Math.min(0.08, k));
      h += (donut ? 0.09 : k) * step; x += Math.cos(h) * step; z += Math.sin(h) * step;
      if (!pointInPoly(x, z, area)) break;
      line.push([x, z]);
    }
    if (line.length > 4) out.push(line);
  }
  return out;
}
export const tireTracksGen: Generator = {
  id: 'tire-tracks/1', form: 'area', owner: 'MARSLAND', doc: 'Faint vehicle tracks on the ground: pairs of darker lines wandering over the area in arcs, S-bends and a few donuts. Ground marking, one mesh, walkable.',
  params: {
    count: { type: 'int', min: 0, max: 400, default: 60, doc: 'number of tracks' },
    minLength: { type: 'number', min: 5, max: 1000, default: 40 }, maxLength: { type: 'number', min: 5, max: 2000, default: 180 },
    curl: { type: 'number', min: 0, max: 2, default: 0.5, doc: 'how much tracks bend and loop' },
    gauge: { type: 'number', min: 0.8, max: 3, default: 1.6, doc: 'wheel-track distance (m)' },
    lineWidth: { type: 'number', min: 0.05, max: 1, default: 0.24 },
    color: { type: 'color', default: '#979080', doc: 'track colour (a little darker than the ground)' },
  },
  physics({ params, shape, seed }) {
    const area = shape?.area ?? ([[-20, -20], [20, -20], [20, 20], [-20, 20]] as Vec2[]);
    const lines = trackLines(area, params, seed); let segs = 0; for (const l of lines) segs += l.length - 1;
    return { box: boxOfBounds(bounds2(area), 0.05), colliders: [], slots: [], tris: segs * 4, notes: [`${lines.length} tracks, ${segs * 4} tris in one mesh`] };
  },
};

export const DESERT_GENERATORS: Generator[] = [tireGen, tireLineGen, tireRingGen, creosoteGen, desertScrubGen, tireTracksGen];
export type { Shape };
