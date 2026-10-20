#!/usr/bin/env node
// Eden 2026 hills ring (lane E2C, 2026-10-20): old Eden's far relief -- a continuous ring of hills rising toward the world's
// north, west and east edges (eden-regions/terrain.ts) -- as seven ranges (core/mountain with a path shape = a ridge) along
// the edge of Eden 2026's ground, outside every occupied district. They replace the two isolated cone backdrops
// (land-northwest-backdrop, land-northeast-backdrop), which read as volcanoes from the commons. The alpine backdrop (the
// cable car's summit) and every hill, path, district and building stay where they are: no placed thing's ground moves by
// more than 1 m (east-hills-turbine-6, +0.9 m); the north-west spring hill's flank drops 2.6 m where the cone's tail was.
// Gaps between the ranges are saddles, not spikes. Crests 45-100 m (old Eden: 60-140 m at the same places, partly beyond
// Eden 2026's 500 m extent). The crests sit 30-80 m inside the extent so the ground ends at most ~30 m up (from far out
// the cut face at the world's edge stays small); measured with team/scratch/t4/e2c/ring.ts.
// Edits worlds/templates/eden-2026.json in place (idempotent); the live upgrade spec is the template diff:
//   node worlds/patches/eden-2026-hills-ring-20261020/build.mjs
//   node tools/template-upgrade/upgrade.mjs spec --old <template before> --new worlds/templates/eden-2026.json \
//     --id eden-2026-hills-ring-20261020 --world eden-2026 --from <rev> --to <rev> --out worlds/patches/eden-2026-hills-ring-20261020/spec.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
const TPL = `${root}/worlds/templates/eden-2026.json`;
const DROP = new Set(['land-northwest-backdrop', 'land-northeast-backdrop']);
const range = (name, path, height, radius, peak) => ({ op: 'place', def: 'core/mountain@1', name: `land-${name}`, shape: { path }, params: { height, radius, peak } });
// [x, z] in the original Eden frame (+x east, -z north), metres; radius = half-width of the range's foot.
const RING = [
  range('ring-west-range', [[-445, 30], [-450, -120]], 50, 100, 1.2),
  range('ring-northwest-range', [[-420, -200], [-395, -325], [-325, -405]], 95, 140, 1.1),
  range('ring-north-west-range', [[-230, -430], [-120, -438]], 85, 110, 1.1),
  range('ring-north-range', [[-20, -455], [60, -455]], 60, 85, 1.2),
  range('ring-north-east-range', [[160, -430], [260, -425]], 95, 115, 1.1),
  range('ring-northeast-range', [[370, -400], [420, -320], [420, -210]], 100, 120, 1.1),
  range('ring-east-range', [[470, -90], [470, 20]], 45, 70, 1.2),
];

const tpl = JSON.parse(readFileSync(TPL, 'utf8'));
let removed = 0, at = -1, batch = null;
for (const b of tpl.batches) {
  const before = b.ops.length;
  b.ops = b.ops.filter((o) => !(o.op === 'place' && (DROP.has(o.name) || /^land-ring-/.test(o.name ?? ''))));
  removed += before - b.ops.length;
  const i = b.ops.findIndex((o) => o.op === 'place' && o.name === 'land-alpine-backdrop');
  if (i >= 0) { batch = b; at = i; }
}
if (!batch) throw new Error('land-alpine-backdrop not found in the template');
batch.ops.splice(at + 1, 0, ...RING);
writeFileSync(TPL, JSON.stringify(tpl, null, 2) + '\n');
console.log(JSON.stringify({ template: TPL, batch: batch.note, removed, added: RING.length }));
