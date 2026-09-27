import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CampusPaths,
  daylightAt,
  GROUND,
} from '../app/studio/ambience-math.ts';

test('daylight crosses dawn/dusk smoothly and repeats at midnight', () => {
  assert.equal(daylightAt(12).daylight, 1);
  assert.equal(daylightAt(0).night, 1);
  assert.ok(daylightAt(18).warmth > 0.9);
  assert.ok(daylightAt(18).direction.y < 0.01);
  assert.ok(
    daylightAt(0).direction.distanceTo(daylightAt(24).direction) < 1e-10,
  );
  for (let h = 0; h < 24; h += 0.05) {
    const a = daylightAt(h),
      b = daylightAt(h + 0.05);
    assert.ok(Math.abs(a.daylight - b.daylight) < 0.07);
    assert.ok(a.direction.toArray().every(Number.isFinite));
  }
});
test('walking routes stay clear of walls, fire ring and diagonal corners', () => {
  const obstacles = [
    new THREE.Box3(new THREE.Vector3(-1, 0, -10), new THREE.Vector3(1, 4, 10)),
    new THREE.Box3(new THREE.Vector3(5, -0.2, 3), new THREE.Vector3(7, 2, 5)),
  ];
  const nav = new CampusPaths(obstacles),
    start = nav.nearest(new THREE.Vector3(-5, 0, 0));
  for (let seed = 1; seed < 300; seed += 3) {
    const route = nav.route(start, seed);
    assert.ok(route.length > 1);
    route.forEach((id, i) => {
      assert.equal(nav.blocked[id], 0);
      if (i) assert.ok(nav.neighbors(route[i - 1]).includes(id));
      assert.equal(nav.point(id).y, GROUND);
    });
  }
});
test('overhead roofs allow paths but moved ground-level structures block them', () => {
  const roof = new THREE.Box3(
    new THREE.Vector3(-10, 3, -10),
    new THREE.Vector3(10, 4, 10),
  );
  const open = new CampusPaths([roof]);
  assert.ok(open.nearest(new THREE.Vector3(0, 0, 0), 0.5) >= 0);
  roof.translate(new THREE.Vector3(0, -3, 0));
  const closed = new CampusPaths([roof]);
  assert.equal(closed.nearest(new THREE.Vector3(0, 0, 0), 6), -1);
});
test('enclosed or invalid starts have no route', () => {
  const nav = new CampusPaths([
    new THREE.Box3(
      new THREE.Vector3(-60, -1, -60),
      new THREE.Vector3(60, 5, 60),
    ),
  ]);
  assert.deepEqual(nav.route(-1, 12), []);
  assert.deepEqual(nav.route(600, 12), []);
});

test('all three visitor assets have working skeletal walk and idle clips', async () => {
  const { readFile } = await import('node:fs/promises');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  for (const name of ['casual', 'punk', 'woman']) {
    const bytes = await readFile(
      new URL(
        `../public/modular/environment/animated-${name}.glb`,
        import.meta.url,
      ),
    );
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    let skinned = 0;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) skinned++;
    });
    assert.ok(skinned > 0);
    const mixer = new THREE.AnimationMixer(gltf.scene),
      clip = THREE.AnimationClip.findByName(gltf.animations, 'Walk');
    assert.ok(clip.duration > 1);
    assert.ok(THREE.AnimationClip.findByName(gltf.animations, 'Idle'));
    mixer.clipAction(clip).play();
    mixer.update(0.1);
    gltf.scene.updateMatrixWorld(true);
    const bones = [];
    gltf.scene.traverse((o) => {
      if (o.isBone) bones.push(o);
    });
    const poses = bones.map((o) => o.quaternion.clone());
    mixer.update(0.3);
    assert.ok(
      bones.some((o, i) => o.quaternion.angleTo(poses[i]) > 0.1),
      'limbs must move during walking',
    );
    const b = new THREE.Box3().setFromObject(gltf.scene);
    assert.ok(Number.isFinite(b.max.y - b.min.y));
    mixer.stopAllAction();
  }
});
