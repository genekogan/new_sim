// E-life: Eden 2026's memory with one resident (eden2 headroom: the sim-worlds unit has MemoryHigh 5 GiB for every
// /worlds world). Reports RSS / heap / ArrayBuffers after boot, the first capabilities and three walks, after a GC; the
// ceiling catches a blow-up. Linux numbers (Modal) are the ones that matter: macOS keeps freed blocks resident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { accept } from '../test/native-owner-fixture.ts';
import { bootEden, timed } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json';
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const mb = (n: number) => Math.round(n / 1048576);
const RSS_CEILING_MB = 3000;

test('Eden 2026: memory with one resident stays bounded (first capabilities and three walks)', { timeout: 900_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const rows: string[] = [];
  const at = (label: string) => { gc(); const m = process.memoryUsage(); rows.push(`${label}: rss ${mb(m.rss)} MB, heap ${mb(m.heapUsed)} MB, arrayBuffers ${mb(m.arrayBuffers)} MB`); return m; };
  at('booted');
  const c = timed(() => w.edge.capabilities(w.soul)); at(`first capabilities (${Math.round(c.ms)} ms)`);
  const walks = c.value.filter((x) => x.verb === 'walk' && x.available && x.target?.kind === 'place');
  let last = process.memoryUsage();
  for (let k = 0; k < 3; k++) {
    const target = walks[(k * 37) % walks.length];
    await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: target.id })));
    await w.settle(400);
    const c2 = timed(() => w.edge.capabilities(w.soul)); last = at(`walk ${k + 1} ${target.id} (capabilities ${Math.round(c2.ms)} ms)`);
  }
  for (const r of rows) t.diagnostic(r);
  assert.ok(mb(last.rss) < RSS_CEILING_MB, rows.join('\n'));
});
