// Camera geometry + evaluator unit tests on the proving ground (SPEC §18, §28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provingGround } from '../scenes/proving-ground.ts';
import type { Obstacle } from '../spatial/types.ts';
import { CameraWorld, DEFAULT_CAMERA_POLICY, pushOut, raycast, segmentPrism, signedDistance } from '../camera/geom.ts';
import { placement, readability, sweepCrossing, temporal } from '../camera/quality.ts';
import { catmullRom, evaluateShot, type Sampler } from '../camera/shots.ts';

const plexi: Obstacle = { id: 'plexi', obb: { c: [0, -5], half: [2, 0.02], yaw: 0 }, y0: 0, y1: 2.4, kind: 'glass', label: 'plexiglass pane' };
const rotated: Obstacle = { id: 'rot', obb: { c: [0, 20], half: [1, 0.2], yaw: Math.PI / 4 }, y0: 0, y1: 2, kind: 'solid', label: 'rotated block' };
const pg = () => provingGround({ extra: [plexi, rotated] });

test('camera geom: slab test hits walls in OBB frame and respects y range', () => {
  const w = new CameraWorld(pg());
  const h = raycast(w, [-20, 1.5, -15], [-10, 1.5, -15], 'collide');
  assert.equal(h?.solid.o.id, 'wall');
  assert.ok(Math.abs(h!.t - (5 - 0.15) / 10) < 1e-9, `entry t ${h!.t}`);
  // passes over the 2.4 m wall
  assert.equal(raycast(w, [-20, 2.6, -15], [-10, 2.6, -15], 'collide'), null);
  // rotated 45°: a ray along the long diagonal axis hits, a parallel one 1 m off misses
  const q = w.solids.find((s) => s.o.id === 'rot')!;
  assert.ok(segmentPrism([-3, 1, 17], [3, 1, 23], q));
  assert.equal(segmentPrism([-3, 1, 18.4], [3, 1, 24.4], q), null);
  // start inside → t0 = 0
  assert.deepEqual(segmentPrism([-15, 1, -15], [-10, 1, -15], w.solids.find((s) => s.o.id === 'wall')!)?.[0], 0);
});

test('camera geom: signed distance, placement validity, pushout', () => {
  const w = new CameraWorld(pg());
  const wall = w.solids.find((s) => s.o.id === 'wall')!;
  assert.ok(Math.abs(signedDistance([-14, 1, -15], wall) - 0.85) < 1e-9);
  assert.ok(signedDistance([-15, 1, -15], wall) < 0);
  assert.equal(placement(w, [-15, 1, -15]).valid, false);
  assert.match(placement(w, [-15, 1, -15]).reason!, /inside 'test wall'/);
  const near = placement(w, [-14.7, 1, -15]);
  assert.equal(near.valid, false);
  assert.match(near.reason!, /0\.15 m from 'test wall'/);
  assert.equal(placement(w, [-14, 1, -15]).valid, true);
  const po = pushOut(w, [-15.05, 1.5, -15], 0.32);
  assert.ok(po.ok && po.moved);
  assert.ok(placement(w, po.p).valid, `pushed to ${po.p}`);
  assert.ok(po.p[0] < -15.4, 'pushed out through the nearest (west) face');
  assert.equal(placement(w, [0, 0.01, 0]).valid, false, 'below ground');
});

test('camera geom: glass collides but does not occlude; policy is per kind', () => {
  const w = new CameraWorld(pg());
  const subj = { p1: { p: [0, 0, -2] as [number, number, number], yaw: 0 } };
  const cam = { position: [0, 1.6, -10] as [number, number, number], target: [0, 1, -2] as [number, number, number], fov: 50 };
  // seen through the pane
  const r = readability(w, cam, subj, ['p1']);
  assert.equal(r.score, 1, r.reasons.join('; '));
  // but the camera cannot move through it, nor sit inside it
  assert.equal(sweepCrossing(w, [0, 1.6, -10], [0, 1.6, 0])?.o.id, 'plexi');
  assert.equal(placement(w, [0, 1.6, -5]).valid, false);
  // an opaque-glass policy (e.g. frosted) makes it an occluder
  const frosted = new CameraWorld(pg(), { ...DEFAULT_CAMERA_POLICY, glass: { collide: true, occlude: true } });
  const r2 = readability(frosted, cam, subj, ['p1']);
  assert.equal(r2.score, 0);
  assert.match(r2.reasons[0], /subject p1 100% occluded by 'plexiglass pane'/);
});

