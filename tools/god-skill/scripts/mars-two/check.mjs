#!/usr/bin/env node
// Apply worlds/templates/mars-two.json op by op in memory (the compiler the server runs, the repo's core assets) and
// report every refusal at once. Exit 1 if any op is refused.
//   node --experimental-strip-types tools/god-skill/scripts/mars-two/check.mjs [template]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './v3.mjs';
const { CORE_KIT, WorldModel, applyBatch } = await import(join(ROOT, 'packages/world-compiler/src/index.ts'));
const { AssetStore } = await import(join(ROOT, 'apps/server/src/god/assets.ts'));
const T = JSON.parse(readFileSync(process.argv[2] ?? join(ROOT, 'worlds/templates/mars-two.json'), 'utf8'));
const assets = new AssetStore({ dir: '/tmp/mars-two-check-assets' });
const w = new WorldModel({ constants: { ground: 'land', extent: 1000, ...T.constants }, seed: 'check', assets: assets.lookup });
for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
let bad = 0, n = 0;
for (const b of T.batches) for (const op of b.ops) {
  n++;
  const r = applyBatch(w, { ops: [op] }, 'god', n);
  if (!r.result.accepted) { bad++; console.log(`✖ ${b.group} ${op.name}: ${JSON.stringify(r.result.failures).slice(0, 300)}`); }
}
console.log(`${n - bad}/${n} ops accepted`);
process.exit(bad ? 1 : 0);
