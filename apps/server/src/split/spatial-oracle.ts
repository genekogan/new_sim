// Stage B (lane B-spatial): the oracle worker of spatial-tap.ts. HARNESS. Holds a SpatialReplica built only from the
// static exports and recorded dynamic inputs it is sent, replays every recorded engine read on it and compares the answer
// field by field (util.isDeepStrictEqual: same numbers to the bit, same keys, same order of array entries).
import { parentPort } from 'node:worker_threads';
import { isDeepStrictEqual } from 'node:util';
import { getHeapStatistics } from 'node:v8';
import { SpatialReplica, type FixtureRow, type ReplicaBody } from './spatial-replica.ts';
import type { StaticExportV1 } from '../../../../mars/viewer/engine/spatial/service.ts';
import type { TapRecord } from './spatial-tap.ts';

const scenes = new Map<string, StaticExportV1>();
let replica: SpatialReplica | undefined, key = '', fixture: FixtureRow | null = null, lastBodies = new Set<string>();
const by = new Map<string, { n: number; eq: number; diff: number; inTick: number; ms: number }>();
const diffs: unknown[] = [], builds: { key: string; kind: 'build' | 'rebuild'; ms: number; warmMs: number }[] = [];
let heapMax = 0, extMax = 0, total = 0, equal = 0;

function onScene(k: string) {
  const s = scenes.get(k); if (!s) throw new Error(`oracle: no scene ${k}`);
  const t0 = performance.now();
  if (!replica) replica = SpatialReplica.fromStaticScene(s, [], { fixture: (id) => (fixture && fixture.id === id ? fixture : undefined) });
  else replica.rebuild(s);
  const ms = performance.now() - t0, w0 = performance.now(); replica.connectivityV1();   // labels complete (as a poll would need)
  builds.push({ key: k, kind: builds.length ? 'rebuild' : 'build', ms: +ms.toFixed(1), warmMs: +(performance.now() - w0).toFixed(1) });
  key = k;
}
function setBodies(bodies: ReplicaBody[]) {
  const now = new Set(bodies.map((b) => b.id)), gone = [...lastBodies].filter((id) => !now.has(id));
  replica!.applyBodies({ bodies, gone }); lastBodies = now;
}
function replay(r: TapRecord) {
  if (r.k !== key) onScene(r.k);
  if (r.bodies) setBodies(r.bodies);
  replica!.applyPages(r.pg ? r.pg.split(';').map((q) => q.split(',').map(Number) as [number, number, number, number]) : null);
  replica!.applyNavReady(r.rd);
  fixture = r.fixture ?? null;
  const t0 = performance.now();
  let v: unknown, err: string | undefined;
  try { v = (replica as unknown as Record<string, (...a: unknown[]) => unknown>)[r.m](...r.a); } catch (e) { err = (e as Error).message; }
  const ms = performance.now() - t0, ok = !err && isDeepStrictEqual(v, r.v);
  const s = by.get(r.m) ?? { n: 0, eq: 0, diff: 0, inTick: 0, ms: 0 }; by.set(r.m, s);
  s.n++; s.ms += ms; if (r.t) s.inTick++; total++;
  if (ok) { s.eq++; equal++; } else { s.diff++; if (diffs.length < 60) diffs.push({ m: r.m, a: r.a, main: r.v, replica: err ? { error: err } : v, tick: r.tick, inTick: r.t, key: r.k }); }
}
parentPort!.on('message', (msg: { t: string; id?: number; key?: string; scene?: StaticExportV1; recs?: TapRecord[] }) => {
  if (msg.t === 'scene') { scenes.set(msg.key!, msg.scene!); return; }
  if (msg.t === 'batch') {
    for (const r of msg.recs!) replay(r);
    const h = getHeapStatistics() as ReturnType<typeof getHeapStatistics> & { external_memory?: number };
    heapMax = Math.max(heapMax, h.used_heap_size); extMax = Math.max(extMax, h.external_memory ?? 0);
    return;
  }
  if (msg.t === 'status') {
    (globalThis as { gc?: () => void }).gc?.();
    const h = getHeapStatistics() as ReturnType<typeof getHeapStatistics> & { external_memory?: number }, pages = replica?.spatial.pagesInfo();
    parentPort!.postMessage({ id: msg.id, v: {
      total, equal, diff: total - equal, byMethod: Object.fromEntries([...by].map(([m, s]) => [m, { ...s, ms: +s.ms.toFixed(1) }])),
      builds, heapMB: +(h.used_heap_size / 1e6).toFixed(1), heapMaxMB: +(heapMax / 1e6).toFixed(1), externalMB: +((h.external_memory ?? 0) / 1e6).toFixed(1), externalMaxMB: +(extMax / 1e6).toFixed(1),
      rss: +(process.memoryUsage().rss / 1e6).toFixed(1), arrayBuffersMB: +(process.memoryUsage().arrayBuffers / 1e6).toFixed(1),
      offHeapMB: replica ? offHeap(replica) : null,
      pages: pages ? { rects: pages.rects.length, built: pages.built, bytes: pages.bytes } : null, ground: replica?.spatial.ground?.stats ?? null, replicaStats: replica?.stats, diffs,
    } });
  }
});
/** Off-heap bytes (typed-array buffers, each counted once) reachable from the replica's parts, in MB. */
function offHeap(r: SpatialReplica): Record<string, number> {
  const seen = new Set<ArrayBufferLike>(), visited = new Set<object>();
  const walk = (o: unknown): number => {
    if (!o || typeof o !== 'object' || visited.has(o)) return 0;
    visited.add(o);
    if (ArrayBuffer.isView(o)) { if (seen.has(o.buffer)) return 0; seen.add(o.buffer); return o.buffer.byteLength; }
    let n = 0;
    if (o instanceof Map) for (const [k, v] of o) n += walk(k) + walk(v);
    else if (o instanceof Set) for (const v of o) n += walk(v);
    else for (const k of Object.keys(o)) n += walk((o as Record<string, unknown>)[k]);
    return n;
  };
  const sp = r.spatial as unknown as Record<string, unknown>, mb = (n: number) => +(n / 1e6).toFixed(1);
  const ground = walk(sp.ground), pages = walk(sp.pages), outside = walk(sp.outside), rest = walk(sp), conn = walk((r as unknown as { conn?: unknown }).conn);
  return { ground: mb(ground), pages: mb(pages), outside: mb(outside), rest: mb(rest), conn: mb(conn), total: mb(ground + pages + outside + rest + conn) };
}
