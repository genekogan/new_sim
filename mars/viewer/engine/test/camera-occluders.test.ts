// Take parts as per-tick sight occluders (kind-aware boxes) and the crew
// exemption limited to contact points (CAMERA.md "Evaluators", CAMERA_VERIFY.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpatialScene } from '../spatial/types.ts';
import type { Entity } from '../world/types.ts';
import type { Vec3 } from '../core/math.ts';
import { entityCorners } from '../spatial/service.ts';
import { CameraWorld } from '../camera/geom.ts';
import { readability } from '../camera/quality.ts';
import { partOccluders, segmentBox, type OccBox, type PartPose } from '../camera/occluders.ts';
import type { SubjectPose } from '../camera/shots.ts';

const open = (): CameraWorld => new CameraWorld({ bounds: [-40, -40, 40, 40], levels: [], surfaces: [], obstacles: [], links: [] } as SpatialScene);
const person = (x: number, z: number, extra: Partial<SubjectPose> = {}): SubjectPose => ({ p: [x, 0, z], yaw: 0, kind: 'human', ...extra });
const part = (def: string, pose: PartPose): SubjectPose => ({ p: pose.p, yaw: pose.yaw, kind: 'component', occluders: partOccluders(def, pose) });
const corners = (b: OccBox): Vec3[] => [-1, 1].flatMap((i) => [-1, 1].flatMap((j) => [-1, 1].map((k) => [0, 1, 2].map((a) => b.c[a] + i * b.h[0] * b.ax[0][a] + j * b.h[1] * b.ax[1][a] + k * b.h[2] * b.ax[2][a]) as Vec3)));
const key = (p: Vec3) => p.map((v) => v.toFixed(6)).join(',');

test('part occluders: full boxes match entityCorners at any pose; upright = two posts inside its box; stair = two stringers', () => {
  const pose: PartPose = { p: [3, 0.4, -2], yaw: 0.7, pitch: -0.9, roll: 0.35 };
  const [beam] = partOccluders('beam-9ft', pose);
  assert.deepEqual(corners(beam).map(key).sort(), entityCorners({ def: 'beam-9ft', pose } as Entity).map(key).sort(), 'same rotation order as entityCorners');
  const posts = partOccluders('upright-12ft', pose);
  assert.equal(posts.length, 2);
  // every post corner lies inside the catalog box (projected on the box axes about its centre)
  const full = entityCorners({ def: 'upright-12ft', pose } as Entity);
  const c = full.reduce((a, q) => [a[0] + q[0] / 8, a[1] + q[1] / 8, a[2] + q[2] / 8], [0, 0, 0]);
  for (const q of posts.flatMap(corners)) {
    for (const ax of posts[0].ax) {
      const proj = (v: Vec3) => (v[0] - c[0]) * ax[0] + (v[1] - c[1]) * ax[1] + (v[2] - c[2]) * ax[2];
      const lim = Math.max(...full.map(proj));
      assert.ok(Math.abs(proj(q)) <= lim + 1e-9, 'post corner inside the upright box');
    }
  }
  assert.equal(partOccluders('stair-flight-10', pose).length, 2, 'two stringers');
  assert.equal(partOccluders('human', pose).length, 0);
  // segment/box: through, miss, starting inside
  const [slab] = partOccluders('plywood-4x6', { p: [0, 1.97, 0], yaw: 0 });
  assert.ok(segmentBox([0, 5, 0], [0, 0, 0], slab)! > 0);
  assert.equal(segmentBox([3, 5, 0], [3, 0, 0], slab), null);
  assert.equal(segmentBox([0, 1.98, 0], [0, 0, 0], slab), 0);
});

