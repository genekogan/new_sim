// Offline: node --test --test-concurrency=1 apps/web/src/WorldEntityLayer.ride.test.ts
// BALLOON-BODY: a god's ride balloon is ONE balloon: whenever its Core twin exists (grounded or aloft) the drawn entity takes
// the twin's position, height and yaw, and it never hovers/bobs on its own (Core's vehicle owns its motion).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';
import { rideMotionDef } from './gen-mesh/kits/ride-balloon.ts';
import { arrivalMark } from './arrival-marks.ts';

arrivalMark('card-done');  // motion runs (it is held under the arrival card)

const balloonDef = { tags: ['balloon', 'carrier'], components: { hover: { amp: 0.2, period: 4 } }, make: { kind: 'kit' } };

async function layerWithBalloon() {
  (globalThis as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  const { WorldEntityLayer } = await import('./WorldEntityLayer.ts').finally(() => hooks.deregister());
  const layer = new WorldEntityLayer((p) => p);
  layer.active = true;
  const entity = { id: 'e1', name: 'eden-balloon', def: 'd1', in: { parent: 'world' }, seed: 1 };
  const inner = layer as unknown as { model: unknown; drawn: Map<string, unknown>; thingsGroup: THREE.Group };
  inner.model = { entities: new Map([['e1', entity]]), resolvedDef: () => balloonDef, ground: () => ({ extent: [0, 0, 0, 0] }) };
  const obj = new THREE.Group(); obj.position.set(-20, 0, -9); inner.thingsGroup.add(obj);
  const p = new THREE.Vector3(-20, 0, -9);
  // what the layer's build draws for this def: motion from rideMotionDef (the hover dropped)
  const mdef = rideMotionDef(balloonDef as never) as typeof balloonDef;
  inner.drawn.set('e1', { settled: true, obj, from: { p, s: 1 }, to: { p: p.clone(), s: 1 }, t0: 0, dur: 0.001, defHash: 'e1',
    world: true, motion: { entity, def: mdef, yaw: 0, glowOnly: false } });
  let now = 30_000;
  const frame = () => { now += 16; layer.update(0.016, now); };
  return { layer, obj, frame };
}

test('ride balloon: the hover bob is dropped from its motion def (Core owns its motion); other defs keep theirs', () => {
  assert.equal('hover' in rideMotionDef(balloonDef).components, false);
  const lamp = { tags: ['lamp'], components: { hover: { amp: 1 } } };
  assert.equal(rideMotionDef(lamp as never), lamp);
});

test('ride balloon: the drawn entity follows a moving Core twin, grounded then aloft, with its yaw and no hover offset', async () => {
  const { layer, obj, frame } = await layerWithBalloon();
  const twin: [number, number, number][] = [[-20, 0, -9], [-21.5, 0, -8.4], [-30, 12.3, -6], [-36.58, 39.55, -3.32]];
  for (const [i, p] of twin.entries()) {
    const yaw = -2.841 + i * 0.1;
    for (let f = 0; f < 3; f++) { layer.poseOverride('eden-balloon', p, yaw); frame(); }
    assert.deepEqual(obj.position.toArray().map((v) => +v.toFixed(3)), p.map((v) => +v.toFixed(3)), `pose ${i}`);
    assert.ok(Math.abs(obj.rotation.y - -yaw) < 1e-6, `yaw ${i}: ${obj.rotation.y}`);
  }
  layer.poseOverride('eden-balloon', null); frame(); frame();
  assert.deepEqual(obj.position.toArray(), [-20, 0, -9], 'back at its own pose when the twin is gone');
});
