// Lane NAV measurement: tick time and memory with N Souls walking on a ground world.
//   node --expose-gc tools/nav/measure.ts [--mode paged|window] [--spread 2000|300] [--n 20] [--seconds 120]
// spread 2000: Souls on a 5 × 4 grid across a 2 km world, each walking ~300 m (paged only: the window refuses it).
// spread 300: the same Souls inside 300 m, each walking ~100 m — the old window's own case, to compare tick cost.
import { marsFactory, GREEN_FIELD_WORLD } from '../../packages/engine-mars/src/engine.ts';
import { groundFact } from '../../packages/engine-mars/src/ground-bridge.ts';
import { emptyGround } from '../../packages/ground/src/index.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const mode = arg('mode', 'paged'), spread = Number(arg('spread', '2000')), N = Number(arg('n', '20')), secs = Number(arg('seconds', '120'));
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const mb = () => { gc(); const m = process.memoryUsage(); return { heap: Math.round(m.heapUsed / 2 ** 20), ext: Math.round((m.external + m.arrayBuffers) / 2 ** 20), rss: Math.round(m.rss / 2 ** 20) }; };

const factory = await marsFactory(GREEN_FIELD_WORLD);
const g = emptyGround(2000);
g.extent = [-200, -1000, 1800, 1000];
for (let i = 0; i < 12; i++) g.landforms.push({ id: `hill${i}`, kind: 'bump', c: [-100 + ((i * 377) % 1800), -900 + ((i * 613) % 1800)], r: 40 + (i % 3) * 20, h: 4 + (i % 4), peak: 1 });
const e = factory.create(factory.genesis(`measure-${mode}`)) as never as {
  installGroundV1(f: unknown): unknown; spawnHuman(o: object): string; restoreHumanPoseV1(id: string, p: object): boolean;
  perform(p: object): { ok: boolean; id: string }; step(): { programs: { id: string; kind: string; code?: string }[] };
  world: { entities: Record<string, { pose: { p: number[] } }> }; runtime: { violations: unknown[]; services: Record<string, unknown> };
};
e.installGroundV1(groundFact(g, 1, { paged: mode === 'paged' }));
// the old window starts round the origin: grow it over the area the Souls are placed in (its own case: ≤ 384 m)
if (mode !== 'paged') { const r = e as never as { rt: { services: { spatial: { groundInclude(w: unknown, r: number[]): boolean } }; world: unknown } }; if (!r.rt.services.spatial.groundInclude(r.rt.world, [-2, -3, 3, 2])) throw new Error('window'); }
const m0 = mb();
const ids: string[] = [], goals: [number, number][] = [];
for (let k = 0; k < N; k++) {
  const id = `h_${k}`; ids.push(id); e.spawnHuman({ id, label: id, soul: `s_${k}` });
  const col = k % 5, row = Math.floor(k / 5);
  const x = spread >= 1000 ? -100 + col * 420 : -100 + col * (spread / 5), z = spread >= 1000 ? -850 + row * 520 : -150 + row * (spread / 4);
  if (!e.restoreHumanPoseV1(id, { p: [x, 0, z], level: 0 })) throw new Error(`cannot place ${id} at ${x},${z}`);
  const a = (k * 2.39996) % (2 * Math.PI), d = spread >= 1000 ? 300 : 100;
  goals.push([Math.max(-190, Math.min(1790, x + Math.cos(a) * d)), Math.max(-990, Math.min(990, z + Math.sin(a) * d))]);
}
const progs = ids.map((id, k) => e.perform({ actor: id, label: 'walk', steps: [{ verb: 'walk_to', params: { to: goals[k] } }] }));
const refused = progs.filter((p) => !p.ok).length;
const times: number[] = [], ends = new Map<string, string>();
const t0 = performance.now();
let peak = m0;
for (let t = 0; t < secs * 20; t++) {
  const s = performance.now();
  const out = e.step();
  times.push(performance.now() - s);
  for (const p of out.programs) if (['completed', 'failed', 'cancelled'].includes(p.kind)) ends.set(p.id, p.kind + (p.code ? `:${p.code}` : ''));
  if (t % 200 === 0) { const m = mb(); if (m.rss > peak.rss) peak = m; }
}
const wall = performance.now() - t0;
const sp = (e as never as { rt: { services: Record<string, unknown> } }).rt.services.spatial as { pagesInfo?: () => { rects: number[][]; built: number; bytes: number } | null; ground?: { stats: object } };
times.sort((a, b) => a - b);
const q = (f: number) => times[Math.min(times.length - 1, Math.floor(f * times.length))].toFixed(2);
const kinds: Record<string, number> = {}; for (const v of ends.values()) kinds[v] = (kinds[v] ?? 0) + 1;
console.log(JSON.stringify({
  mode, spread, souls: N, ticks: times.length, refused, ends: kinds,
  msPerTick: { mean: (wall / times.length).toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: times.at(-1)!.toFixed(1) },
  memMB: { before: m0, peak, end: mb() }, pages: sp.pagesInfo?.() ? { windows: sp.pagesInfo!()!.rects.length, built: sp.pagesInfo!()!.built, gridMB: Math.round(sp.pagesInfo!()!.bytes / 2 ** 20) } : null,
  stats: sp.ground?.stats, violations: (e as never as { rt: { violations: unknown[] } }).rt.violations.length,
}, null, 1));
{
  const gn = (sp as unknown as { ground: { fine: Map<string, { free: Uint8Array; clearance: Float32Array; blk: Int16Array }>; composed: Map<string, { free: Uint8Array; nx: number; nz: number }>; fineMax: number; composedMax: number } }).ground;
  let fb = 0; for (const t of gn.fine.values()) fb += t.free.byteLength + t.clearance.byteLength + t.blk.byteLength;
  let cb = 0; for (const c of gn.composed.values()) cb += c.nx * c.nz * 9;
  console.log(JSON.stringify({ fine: gn.fine.size, fineMB: Math.round(fb / 2 ** 20), fineMax: gn.fineMax, composed: gn.composed.size, composedMB: Math.round(cb / 2 ** 20), composedMax: gn.composedMax }));
}