test('camera readability: a subject behind a rack-upright post is partly occluded, but not through the frame\'s empty middle', () => {
  const w = open();
  const cam = { position: [0, 1.2, -6] as Vec3, target: [0, 1.2, 3] as Vec3, fov: 50 };
  const A = part('upright-12ft', { p: [0, 0, 0], yaw: 0 }); // standing frame in the x/y plane, posts at x = ±0.57
  const middle = readability(w, cam, { s: person(0, 2), A }, ['s']);
  assert.equal(middle.score, 1, `seen through the frame: ${middle.reasons.join(';')}`);
  // behind the right post: feet / torso / head on the post's sight line, both hands (yaw π/2 → lateral in x) beside it
  const behind = readability(w, cam, { s: person(0.762, 2, { yaw: Math.PI / 2 }), A }, ['s']);
  assert.ok(behind.subjects[0].visible > 0 && behind.subjects[0].visible < 1, `partly occluded: ${behind.subjects[0].visible}`);
  assert.match(behind.reasons.join(';'), /subject s 60% occluded by 'part A'/);
  // a solid box the size of the frame would (wrongly) hide the subject in the middle
  const solid: OccBox = { c: [0, 1.83, 0], h: [0.61, 1.83, 0.04], ax: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], min: [-0.61, 0, -0.04], max: [0.61, 3.66, 0.04] };
  assert.equal(readability(w, cam, { s: person(0, 2), F: { ...A, occluders: [solid] } }, ['s']).score, 0);
  // a subject is never occluded by its own geometry
  assert.equal(readability(w, cam, { A: { ...A, points: [[0.57, 1.8, 0], [-0.57, 1.8, 0], [0, 1.8, 0]] } }, ['A']).subjects[0].visible, 1);
});

test('camera readability: a person under a seated deck slab is occluded from a high wide, readable from eye level', () => {
  const w = open();
  const s1 = part('plywood-4x6', { p: [0, 1.97, 0], yaw: 0 }); // deck sheet on the joists at ~2 m
  const high = { position: [5, 9, -5] as Vec3, target: [0, 1, 0] as Vec3, fov: 50 };
  const r = readability(w, high, { p3: person(0, 0), s1 }, ['p3']);
  assert.ok(r.score <= 0.6, `high wide sees p3 through the deck: ${r.score}`);
  assert.match(r.reasons.join(';'), /subject p3 \d+% occluded by 'part s1'/);
  const low = { position: [0, 1.2, -6] as Vec3, target: [0, 1.2, 0] as Vec3, fov: 50 };
  assert.equal(readability(w, low, { p3: person(0, 0), s1 }, ['p3']).score, 1, 'eye level: under the sheet, fully visible');
  // the sheet itself (its own slab exempt) stays readable from the high wide
  assert.equal(readability(w, high, { p3: person(0, 0), s1: { ...s1, points: entityCorners({ def: 'plywood-4x6', pose: { p: [0, 1.97, 0], yaw: 0 } } as Entity) } }, ['s1']).score, 1);
});

test('camera readability: crew is see-through only within 0.6 m of its grip; elsewhere it occludes like a bystander', () => {
  const w = open();
  const cam = { position: [0, 1.6, -6] as Vec3, target: [0, 1.2, 0] as Vec3, fov: 50 };
  const beam: SubjectPose = { p: [0, 0.9, 0], yaw: 0, kind: 'component', height: 1, points: [[-1.8, 0.95, 0], [0, 0.95, 0], [1.8, 0.95, 0]], crew: ['c1'] };
  // c1 stands on the sight line to the beam's right end, gripping it there
  const near = { c1: person(1.65, -0.5, { contacts: [[1.8, 0.95, -0.05]] }) };
  assert.equal(readability(w, cam, { A: beam, ...near }, ['A']).score, 1, 'hand on its own load');
  // the same crew member gripping the far end (> 0.6 m away) hides the right end
  const far = readability(w, cam, { A: beam, c1: person(1.65, -0.5, { contacts: [[-1.8, 0.95, -0.05]] }) }, ['A']);
  assert.ok(Math.abs(far.subjects[0].visible - 2 / 3) < 1e-9, `far from its grip: ${far.subjects[0].visible}`);
  assert.match(far.reasons.join(';'), /occluded by 'person c1'/);
  // co-subjects occlude each other too (a raise crew in front of its partner), except at a shared grip
  const pair = readability(w, cam, { p1: person(0, 0), p2: person(0, -3) }, ['p1', 'p2']);
  assert.ok(pair.subjects[0].visible < 0.5, `p1 behind p2: ${pair.subjects[0].visible}`);
  // bystander capsule is 0.2 m: a ray 0.25 m beside the body axis passes
  assert.equal(readability(w, cam, { s: person(0, 0), b: person(0.25, -3) }, ['s']).subjects[0].visible, 1);
});
