// Mars-only desert dressing. Run: node --test apps/web/test/world-mars-desert.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EDEN_CAMP_SCENE, edenCampWorld } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import { GREEN_FIELD_SCENE } from '../../../mars/viewer/engine/scenarios/greenfield.ts';
import { campKeepClear, isMarsCamp, marsDesertLayout, MarsDesert } from '../src/WorldMarsDesert.ts';
import { WorldGeometry } from '../src/WorldGeometry.ts';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';

const camp = structuredClone(EDEN_CAMP_SCENE);
// the live camp reader grows the same ground surface (camp-expansion.ts)
const expanded: SpatialScene = { ...structuredClone(camp), bounds: [-44, -36, 44, 36], surfaces: [{ ...camp.surfaces[0], obb: { ...camp.surfaces[0].obb, half: [44, 36] } }] };
const tris = (o: THREE.Object3D) => { let n = 0; o.traverse((m) => { if (m instanceof THREE.Mesh) { const g = m.geometry as THREE.BufferGeometry, c = (g.index ? g.index.count : g.getAttribute('position').count) / 3; n += c * (m instanceof THREE.InstancedMesh ? m.count : 1); } }); return n; };
const draws = (o: THREE.Object3D) => { let n = 0; o.traverse((m) => { if (m instanceof THREE.Mesh) n++; }); return n; };

test('only the Mars camp is dressed; other worlds and grass grounds are untouched', () => {
  assert.equal(isMarsCamp(camp), true);
  assert.equal(isMarsCamp(expanded), true);
  assert.equal(isMarsCamp(GREEN_FIELD_SCENE), false);
  assert.equal(isMarsCamp(null), false);
  const names = (g: WorldGeometry) => { const out: string[] = []; g.group.traverse((o) => out.push(o.name)); return out; };
  assert.ok(names(new WorldGeometry(camp)).includes('mars desert'));
  assert.ok(!names(new WorldGeometry(camp, 'grass')).includes('mars desert'));
  assert.ok(!names(new WorldGeometry(GREEN_FIELD_SCENE)).includes('mars desert'));
});

test('nothing stands on or next to the walkable camp ground, and the layout is the same every time', () => {
  for (const scene of [camp, expanded]) {
    const keep = campKeepClear(scene), layout = marsDesertLayout(scene);
    assert.deepEqual(layout, marsDesertLayout(structuredClone(scene)), 'deterministic');
    for (const d of layout) {
      const reach = d.kind === 'container' ? 3.3 : d.kind === 'tote' ? 0.8 : d.s * 1.4;
      assert.ok(d.x < keep[0] || d.x > keep[2] || d.z < keep[1] || d.z > keep[3], `${d.kind} outside the keep-clear ground`);
      for (const s of scene.surfaces) {
        const dx = Math.abs(d.x - s.obb.c[0]) - s.obb.half[0], dz = Math.abs(d.z - s.obb.c[1]) - s.obb.half[1];
        assert.ok(Math.max(dx, dz) > reach, `${d.kind} clear of ${s.id}`);
      }
      for (const o of scene.obstacles) assert.ok(Math.hypot(d.x - o.obb.c[0], d.z - o.obb.c[1]) > 2, `${d.kind} clear of ${o.id}`);
    }
    assert.deepEqual(['container', 'shrub', 'stone', 'tote'].map((k) => layout.filter((d) => d.kind === k).length), [1, 260, 320, 3]);
  }
});

test('cost stays small: five draw calls, under 45k triangles, and everything it made is released', () => {
  const desert = new MarsDesert(expanded);
  assert.equal(draws(desert.group), 5);
  assert.ok(tris(desert.group) < 45_000, String(tris(desert.group)));
  let disposed = 0;
  desert.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.addEventListener('dispose', () => disposed++); (o.material as THREE.Material).addEventListener('dispose', () => disposed++); } });
  desert.dispose();
  assert.equal(disposed, 10);
  assert.equal(desert.group.parent, null);
});

test('material piles get a flat pad and the marked build site its corner stakes, once, and they are released', () => {
  const desert = new MarsDesert(expanded), regions = edenCampWorld().regions;
  desert.markRegions(regions);
  const marks = desert.group.getObjectByName('mars desert marks')!;
  assert.ok(marks);
  const pads = marks.getObjectByName('mars desert pile pads') as THREE.Mesh, stakes = marks.getObjectByName('mars desert site stakes') as THREE.Mesh;
  pads.geometry.computeBoundingBox();
  assert.ok(pads.geometry.boundingBox!.max.y - pads.geometry.boundingBox!.min.y < 1e-6, 'pads are flat');
  const area = Object.values(regions).filter((r) => r.kind === 'material-pile').reduce((a, r) => a + (r.polygon[2][0] - r.polygon[0][0]) * (r.polygon[2][1] - r.polygon[0][1]), 0);
  const pos = pads.geometry.getAttribute('position'), v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  let drawn = 0;
  for (let i = 0; i < pos.count; i += 3) drawn += new THREE.Triangle(v(i), v(i + 1), v(i + 2)).getArea();
  assert.ok(Math.abs(drawn - Math.abs(area)) < 1e-3, `pad area ${drawn} = pile regions ${area}`);
  stakes.geometry.computeBoundingBox();
  assert.ok(stakes.geometry.boundingBox!.max.y <= 0.7 + 1e-6);
  assert.equal(draws(desert.group), 7);
  desert.markRegions(structuredClone(regions));
  assert.equal(desert.group.getObjectByName('mars desert marks'), marks, 'same regions: nothing rebuilt');
  desert.dispose();
});
