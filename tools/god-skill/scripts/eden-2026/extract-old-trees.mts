#!/usr/bin/env node
// One-off source extraction (lane E-look, 2026-10-17): the tree positions old /w/eden drew as viewer-only scenery —
// eden-regions' district and far-forest trees, and the expansion planting's forests — written to old-trees.json so the
// eden-2026 genesis can plant woodland where old Eden had trees. Run: node tools/god-skill/scripts/eden-2026/extract-old-trees.mts
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const root = new URL('../../../../', import.meta.url).pathname, V = root + 'mars/viewer/';
const THREE = await import(createRequire(V + 'package.json').resolve('three'));
const C = V + 'app/engine-view/content/';
const { createEdenRegions } = await import(C + 'assets/eden-regions/index.ts');
const { edenExpansionPlanting } = await import(C + 'environment/eden-expansion-landscape/planting.mjs');
const trees: [string, number, number, string?, number?][] = [];
const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
createEdenRegions(() => 0)?.group.traverse((o: any) => {
  if (!o.isInstancedMesh || !/canopy foliage/.test(o.name)) return;
  const kind = o.name.replace(/^Regions | canopy foliage| far/g, ''), far = /far forests/.test(o.parent?.name ?? '');
  // district trees (authored rows, squares, gardens) are marked 'set'; far forests are free scatter
  for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.decompose(p, q, s); trees.push([kind, +p.x.toFixed(1), +p.z.toFixed(1), far ? 'far' : 'set', +s.x.toFixed(2)]); }
});
const pl = edenExpansionPlanting();
for (const t of pl.plants) if (/tree|conifer/.test(t.kind)) trees.push([t.kind === 'conifer' ? 'conifer' : 'round', +t.p[0].toFixed(1), +t.p[2].toFixed(1)]);
for (const t of pl.special.birch) trees.push(['birch', +t.p[0].toFixed(1), +t.p[2].toFixed(1)]);
writeFileSync(new URL('./old-trees.json', import.meta.url), JSON.stringify({ source: 'eden-regions/index.ts + eden-expansion-landscape/planting.mjs (old /w/eden viewer scenery)', trees }) + '\n');
console.log('old trees', trees.length);
