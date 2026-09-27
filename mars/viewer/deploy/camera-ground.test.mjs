import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { keepCameraAboveGround } from '../app/studio/camera-ground.ts';

test('orbiting below the ground and panning the target underground are constrained', () => {
  const camera = new THREE.PerspectiveCamera(43, 2, 0.05, 1500),
    target = new THREE.Vector3(4, -12, 5);
  camera.position.set(8, -5, 10);
  keepCameraAboveGround(camera, target);
  assert.ok(camera.position.y >= 0.04 - 1e-9);
  assert.equal(target.y, -0.16);
  assert.equal(camera.position.x, 8);
  assert.equal(camera.position.z, 10);
  const expected = target.clone().sub(camera.position).normalize();
  assert.ok(
    camera.getWorldDirection(new THREE.Vector3()).distanceTo(expected) < 1e-6,
  );
});
test('ordinary above-ground views and upward looking remain unchanged', () => {
  const camera = new THREE.PerspectiveCamera(),
    target = new THREE.Vector3(0, 8, 0);
  camera.position.set(5, 2, 5);
  camera.lookAt(target);
  const before = camera.quaternion.clone();
  keepCameraAboveGround(camera, target);
  assert.equal(camera.position.y, 2);
  assert.ok(camera.quaternion.angleTo(before) < 1e-6);
});
test('walking height correction preserves mouse/arrow look direction', () => {
  const camera = new THREE.PerspectiveCamera(70);
  camera.position.y = -30;
  camera.rotation.set(0.8, 0.6, 0, 'YXZ');
  const before = camera.quaternion.clone();
  keepCameraAboveGround(camera);
  assert.ok(camera.position.y > -0.16);
  assert.ok(camera.quaternion.angleTo(before) < 1e-6);
});
test('near-plane corners remain above terrain at wide aspects and steep camera angles', () => {
  for (const aspect of [0.5, 2, 5])
    for (const pitch of [-1.4, 0, 1.4]) {
      const camera = new THREE.PerspectiveCamera(100, aspect, 0.3, 1500);
      camera.position.set(0, -5, 0);
      camera.rotation.set(pitch, 0.4, 0.2, 'YXZ');
      keepCameraAboveGround(camera);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      for (const x of [-1, 1])
        for (const y of [-1, 1]) {
          const corner = new THREE.Vector3(x, y, -1).unproject(camera);
          assert.ok(corner.y > -0.16);
        }
    }
});
