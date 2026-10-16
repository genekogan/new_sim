// RL7 overhead bench: the same god requests against two in-process worlds, trace on and trace off (GOD_TRACE=0),
// interleaved so machine load hits both alike. No ports, no network.
//   node apps/server/src/god/trace-bench.ts [N=2000]
import { replayWorld } from './replay-world.ts';

const N = Number(process.argv[2] ?? 2000);
const make = (env: string) => { const prev = process.env.GOD_TRACE; process.env.GOD_TRACE = env; try { return replayWorld({ schema: 'genesis/1', batches: [] }); } finally { if (prev === undefined) delete process.env.GOD_TRACE; else process.env.GOD_TRACE = prev; } };
const on = make('1'), off = make('0');
const send = async (w: typeof on, path: string, body?: unknown) => {
  const t0 = performance.now();
  const r = await w.app.request(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  await r.arrayBuffer(); return performance.now() - t0;
};
for (const w of [on, off]) await send(w, '/v1/god/act', { ops: [{ op: 'place', def: 'core/bench@1', p: [0, 0], name: 'taken' }] });
const cases: [string, string, unknown?][] = [
  ['GET builds', '/v1/god/builds'],
  ['POST dryrun (accepted)', '/v1/god/dryrun', { ops: [{ op: 'place', def: 'core/bench@1', p: [20, 20], name: 'probe' }] }],
  ['POST act (refused, loops)', '/v1/god/act', { ops: [{ op: 'place', def: 'core/bench@1', p: [0, 0], name: 'taken' }] }],
  ['GET builds (a loop is live)', '/v1/god/builds'],
];
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { median: q(0.5) * 1000, p90: q(0.9) * 1000, mean: xs.reduce((a, b) => a + b, 0) / xs.length * 1000 }; };
const out: Record<string, unknown> = { n: N };
for (const [name, path, body] of cases) {
  const a: number[] = [], b: number[] = [];
  for (let i = 0; i < 50; i++) { await send(on, path, body); await send(off, path, body); }
  for (let i = 0; i < N; i++) { if (i % 2) { a.push(await send(on, path, body)); b.push(await send(off, path, body)); } else { b.push(await send(off, path, body)); a.push(await send(on, path, body)); } }
  const sa = stats(a), sb = stats(b), r = (x: number) => Math.round(x * 10) / 10;
  out[name] = { traceOn: { medianUs: r(sa.median), p90Us: r(sa.p90), meanUs: r(sa.mean) }, traceOff: { medianUs: r(sb.median), p90Us: r(sb.p90), meanUs: r(sb.mean) }, medianDeltaUs: r(sa.median - sb.median), medianDeltaPct: r(100 * (sa.median - sb.median) / sb.median) };
}
out.ring = on.god.trace.summary();
console.log(JSON.stringify(out, null, 1));
on.close(); off.close();
