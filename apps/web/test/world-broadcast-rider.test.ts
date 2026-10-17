import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldBroadcast, subjectFraction, ridingCarrier } from '../src/WorldBroadcast.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';

// V1 (3.2 walk, signed in): Broadcast rode the balloon with the basket filling most of the frame (the rider was framed as
// a pedestrian, ~3.8 m off). A rider is framed with its carrier: basket and lower envelope in the shot, riders still readable.
const scene = { bounds: [-80, -80, 80, 80] as [number, number, number, number], levels: [], surfaces: [], obstacles: [], links: [] };
const records = { a: { kind: 'human' }, b: { kind: 'human' } } as Record<string, Entity>;
const ride = (y: number): Record<string, SampledEntity> => ({
  a: { p: [10.12, y, 4.7], yaw: .35, pitch: 0, roll: 0, activity: 'ride', state: {} },
  b: { p: [10.12, y, 5.3], yaw: -.35, pitch: 0, roll: 0, activity: 'ride', state: {} },
});
const settle = (cam: WorldBroadcast, frame: Record<string, SampledEntity>) => { let r: ReturnType<WorldBroadcast['sample']> = null; for (let i = 0; i < 120; i++) r = cam.sample(frame, records, scene, 100 + i / 3, .05, 16 / 9, i / 30, 1 / 30); return r!; };

for (const y of [0, 40]) test(`Broadcast keeps a riding carrier framed (basket floor at ${y} m)`, () => {
  const frame = ride(y), carriers = [{ p: [10, y, 5], yaw: 0 }];
  const bare = settle(new WorldBroadcast(), frame);
  const cam = new WorldBroadcast(); cam.hints = () => ({ soulEntity: () => null, eden: false, carriers });
  const shot = settle(cam, frame), [x, py, z] = shot.pose!.position, d = Math.hypot(x - 10, py - y - 1, z - 5);
  const bareD = Math.hypot(bare.pose!.position[0] - 10, bare.pose!.position[1] - y - 1, bare.pose!.position[2] - 5);
  assert.ok(bareD < 6, `without carrier hints the rider is a pedestrian close-up (${bareD.toFixed(1)} m): the walk's bug`);
  assert.ok(d >= 12, `camera stands back from the basket (${d.toFixed(1)} m)`);
  const fraction = subjectFraction(shot.pose!, 16 / 9, frame.a.p, 1.75);
  assert.ok(fraction >= .08 && fraction <= .3, `the rider stays readable, the basket no longer fills the frame (${fraction.toFixed(3)})`);
});

test('only a body in the basket rides; one standing beside or below it does not', () => {
  const c = [{ p: [0, 20, 0], yaw: 0 }];
  assert.ok(ridingCarrier([.12, 20, .3], c));
  assert.equal(ridingCarrier([2.5, 20, 0], c), null);
  assert.equal(ridingCarrier([0, 0, 0], c), null);
  assert.equal(ridingCarrier([0, 20, 0], []), null);
});
