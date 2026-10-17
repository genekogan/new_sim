// Eden 2026 memory probe (lane L1): boots Eden 2026 in process (fake minds), runs one resident's first capabilities and
// WALKS walks, and prints one JSON line per step: RSS / peak RSS (Linux /proc), V8 heap, ArrayBuffers, after a full GC.
// Run it as its own process so allocator settings (MALLOC_* env) apply:  node --expose-gc apps/server/test/eden-memory-probe.ts
import { readFileSync } from 'node:fs';
import { accept } from './native-owner-fixture.ts';
import { bootEden, timed } from './eden-capabilities-timing.ts';

const mb = (n: number) => Math.round(n / 1048576);
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const proc = () => { try { const s = readFileSync('/proc/self/status', 'utf8'); const kb = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(s)?.[1] ?? 0); return { rss: Math.round(kb('VmRSS') / 1024), hwm: Math.round(kb('VmHWM') / 1024) }; } catch { return { rss: mb(process.memoryUsage().rss), hwm: 0 }; } };
const at = (step: string, extra: Record<string, unknown> = {}) => { gc(); gc(); const m = process.memoryUsage(); console.log(JSON.stringify({ step, ...proc(), heap: mb(m.heapUsed), heapTotal: mb(m.heapTotal), ab: mb(m.arrayBuffers), ...extra })); };

const w = await bootEden();
at('booted');
const c = timed(() => w.edge.capabilities(w.soul)); at('first-capabilities', { ms: Math.round(c.ms) });
const walks = c.value.filter((x: { verb: string; available?: boolean; target?: { kind?: string } }) => x.verb === 'walk' && x.available && x.target?.kind === 'place');
const n = Number(process.env.WALKS ?? 3);
for (let k = 0; k < n; k++) {
  const target = walks[(k * 37) % walks.length];
  await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: target.id })));
  await w.settle(400);
  const c2 = timed(() => w.edge.capabilities(w.soul)); at(`walk-${k + 1}`, { target: target.id, ms: Math.round(c2.ms) });
}
w.close();
process.exit(0);
