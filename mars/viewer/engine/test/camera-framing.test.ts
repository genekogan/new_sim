// Camera framing quality: bystanders as soft occluders, small / lying subjects,
// and a UI safe area at the bottom of the frame (CAMERA.md "Evaluators").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpatialScene } from '../spatial/types.ts';
import type { Vec3 } from '../core/math.ts';
import { CameraWorld } from '../camera/geom.ts';
import { readability } from '../camera/quality.ts';
import { evaluateShot, type Sampler, type ShotSpec, type SubjectPose } from '../camera/shots.ts';
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

// A 12 ft (3.66 m) upright lying flat on dunnage, as takeSampler reports it (height floor 0.5, box corners + centre).
function lyingFrame(): SubjectPose {
  const xs = [-1.83, 1.83], ys = [0.05, 0.14], zs = [-0.53, 0.53];
  const corners = xs.flatMap((x) => ys.flatMap((y) => zs.map((z) => [x, y, z] as Vec3)));
  return { p: [0, 0.05, 0], yaw: 0, kind: 'component', height: 0.5, points: [[0, 0.095, 0], ...corners] };
}

test('camera size: a lying 3.66 m frame is sized by its extent; orbiting it at 8 m keeps it whole and readable ≥ 0.8', () => {
  const w = open();
  const F = lyingFrame();
  const sampler: Sampler = () => ({ F: { ...F, crew: ['c1', 'c2'] }, c1: person(-1.2, 1.4), c2: person(1.2, 1.4) });
  const spec: ShotSpec = { kind: 'orbit', subject: 'F', radius: 8, height: 3, period: 20, subjects: ['F'] };
  const plan = planCameraTrack(spec, sampler, w, { duration: 20 });
  assert.equal(plan.report.invalidSamples, 0);
  assert.ok(plan.report.minReadability >= 0.8, `min readability ${plan.report.minReadability}`);
  for (const s of plan.samples) {
    const r = readability(w, s, sampler(s.t), ['F']);
    assert.equal(r.subjects[0].inFrame, 1, `t=${s.t}: ${r.reasons.join(';')}`);
    assert.ok(!r.reasons.some((x) => /too small/.test(x)), `t=${s.t}: ${r.reasons.join(';')}`);
    assert.ok(r.subjects[0].size > 0.3, `projected extent ${r.subjects[0].size}`);
  }
  // a standing person far away is still too small (extent = height)
  const far = readability(w, { position: [0, 1.6, -29], target: [0, 1, 29], fov: 50 }, { f: person(0, 29) }, ['f']);
  assert.match(far.reasons.join(';'), /too small/);
});

test('camera orbit/frameGroup: the framing radius includes component extents (orbit pulls out; group fits the corners)', () => {
  const w = open();
  const F = lyingFrame();
  const sampler: Sampler = () => ({ F, p1: person(0, 2.5) });
  // an orbit asked for 1.5 m cannot hold a 3.66 m frame: it pulls out along its ray until every corner fits
  const tight: ShotSpec = { kind: 'orbit', subject: 'F', radius: 1.5, height: 1.5, period: 8, lookHeight: 0.3, subjects: ['F'] };
  for (let t = 0; t < 8; t += 0.5) {
    const pose = evaluateShot(tight, sampler, t);
    const r = readability(w, pose, sampler(t), ['F']);
    assert.equal(r.subjects[0].inFrame, 1, `t=${t}: ${r.reasons.join(';')}`);
    assert.ok(Math.hypot(pose.position[0], pose.position[2]) > 1.5 + 1e-6, 'pulled out');
  }
  // without subjects the orbit keeps its radius exactly
  const bare = evaluateShot({ kind: 'orbit', center: [0, 0, 0], radius: 1.5, height: 1.5, period: 8 }, sampler, 0);
  assert.ok(Math.abs(bare.position[0] - 1.5) < 1e-9 && Math.abs(bare.position[1] - 1.5) < 1e-9);
  const group = evaluateShot({ kind: 'frameGroup', subjects: ['F', 'p1'], padding: 0.4, azimuth: Math.PI / 2, elevation: 0.3 }, sampler, 0);
  const rg = readability(w, group, sampler(0), ['F', 'p1']);
  assert.ok(rg.subjects.every((s) => s.inFrame === 1), rg.reasons.join(';'));
});
