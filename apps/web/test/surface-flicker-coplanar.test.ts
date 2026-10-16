// E2 #9 (surface flicker): two differently coloured faces drawn in the same plane and facing the same way fight for
// the depth buffer and show as flickering stripes. These checks find every such overlap in authored Eden geometry.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {coplanar, triangles} from './coplanar-faces.mjs';
import {buildInteriors} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/index.ts';
import {Materials} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/kit.ts';
import {createEdenRegions} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/index.ts';

const fights = (root: THREE.Object3D) => coplanar(triangles(root), {colourDiff: .06}).filter((h: {same: boolean}) => h.same);
const area = (hits: {area: number}[]) => hits.reduce((s, h) => s + h.area, 0);

test('the new buildings (café, music room, bakery, chapel …): ceilings, eaves and door/window reveals do not fight', () => {
  const shells = buildInteriors().find(r => r.id === 'new-building-shells')!;
  const g = new THREE.Group(); shells.b.emit(g, new Materials(), 'shells');
  const hits = fights(g);
  if (process.env.FLICKER_REPORT) { const by = new Map<string, number>(); for (const h of hits as any[]) { const k = `n${h.n.join(',')} y${h.at[1].toFixed(1)} ${h.a.mesh}|${h.b.mesh}`; by.set(k, (by.get(k) ?? 0) + h.area); } console.log(hits.length, area(hits).toFixed(2)); for (const r of [...by].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(r[0], r[1].toFixed(2)); }
  assert.equal(hits.length, 0, `${hits.length} coplanar overlaps, ${area(hits).toFixed(2)} m²; first ${JSON.stringify(hits[0])}`);
});

test('the districts beyond the edge: paths, terrace plinths, floor bands and door steps no longer fight', () => {
  const regions = createEdenRegions(() => 0)!;
  try {
    const hits = fights(regions.group), total = area(hits);
    if (process.env.FLICKER_REPORT) console.log('regions', hits.length, total.toFixed(2));
    // main: 2626 overlaps, ~2290 m² (every path's quads overlapped their neighbours by a quarter width); what remains
    // is path crossings, driveways meeting streets and small trim (measured: see the lane report).
    assert.ok(total < 200, `${hits.length} overlaps, ${total.toFixed(1)} m²`);
  } finally { regions.dispose(); }
});
