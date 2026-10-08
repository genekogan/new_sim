import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {centreGround} from '../src/WorldRtsCamera.ts';

test('VF2: the pivot is the ground under the screen centre (drawn terrain, else y = 0)', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, .1, 2000);
  camera.position.set(0, 10, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const flat = centreGround(camera, null)!;
  assert.ok(flat.distanceTo(new THREE.Vector3(0, 0, 0)) < .2, JSON.stringify(flat));
  // A raised terrain plane: the pivot lands on it, nearer than the y = 0 point.
  const scene = new THREE.Scene(), hill = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  hill.position.y = 2; scene.add(hill); scene.updateMatrixWorld(true);
  const raised = centreGround(camera, scene)!;
  assert.ok(Math.abs(raised.y - 2) < .05 && raised.z > 1.5, JSON.stringify(raised));
  camera.lookAt(0, 10, -50); camera.updateMatrixWorld();
  assert.equal(centreGround(camera, null), null, 'looking at the horizon has no pivot on the ground');
});
