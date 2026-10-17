import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldBroadcast, subjectFraction, ridingCarrier, riderView, RIDER_EYE_MAX } from '../src/WorldBroadcast.ts';
import { BALLOON } from '../src/WorldBalloonRide.ts';
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

// V1 (3.2 walk, dpr 2): the orbit pulled out along a steep ray, the eye ~19 m above the basket, and the envelope hid the rider.
// A rider's eye stays below the envelope's mouth line, out to the side, and the sight line to the rider's head clears the envelope.
const clearsEnvelope = (eye: readonly number[], head: readonly number[], c: { p: readonly number[] }) => {
  const { radius, mouthHeight } = BALLOON.envelope;
  for (let i = 0; i <= 200; i++) { const t = i / 200, x = head[0] + (eye[0] - head[0]) * t, y = head[1] + (eye[1] - head[1]) * t, z = head[2] + (eye[2] - head[2]) * t;
    if (y >= c.p[1] + mouthHeight && Math.hypot(x - c.p[0], z - c.p[2]) <= radius) return false; }
  return true;
};
test('a steep rider pose (the dpr 2 walk: eye 19 m over the basket) comes down under the envelope, same distance', () => {
  const c = { p: [10, 89, 5], yaw: .4 }, head = [10.12, 90.65, 5.3];
  const steep = { position: [14, 108, 9] as [number, number, number], target: [10, 92.6, 5] as [number, number, number], fov: 45 };
  assert.equal(clearsEnvelope(steep.position, head, c), false, 'the walk\'s pose looks through the envelope');
  const v = riderView(steep, c), d0 = Math.hypot(14 - 10, 108 - 92.6, 9 - 5), d = Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);
  assert.ok(v.position[1] <= 89 + RIDER_EYE_MAX + 1e-9, `eye ${(v.position[1] - 89).toFixed(1)} m over the floor`);
  assert.ok(Math.abs(d - d0) < .01, `distance kept (${d.toFixed(1)} vs ${d0.toFixed(1)})`);
  assert.ok(Math.hypot(v.position[0] - 10, v.position[2] - 5) > BALLOON.envelope.radius * 2, 'out to the side, not under the basket');
  assert.ok(clearsEnvelope(v.position, head, c), 'the rider\'s head is in clear sight');
  const overhead = riderView({ position: [10, 120, 5], target: [10, 92, 5], fov: 45 }, c);
  assert.ok(overhead.position[1] <= 93 && Math.hypot(overhead.position[0] - 10, overhead.position[2] - 5) >= BALLOON.envelope.radius * 3, 'straight overhead goes to the side');
  const low = { position: [30, 91, 5] as [number, number, number], target: [10, 91, 5] as [number, number, number], fov: 45 };
  assert.equal(riderView(low, c), low, 'a pose already under the envelope is untouched');
});
for (const aspect of [16 / 9, 9 / 16, 1]) test(`Broadcast never puts a rider's eye above the envelope mouth (aspect ${aspect.toFixed(2)})`, () => {
  const y = 89, frame = ride(y), c = { p: [10, y, 5], yaw: 0 }, cam = new WorldBroadcast(); cam.hints = () => ({ soulEntity: () => null, eden: false, carriers: [c] });
  for (let i = 0; i < 150; i++) { const r = cam.sample(frame, records, scene, 100 + i / 3, .05, aspect, i / 30, 1 / 30); if (!r?.pose) continue;
    assert.ok(r.pose.position[1] <= y + RIDER_EYE_MAX + 1e-9, `frame ${i}: eye ${(r.pose.position[1] - y).toFixed(1)} m over the floor`);
    assert.ok(clearsEnvelope(r.pose.position, [frame.a.p[0], y + 1.65, frame.a.p[2]], c), `frame ${i}: envelope between eye and rider`); }
});