test('camera readability: occlusion fraction, frustum, size, named reasons', () => {
  const w = new CameraWorld(pg());
  const inU = { p2: { p: [-15, 0, 12] as [number, number, number], yaw: 0 } };
  // from the open side (south) the subject in the U is readable
  assert.equal(readability(w, { position: [-15, 1.6, 3], target: [-15, 1, 12], fov: 50 }, inU, ['p2']).score, 1);
  // from the west, behind the U west wall, it is not
  const r = readability(w, { position: [-25, 1.5, 12], target: [-15, 1, 12], fov: 50 }, inU, ['p2']);
  assert.equal(r.score, 0);
  assert.deepEqual(r.reasons, ["subject p2 100% occluded by 'U west wall'"]);
  // partial: head pokes over the wall from a raised camera
  const rp = readability(w, { position: [-21, 3.5, 12], target: [-15, 1.2, 12], fov: 50 }, inU, ['p2']);
  assert.ok(rp.score > 0 && rp.score < 1, `partial ${rp.score}`);
  assert.match(rp.reasons[0], /subject p2 \d+% occluded by 'U west wall'/);
  // explicit points (e.g. beam end + receiving socket) are honoured
  const socket = { s: { p: [0, 0, 0] as [number, number, number], yaw: 0, points: [[0, 1, 30] as [number, number, number]] } };
  const rs = readability(w, { position: [0, 1.6, 0], target: [0, 1, -10], fov: 50 }, socket, ['s']);
  assert.match(rs.reasons.join(';'), /outside frame/);
  // tiny subject far away
  const far = readability(w, { position: [0, 1.6, -29], target: [0, 1, 29], fov: 50 }, { f: { p: [0, 0, 29], yaw: 0 } }, ['f']);
  assert.match(far.reasons.join(';'), /too small/);
  // cutaway (inspection) ignores occluders
  assert.equal(readability(w, { position: [-25, 1.5, 12], target: [-15, 1, 12], fov: 50 }, inU, ['p2'], { cutaway: true }).score, 1);
});

test('camera shots: stateless evaluation (random access == sequential), Catmull-Rom through keys', () => {
  const keys = [
    { t: 0, position: [0, 2, 0] as [number, number, number], target: [0, 1, 5] as [number, number, number] },
    { t: 2, position: [4, 2, 0] as [number, number, number], target: [0, 1, 5] as [number, number, number] },
    { t: 5, position: [4, 3, 4] as [number, number, number], target: [0, 1, 5] as [number, number, number] },
  ];
  assert.deepEqual(catmullRom(keys, 2, 'position'), [4, 2, 0]);
  assert.deepEqual(catmullRom(keys, 9, 'position'), [4, 3, 4]);
  const sampler: Sampler = (t) => ({ p1: { p: [t, 0, 0], yaw: 0 } });
  const spec = { kind: 'follow' as const, subject: 'p1', offset: [-4, 2, 0] as [number, number, number], damping: 0.5 };
  const forward = [0, 1, 2, 3].map((t) => evaluateShot(spec, sampler, t));
  const backward = [3, 2, 1, 0].map((t) => evaluateShot(spec, sampler, t)).reverse();
  assert.deepEqual(forward, backward);
  assert.ok(forward[3].position[0] < 3 - 4 + 1e-9, 'damped follow lags the subject');
  const og = evaluateShot({ kind: 'orbit', center: [0, 0, 0], radius: 5, height: 2, period: 8 }, sampler, 2);
  assert.ok(Math.abs(og.position[0]) < 1e-9 && Math.abs(og.position[2] - 5) < 1e-9);
});

test('camera temporal: detects A→B→A oscillation and cut density', () => {
  const s = (t: number, key: string, cut = false) => ({ t, position: [0, 2, 0] as [number, number, number], target: [0, 1, 5] as [number, number, number], fov: 50, key, cut });
  const m = temporal([s(0, 'a'), s(0.5, 'b', true), s(1, 'a', true), s(1.5, 'b', true), s(5, 'b')]);
  assert.equal(m.keySwitches, 3);
  assert.equal(m.oscillations.length, 2);
  assert.equal(m.cutsPer2s, 3);
});
