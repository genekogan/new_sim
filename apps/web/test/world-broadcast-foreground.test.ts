import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldBroadcast } from '../src/WorldBroadcast.ts';
import { WorldRenderedVisibility } from '../src/WorldRenderedVisibility.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';

// A near wall panel beside the default sightline leaves the Soul visible but
// fills a third of the frame. Broadcast prefers an equally clear framing
// without it; held framings are not churned for foreground alone.
const scene = { bounds: [-30,-30,30,30] as [number,number,number,number], levels: [], surfaces: [], obstacles: [], links: [] };
const material = new THREE.MeshBasicMaterial();
const records = { a: { kind: 'human' } } as Record<string, Entity>;
const soul = { a: { p: [0,0,0], yaw: 0, pitch: 0, roll: 0, activity: 'talk', state: {} } as SampledEntity };
function settle(roots: THREE.Object3D[], foreground = true) {
  const camera = new WorldBroadcast();
  if (!foreground) delete (camera as any).director.visibility.foreground;
  let shot: ReturnType<WorldBroadcast['sample']> = null;
  for (let f = 0; f < 60; f++) { const wall = (f + 1) / 60; shot = camera.sample(structuredClone(soul), records, scene, Math.floor(wall * 20), 1/20, 16/9, wall, 1/60, roots); }
  assert.ok(shot?.pose);
  return shot;
}

test('Broadcast avoids a framing whose foreground is filled by a near wall', () => {
  const open = settle([new THREE.Group()]).pose!;
  const eye = new THREE.Vector3(...open.position), subject = new THREE.Vector3(...open.target);
  const across = new THREE.Vector3(subject.z - eye.z, 0, eye.x - subject.x).normalize();
  const at = eye.clone().lerp(subject, .35).addScaledVector(across, .7);
  const group = new THREE.Group(), panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3, .15), material);
  panel.position.set(at.x, 1.5, at.z); panel.lookAt(eye.x, 1.5, eye.z); group.add(panel); group.updateWorldMatrix(true, true);
  const probe = new WorldRenderedVisibility(); probe.prepare([group]);
  const fill = (pose: NonNullable<typeof open>) => probe.evaluate(() => probe.foreground(pose, 16/9));
  const without = settle([group], false).pose!, chosen = settle([group]).pose!;
  assert.ok(fill(without) > .25, `the default framing is crowded (${fill(without)})`);
  assert.ok(fill(chosen) <= .25, `the chosen framing is not (${fill(chosen)})`);
  assert.equal(probe.evaluate(() => probe.score(chosen, ['a'], { a: { p: [0,0,0], yaw: 0, height: 1.75 } })), 1, 'Soul fully visible');
});
