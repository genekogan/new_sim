import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldBroadcast, subjectFraction, ridingCarrier, riderPose, riderAzimuths, RIDER_EYE_MAX } from '../src/WorldBroadcast.ts';
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
test('the ride shot stands out to the side, under the envelope, and sees the rider (the dpr 2 walk had it 19 m over the basket)', () => {
  const c = { p: [10, 89, 5], yaw: .4 }, head = [10.12, 90.65, 5.3];
  const steep = { position: [14, 108, 9] as [number, number, number], target: [10, 92.6, 5] as [number, number, number], fov: 45 };
  assert.equal(clearsEnvelope(steep.position, head, c), false, 'the walk\'s pose looks through the envelope');
  for (const azimuth of riderAzimuths(c.yaw)) { const v = riderPose(c, azimuth);
    assert.ok(v.position[1] - 89 <= RIDER_EYE_MAX && v.position[1] > 89, `eye ${(v.position[1] - 89).toFixed(1)} m over the floor`);
    assert.ok(Math.hypot(v.position[0] - 10, v.position[2] - 5) > BALLOON.envelope.radius * 3, 'out to the side, not under the basket');
    assert.ok(clearsEnvelope(v.position, head, c), 'the rider\'s head is in clear sight');
    const f = subjectFraction(v, 16 / 9, [10.12, 89, 5.3], 1.75); assert.ok(f >= .08 && f <= .2, `rider readable (${f.toFixed(3)})`); }
  const first = riderPose(c, riderAzimuths(c.yaw)[0]), side = Math.atan2(first.position[2] - 5, first.position[0] - 10) - c.yaw;
  assert.ok(Math.abs(Math.abs(Math.sin(side)) - 1) < 1e-9, 'the first choice is broadside to the basket');
});
test('a climbing, drifting balloon stays in the shot (the director froze its pose while the envelope blocked it)', () => {
  const cam = new WorldBroadcast(); let c = { p: [10, 20, 5], yaw: 0 }; cam.hints = () => ({ soulEntity: () => null, eden: false, carriers: [c] });
  let last: number[] | null = null, moved = 0;
  for (let i = 0; i < 300; i++) { const y = 20 + i * .1, x = 10 - i * .15; c = { p: [x, y, 5], yaw: 0 }; const frame = ride(y);
    for (const e of Object.values(frame)) e.p[0] += x - 10;
    const r = cam.sample(frame, records, scene, 100 + i / 3, .05, 16 / 9, i / 30, 1 / 30); if (!r?.pose) continue;
    if (i > 30) { assert.ok(subjectFraction(r.pose, 16 / 9, frame.a.p, 1.75) > .06, `frame ${i}: rider in shot`);
      if (last && Math.hypot(...r.pose.position.map((v, k) => v - last![k])) > 1e-6) moved++; }
    last = [...r.pose.position]; }
  assert.ok(moved > 250, `the camera travels with the basket (${moved} frames moved)`);
});
for (const aspect of [16 / 9, 9 / 16, 1]) test(`Broadcast never puts a rider's eye above the envelope mouth (aspect ${aspect.toFixed(2)})`, () => {
  const y = 89, frame = ride(y), c = { p: [10, y, 5], yaw: 0 }, cam = new WorldBroadcast(); cam.hints = () => ({ soulEntity: () => null, eden: false, carriers: [c] });
  for (let i = 0; i < 150; i++) { const r = cam.sample(frame, records, scene, 100 + i / 3, .05, aspect, i / 30, 1 / 30); if (!r?.pose) continue;
    assert.ok(r.pose.position[1] <= y + RIDER_EYE_MAX + 1e-9, `frame ${i}: eye ${(r.pose.position[1] - y).toFixed(1)} m over the floor`);
    assert.ok(clearsEnvelope(r.pose.position, [frame.a.p[0], y + 1.65, frame.a.p[2]], c), `frame ${i}: envelope between eye and rider`); }
});
