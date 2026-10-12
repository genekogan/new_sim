// MARSLAND-FORK: the old-world Mars fork's corrected campus, its 2026 bearing and its drone surroundings (layer 3).
//   node --test apps/web/src/mars-fork.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
(globalThis as { location?: unknown }).location ??= new URL('http://127.0.0.1/worlds/w/mars/');   // world-path.ts reads the page URL
const { backdropCandidates, forkInitialAssets, MARS_FORK_BACKDROP, MARS_2026_NORTH_OFFSET, marsFork } = await import('./mars-fork.ts');
const { FRAME, toForkXZ, forkLandOps, forkLandModel, createForkLand } = await import('./WorldMarsForkLand.ts');
import { sunDirectionVector } from '../../../mars/viewer/engine/env/sun.ts';

const CAMPUS = '/browser/campus.glb?v=20260922b', BLOB64 = '/blobs/assets/64/64b8838cdc76a048843ab293f3d74ad985293ad621ea7587e092098117bd1034.glb';

test('fork: the root build (no base) is never the fork, even at /w/mars', () => { assert.equal(marsFork, false); });

test('backdrop: only the fork tries its corrected campus first; the root /w/mars is unchanged', () => {
  assert.deepEqual(backdropCandidates(CAMPUS, BLOB64, false), [BLOB64, CAMPUS]);
  assert.deepEqual(backdropCandidates(CAMPUS, BLOB64, true), [MARS_FORK_BACKDROP.blob, MARS_FORK_BACKDROP.local, BLOB64, CAMPUS]);
  assert.deepEqual(backdropCandidates('/x.glb', undefined, true), ['/x.glb']);
  assert.match(MARS_FORK_BACKDROP.blob, new RegExp(`/blobs/assets/${MARS_FORK_BACKDROP.sha256.slice(0, 2)}/${MARS_FORK_BACKDROP.sha256}\\.glb$`));
  const rows = { [BLOB64]: 41803240, '/modular/environment/animated-woman.glb': 1917076 };
  assert.deepEqual(forkInitialAssets(rows, false), rows);
  assert.deepEqual(forkInitialAssets(rows, true), { '/modular/environment/animated-woman.glb': 1917076, [MARS_FORK_BACKDROP.blob]: MARS_FORK_BACKDROP.bytes });
});

test('frame: mars-two → fork is one rigid turn + shift, and its compass agrees with the fork sun (−65)', () => {
  const g = new THREE.Object3D(); g.rotation.y = FRAME.yaw; g.position.set(FRAME.shift[0], 0, FRAME.shift[1]); g.updateMatrixWorld(true);
  for (const [x, z] of [[0, 0], [-170, -104], [600, -600], [-11.1, -30.2]]) {
    const v = new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld), [fx, fz] = toForkXZ(x, z);
    assert.ok(Math.abs(v.x - fx) < 1e-6 && Math.abs(v.z - fz) < 1e-6, `${x},${z}`);
  }
  // mars-two compass: north −z, east +x. In the fork, compass azimuth A points along the sun's (x, z) at the fork offset.
  for (const A of [0, 90, 180, 270]) {
    const m2 = [Math.sin(A * Math.PI / 180), -Math.cos(A * Math.PI / 180)], turned = new THREE.Vector3(m2[0], 0, m2[1]).applyEuler(new THREE.Euler(0, FRAME.yaw, 0));
    const s = sunDirectionVector(0, A, MARS_2026_NORTH_OFFSET), ang = Math.acos(Math.max(-1, Math.min(1, turned.x * s[0] + turned.z * s[2]))) * 180 / Math.PI;
    assert.ok(ang < 0.5, `azimuth ${A}: ${ang.toFixed(2)}° apart`);
  }
  // the campus lands where the backdrop has it: Mimos origin (mars-two (0, −30)) = V3 O + [40, −30]
  const [mx, mz] = toForkXZ(0, -30); assert.ok(Math.abs(mx - 42.05645) < 1e-9 && Math.abs(mz + 38.92635) < 1e-9);
});

test('land: the template land batch is accepted; the panorama bearings turn by the fork north, nothing else changes', () => {
  const ops = forkLandOps(), pano = ops.find((o) => o.def === 'core/panorama@1') as { params: { ranges: { from: number }[]; water: { from: number } } };
  const raw = forkLandOps(undefined, 0).find((o) => o.def === 'core/panorama@1') as typeof pano;
  assert.equal(pano.params.ranges[0].from, raw.params.ranges[0].from + MARS_2026_NORTH_OFFSET);
  assert.equal(pano.params.water.from, raw.params.water.from + MARS_2026_NORTH_OFFSET);
  const w = forkLandModel();
  const defs = [...w.entities.values()].map((e) => e.def).sort();
  assert.deepEqual([...new Set(defs)], ['core-desert-scrub@1', 'core-far-land@1', 'core-panorama@1', 'core-tire-ring@1', 'core-tire-tracks@1']);
});

test('land: every land entity draws; the old view\'s cliff ring, outside sand and flat camp floor are hidden', () => {
  const land = createForkLand(0);
  assert.equal(land.stats.drawn.length, land.stats.entities);
  assert.ok(land.stats.tris > 20000 && land.stats.tris < 800000, `tris ${land.stats.tris}`);   // instanced scrub/tyres counted per instance
  const pano = land.group.children.find((o) => o.name === 'panorama'); assert.ok(pano, 'the panorama hangs off the untransformed group (its shader uses world axes)');
  assert.equal(land.group.userData.edenSkyPalette, 'mars-desert');
  const a = land.atmosphere(); assert.equal(a.weather?.kind, 'clear'); assert.equal(a.indoors(0, 0, 0), false);
  const camp = new THREE.Group(), floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10)), wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), ridge = new THREE.Mesh(), outside = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; ridge.name = 'mars desert ridge'; outside.name = 'outside-ground'; outside.rotation.x = -Math.PI / 2;
  const desert = new THREE.Group(); desert.add(ridge); camp.add(floor, wall, desert, outside);
  assert.equal(land.dress(camp), 3);
  assert.ok(!floor.visible && !ridge.visible && !outside.visible && wall.visible);
});
