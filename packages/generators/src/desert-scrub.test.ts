// desert-scrub memo: a second scatter of the same area replays the random stream and noise verdicts. The output must
// equal the original single-pass algorithm (kept verbatim below as `reference`) for any `blocked`, cached or not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubPoints, playaVein, fbm, type ScrubPoint } from './desert.ts';
import { bounds2, n, pointInPoly, rng } from './geom.ts';
import type { Value } from './fields.ts';
import type { Vec2 } from './types.ts';
const DIRS: Record<string, Vec2> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [0.7071, -0.7071], nw: [-0.7071, -0.7071], se: [0.7071, 0.7071], sw: [-0.7071, 0.7071] };
type Clear = [number, number, number];
const clearsOf = (v: unknown): Clear[] => (Array.isArray(v) ? (v as Clear[]).filter((c) => Array.isArray(c) && c.length >= 3 && c.every((x) => typeof x === 'number')).slice(0, 64) : []);
const VEIN_MEAN = 0.047;
// the pre-memo implementation (trunk 32a8ed40), renamed
function reference(area: Vec2[], params: Record<string, Value>, seed: number, blocked: (x: number, z: number) => boolean = () => false, cap = 30000): ScrubPoint[] {
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
  for (const ps of passes) {
    if (ps.dens <= 0) continue;
    const maxMult = (1 + (dir ? g : 0)) * (1 - ps.vein + ps.vein / VEIN_MEAN) * (1 + cluster);
    const tries = Math.min(cap * 4, Math.floor(A * ps.dens * maxMult)), rnd = rng(((seed | 0) ^ ps.seedK) || 1);
    for (let i = 0; i < tries && out.length < cap; i++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), r = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      if (!pointInPoly(x, z, area)) continue;
      const m = grad(x, z) * (1 - ps.vein + (ps.vein * playaVein(x, z)) / VEIN_MEAN) * clump(x, z);
      if (r * maxMult > m) continue;
      if (inClear(x, z) || blocked(x, z)) continue;
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

const area: Vec2[] = [[-180, -150], [210, -170], [240, 160], [-40, 230], [-200, 90]];
const blockA = (x: number, z: number) => Math.hypot(x - 20, z + 10) < 45 || (x > 100 && x < 130);
const blockB = (x: number, z: number) => (Math.floor(x / 17) + Math.floor(z / 23)) % 3 === 0;
test('scrub points: cached replays equal the original algorithm for any blocked, both orders', () => {
  for (const [seed, params] of [[11, { density: 0.004, grass: 3, toward: 'ne', clear: [[0, 0, 30]] }], [12345, { density: 0.002, veins: 1, cluster: 0.8, minSpacing: 4 }]] as [number, Record<string, Value>][]) {
    const want = [undefined, blockA, blockB].map((b) => reference(area, params, seed, b));
    assert.ok(want[0].length > 100 && want[1].length < want[0].length && want[2].length < want[0].length, `${want.map((w) => w.length)}`);
    for (const order of [[0, 1, 2, 1, 0], [2, 0, 1]]) for (const k of order) {
      const got: ScrubPoint[] = scrubPoints(area, params, seed, [undefined, blockA, blockB][k]);
      assert.deepEqual(got, want[k], `seed ${seed} blocked ${k}`);
    }
  }
  // a small cap still stops at the same point
  assert.deepEqual(scrubPoints(area, { density: 0.004 }, 5, blockA, 40), reference(area, { density: 0.004 }, 5, blockA, 40));
});
