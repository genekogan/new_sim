#!/usr/bin/env node
// PARITY: the corrected sim.mars.college source build (Mars viewer repo, branch marsland/gene-corrections-20261011 @ 7d9688f,
// = layers 1+2 of Gene's target) moved some V3 pieces after V3 was exported. Read a dump of that build's live scene
// (team/lanes/marsland-shots/parity/dump-ref.mjs) and write the world matrices of the moved V3 nodes that are its deliberate
// fixes, so build.mjs places them where the reference has them:
//   - the kitchen prep table with its shelf, bucket, stock pot, bowls and boards centred at n .65 (was 2.035: rack
//     upright rack_member-0349 stood through its worktop);
//   - the Mimos papasan turned about the vertical (V3 tipped it, like the rug);
//   - the Mimos clothing rack at n −.435 (its uprights and garments stood through the turned tea table).
// Not taken (see team/lanes/marsland-parity.md): the red sofa #12, cream recliner #14 and west coffee table, which that
// build leaves at the recipe's main-south spot because its owner-layout lookup of the `mimos-open-l` group hits a retained
// raw-floor bearing carrying the same assembly id (so V3's north-main coffee grouping stands); the study corner and
// whiteboard 0.9 m west (there the whiteboard covers the rear alcove doorway); the raised-entry treads (V3's authored access).
//   node tools/god-skill/scripts/mars-two/ref-delta.mjs <ref-dump.json> <v3-dump.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './v3.mjs';
const [refFile, v3File] = process.argv.slice(2);
const ref = JSON.parse(readFileSync(refFile, 'utf8')).rows, v3 = JSON.parse(readFileSync(v3File, 'utf8'));
const TAKE = [
  ['prep table', (r) => r.asm === 'kitchen-details' && /^(commissary steel |kitchen prep |orange utility bucket|stored stock pot)/.test(r.kind ?? '')],
  ['papasan', (r) => /^Mimos papasan/.test(r.kind ?? '')],
  ['clothing rack', (r) => /^Mimos (southeast clothing|clothing rack|photographed clothing rail|source hanging garment|garment hanger)/.test(r.kind ?? '')],
];
const key = (r) => `${r.name}|${r.comp}`;
const R = new Map(ref.filter((r) => r.vis).map((r) => [key(r), r]));
const out = {};
for (const v of v3) {
  const t = TAKE.find(([, f]) => f(v)); if (!t) continue;
  const r = R.get(key(v)); if (!r) throw new Error(`no reference node for ${key(v)}`);
  if (Math.max(...r.m.map((x, q) => Math.abs(x - v.m[q]))) < 1e-3) continue;
  out[key(v)] = { why: t[0], m: r.m };
}
const file = join(ROOT, 'tools/god-skill/scripts/mars-two/ref-7d9688f-delta.json');
writeFileSync(file, JSON.stringify({ schema: 'mars-v3-delta/1', source: 'Mars viewer marsland/gene-corrections-20261011 @ 7d9688f, live scene dump', nodes: out }, null, 1) + '\n');
console.log(`${Object.keys(out).length} nodes → ${file}`, Object.entries(Object.values(out).reduce((a, x) => ((a[x.why] = (a[x.why] ?? 0) + 1), a), {})));
