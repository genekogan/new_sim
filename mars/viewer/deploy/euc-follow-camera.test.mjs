import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createEucFollowCamera,
  eucFollowOffset,
} from '../app/studio/euc-follow-camera.ts';

test('epicycles complete a smooth lap and favor the Chiba backdrop from every campus side', () => {
  const offset = new THREE.Vector3();
  for (const bearing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    let outward = 0,
      inward = 0,
      framed = 0;
    for (let i = 0; i < 3600; i++) {
      eucFollowOffset(i / 60, bearing, offset);
      const projection =
        offset.x * Math.cos(bearing) + offset.z * Math.sin(bearing);
      const lateral =
        -offset.x * Math.sin(bearing) + offset.z * Math.cos(bearing);
      if (Math.abs(Math.atan2(lateral, projection)) < Math.PI / 5) framed++;
      if (projection > 0) outward++;
      else inward++;
      assert.ok(Math.hypot(offset.x, offset.z) >= 7.89);
      assert.ok(Math.hypot(offset.x, offset.z) <= 10.11);
      assert.ok(offset.y >= 2.54 && offset.y <= 3.46);
    }
    assert.ok(
      outward / 3600 > 0.7,
      'Chiba must be behind the rider for most of the shot',
    );
    assert.ok(
      inward / 3600 > 0.15,
      'still make full orbits, not just side-to-side sway',
    );
    assert.ok(
      framed / 3600 > 0.59,
      'favor a close alignment with Chiba, not just the outward hemisphere',
    );
    const start = eucFollowOffset(0, bearing, new THREE.Vector3());
    assert.ok(start.distanceTo(eucFollowOffset(60, bearing, offset)) < 1e-8);
    assert.ok(
      start.distanceTo(eucFollowOffset(59.999, bearing, offset)) < 0.002,
    );
  }
});

test('entry and pause preserve the camera; frame rates converge to the same tracking pose', () => {
  const chiba = new THREE.Vector3(0, 2, 8);
  const end = [];
  for (const fps of [30, 60, 120]) {
    const follow = createEucFollowCamera();
    const rider = new THREE.Vector3(40, -0.16, 8);
    const camera = new THREE.Vector3(31, 27, 36);
    const target = new THREE.Vector3(0, 2, 8);
    follow.start(rider, chiba, camera, target);
    follow.update(0, rider, chiba, camera, target);
    assert.deepEqual(camera.toArray(), [31, 27, 36]);
    assert.deepEqual(target.toArray(), [0, 2, 8]);
    for (let i = 0; i < fps * 12; i++) {
      rider.x += 3 / fps;
      follow.update(1 / fps, rider, chiba, camera, target);
    }
    assert.ok(
      target.distanceTo(rider.clone().add(new THREE.Vector3(0, 1.6, 0))) <
        0.001,
    );
    const before = camera.clone();
    follow.update(0, rider, chiba, camera, target);
    assert.ok(camera.distanceTo(before) < 1e-8);
    end.push(camera);
  }
  assert.ok(end[0].distanceTo(end[2]) < 0.04);
});

test('crossing the bearing seam cannot whip the camera around the rider', () => {
  const follow = createEucFollowCamera();
  const rider = new THREE.Vector3(-40, 0, 0.01);
  const chiba = new THREE.Vector3();
  const camera = rider
    .clone()
    .add(eucFollowOffset(0, Math.PI, new THREE.Vector3()));
  const target = rider.clone().add(new THREE.Vector3(0, 1.6, 0));
  follow.start(rider, chiba, camera, target);
  const before = camera.clone();
  rider.z = -0.01;
  follow.update(1 / 60, rider, chiba, camera, target);
  assert.ok(camera.distanceTo(before) < 0.05);
});
