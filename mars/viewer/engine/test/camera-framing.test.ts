// Camera framing quality: bystanders as soft occluders, small / lying subjects,
// and a UI safe area at the bottom of the frame (CAMERA.md "Evaluators").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpatialScene } from '../spatial/types.ts';
import type { Vec3 } from '../core/math.ts';
import { CameraWorld } from '../camera/geom.ts';
import { readability } from '../camera/quality.ts';
import type { Sampler, ShotSpec, SubjectPose } from '../camera/shots.ts';
import { planCameraTrack } from '../camera/plan.ts';

const open = (): CameraWorld => new CameraWorld({ bounds: [-40, -40, 40, 40], levels: [], surfaces: [], obstacles: [], links: [] } as SpatialScene);
const person = (x: number, z: number, extra: Partial<SubjectPose> = {}): SubjectPose => ({ p: [x, 0, z], yaw: 0, kind: 'human', ...extra });

test('camera readability: a bystander between camera and subject occludes; behind the subject or on the crew it does not', () => {
  const w = open();
  const cam = { position: [0, 1.6, -6] as Vec3, target: [0, 1.2, 0] as Vec3, fov: 50 };
  const between = readability(w, cam, { s: person(0, 0), b: person(0, -3) }, ['s']);
  assert.ok(between.score < 0.5, `bystander in front: ${between.score}`);
  assert.match(between.reasons.join(';'), /subject s \d+% occluded by 'person b'/);
  assert.equal(readability(w, cam, { s: person(0, 0), b: person(0, 3) }, ['s']).score, 1, 'bystander behind the subject');
  assert.equal(readability(w, cam, { s: person(0, 0), b: person(1.2, -3) }, ['s']).score, 1, 'bystander beside the line of sight');
  // a carried part's carriers are part of the subject, not occluders
  const beam: SubjectPose = { p: [0, 0.9, 0], yaw: 0, kind: 'component', height: 1, points: [[-1.8, 0.95, 0], [0, 0.95, 0], [1.8, 0.95, 0]] };
  assert.equal(readability(w, cam, { A: { ...beam, crew: ['c1'] }, c1: person(0, -3) }, ['A']).score, 1, 'carrier in front of its own beam');
  assert.ok(readability(w, cam, { A: beam, c1: person(0, -3) }, ['A']).score < 1, 'the same person, not crew, occludes');
  // cutaway (inspection) ignores people too; people never make a camera placement invalid
  assert.equal(readability(w, cam, { s: person(0, 0), b: person(0, -3) }, ['s'], { cutaway: true }).score, 1);
});

test('camera planner: swings off a bystander standing in front of the subject, keeps the shot when it stands behind', () => {
  const w = open();
  const spec: ShotSpec = { kind: 'fixed', position: [0, 1.6, -6], target: [0, 1.2, 0], subjects: ['s'] };
  const front: Sampler = () => ({ s: person(0, 0), b: person(0, -3) });
  const p1 = planCameraTrack(spec, front, w, { duration: 3 });
  assert.ok(p1.report.desired.unreadableSamples > 0);
  assert.ok(p1.report.reasons.some((r) => /desired shot: subject s \d+% occluded by 'person b'/.test(r)), p1.report.reasons.join('\n'));
  assert.ok(p1.samples.every((s) => s.key !== 'desired'), `keys ${[...new Set(p1.samples.map((s) => s.key))]}`);
  assert.ok(p1.report.minReadability >= 0.8, `min readability ${p1.report.minReadability}`);
  assert.equal(p1.report.invalidSamples, 0);
  const behind: Sampler = () => ({ s: person(0, 0), b: person(0, 3) });
  const p2 = planCameraTrack(spec, behind, w, { duration: 3 });
  assert.ok(p2.samples.every((s) => s.key === 'desired'));
  assert.equal(p2.report.minReadability, 1);
});
