import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  motionPose,
  perimeter,
  eucPose,
  hourAt,
  simTime,
} from '../simulation/shared.ts';
test('mirrored body, legs and feet contain both left and right halves', async () => {
  for (const name of ['casual', 'punk', 'woman']) {
    const bytes = await readFile(
        `public/modular/environment/animated-${name}.glb`,
      ),
      g = await new GLTFLoader().parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        '',
      );
    let checked = 0;
    g.scene.traverse((o) => {
      if (!o.isSkinnedMesh || !/body|legs|feet/i.test(o.name + o.parent.name))
        return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      assert.ok(
        b.min.x < -0.02 && b.max.x > 0.02,
        `${name}/${o.name} must extend on both sides of the mirror plane`,
      );
      const ratio = Math.abs(b.min.x / b.max.x);
      assert.ok(ratio > 0.65 && ratio < 1.5, `${name}/${o.name} is asymmetric`);
      checked++;
    });
    assert.ok(checked >= 2, name);
  }
});
test('EUC asset has one named spinning wheel and two side pedals', async () => {
  const bytes = await readFile(
      'public/modular/environment/electric-unicycle.glb',
    ),
    g = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
  let wheels = 0,
    pedals = 0;
  g.scene.traverse((o) => {
    if (o.name === 'EUC_Wheel') wheels++;
    if (o.name.startsWith('EUC_side_pedal')) pedals++;
  });
  assert.equal(wheels, 1);
  assert.equal(pedals, 2);
  const b = new THREE.Box3().setFromObject(g.scene);
  assert.ok(b.max.y > 0.6 && b.max.y < 0.8);
  assert.ok(Math.abs(b.min.y) < 0.005);
});
test('whole-campus EUC circuit encloses bounds, is continuous and closes', () => {
  const bounds = [
      [-179, -3, -136],
      [86, 8, 59],
    ],
    path = perimeter(bounds);
  assert.deepEqual(path[0], path.at(-1));
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    for (let t = 0; t <= 1; t += 0.01) {
      const x = a[0] + (b[0] - a[0]) * t,
        z = a[2] + (b[2] - a[2]) * t;
      assert.ok(
        x < bounds[0][0] - 3 ||
          x > bounds[1][0] + 3 ||
          z < bounds[0][2] - 3 ||
          z > bounds[1][2] + 3,
        'must remain outside footprint',
      );
    }
  }
});
test('rider heading turns smoothly across the small rounded-corner segments', () => {
  const path = perimeter([
    [-179, -3, -136],
    [86, 8, 59],
  ]);
  const route = {
    path,
    started: 0,
    speed: 1,
    loop: true,
    yaw: 0,
    activity: 'idle',
  };
  const angleChange = (a, b) =>
    Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  let rawPeak = 0;
  let smoothPeak = 0;
  let previousRaw;
  let previousSmooth;
  // Travel through an entire rounded corner at 3 m/s and 60 fps.
  for (let distance = 0; distance < 20; distance += 3 / 60) {
    const raw = motionPose(route, distance * 1000);
    const smooth = eucPose(path, distance, 0);
    assert.deepEqual(smooth.position, raw.position);
    if (previousRaw !== undefined) {
      rawPeak = Math.max(rawPeak, angleChange(raw.yaw, previousRaw));
      smoothPeak = Math.max(
        smoothPeak,
        angleChange(smooth.yaw, previousSmooth),
      );
    }
    previousRaw = raw.yaw;
    previousSmooth = smooth.yaw;
  }
  assert.ok(rawPeak > (7 * Math.PI) / 180, 'fixture includes the sharp turn');
  assert.ok(smoothPeak < (1 * Math.PI) / 180, 'no visible heading snap');
});
test('authoritative motion arrives, loops and respects paused time', () => {
  const m = {
    path: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    started: 1000,
    speed: 1,
    loop: false,
    yaw: 0,
    activity: 'idle',
  };
  assert.deepEqual(motionPose(m, 6000).position, [5, 0, 0]);
  assert.equal(motionPose(m, 12000).moving, false);
  m.loop = true;
  assert.equal(motionPose(m, 12000).position[0], 1);
  const s = {
    environment: { hour: 16, cycle: true },
    epoch: 1000,
    pausedAt: 6000,
  };
  assert.equal(hourAt(s, 99999), 16.25);
  assert.equal(simTime(s, 99999), 6000);
});
