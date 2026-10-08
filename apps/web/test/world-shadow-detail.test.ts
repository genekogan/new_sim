import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldShadowDetail,SHADOW_DETAIL} from '../src/WorldShadowDetail.ts';

test('shadow pass skips sub-texel stems and small far casters, only around the draw', () => {
  const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial();
  const mk = (name: string, r: number, x: number) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), mat); m.name = name; m.position.set(x, 0, 0); m.castShadow = true; root.add(m); return m; };
  const stems = mk('Forest and path fern edge / curved stems', 3, 5), blades = mk('Forest and path fern edge / two-sided leaf blades', 3, 5);
  const nearChair = mk('chair', .5, 30), farChair = mk('chair', .5, 80), shed = mk('shed', 5, 150), farShed = mk('shed', 5, 200), hall = mk('hall', 9, 600);
  const quiet = mk('no shadow', .5, 10); quiet.castShadow = false;
  const sd = new WorldShadowDetail(root);
  sd.apply(new THREE.Vector3(0, 0, 0));
  assert.equal(stems.castShadow, false, 'stems never cast'); assert.equal(blades.castShadow, true, 'leaf blades keep the clump shadow');
  assert.equal(nearChair.castShadow, true); assert.equal(farChair.castShadow, false, `chair beyond ${SHADOW_DETAIL.near + SHADOW_DETAIL.perMetre * .5} m`);
  assert.equal(shed.castShadow, true); assert.equal(farShed.castShadow, false); assert.equal(hall.castShadow, true, 'big casters always cast');
  assert.equal(sd.skipped, 3);
  sd.restore();
  for (const m of [stems, blades, nearChair, farChair, shed, farShed, hall]) assert.equal(m.castShadow, true, 'restored after the draw');
  assert.equal(quiet.castShadow, false, 'never turns a shadow on');
  // moving the camera brings the far chair's shadow back
  sd.apply(new THREE.Vector3(80, 0, 0)); assert.equal(farChair.castShadow, true); assert.equal(nearChair.castShadow, true); sd.restore();
  sd.dispose();
});
