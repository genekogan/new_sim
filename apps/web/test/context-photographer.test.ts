import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { chooseContextPhoto, planContextPhoto, MAX_PHOTO_EVALUATIONS,
  type PhotoSubject, type PhotoCandidate, type PhotoEvidence, type PhotoPoint } from '../src/context-photographer.ts';

const subject = (extra: Partial<PhotoSubject> = {}): PhotoSubject => ({ ref: 'thing:podium', kind: 'part',
  bounds: { min: [-.6, 0, -.5], max: [.6, 1.2, .5] }, target: [0, .6, 0], objectIds: ['podium'], ...extra });
const point = (p: PhotoPoint) => new THREE.Vector3(...p);
function box(id: string, min: PhotoPoint, max: PhotoPoint) {
  const bounds = new THREE.Box3(point(min), point(max));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...bounds.getSize(new THREE.Vector3()).toArray()), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.name = id; mesh.position.copy(bounds.getCenter(new THREE.Vector3())); mesh.updateMatrixWorld(true);
  return { mesh, bounds };
}

// A geometric oracle independent of the planner: perspective projection and real triangle raycasts.
function geometry(s: PhotoSubject, solids: ReturnType<typeof box>[] = []) {
  const samples: THREE.Vector3[] = [];
  for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) for (const z of [0, .5, 1])
    samples.push(new THREE.Vector3(
      s.bounds.min[0] + (s.bounds.max[0] - s.bounds.min[0]) * x,
      s.bounds.min[1] + (s.bounds.max[1] - s.bounds.min[1]) * y,
      s.bounds.min[2] + (s.bounds.max[2] - s.bounds.min[2]) * z));
  return (candidate: PhotoCandidate): PhotoEvidence => {
    const camera = new THREE.PerspectiveCamera(candidate.fov, s.aspect ?? 10 / 7, .01, 10000);
    camera.position.copy(point(candidate.eye)); camera.lookAt(point(candidate.at)); camera.updateMatrixWorld(true);
    const active = solids.filter(solid => !candidate.cutaway?.occluderIds.includes(solid.mesh.name));
    let visible = 0, clipped = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const blockers = new Set<string>();
    for (const sample of samples) {
      const projected = sample.clone().project(camera);
      x0 = Math.min(x0, projected.x); x1 = Math.max(x1, projected.x); y0 = Math.min(y0, projected.y); y1 = Math.max(y1, projected.y);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) clipped++;
      const direction = sample.clone().sub(camera.position), ray = new THREE.Raycaster(camera.position, direction.clone().normalize(), 0, direction.length() - .001);
      const hit = ray.intersectObjects(active.map(solid => solid.mesh), false)[0];
      if (hit) blockers.add(hit.object.name); else visible++;
    }
    return { subjectPresent: true, insideSolid: solids.some(solid => solid.bounds.containsPoint(camera.position)),
      visibleFraction: visible / samples.length, clipping: clipped / samples.length,
      projectedFill: Math.min(1, (x1 - x0) * (y1 - y0) / 4), context: .5, occluderIds: [...blockers] };
  };
}

test('world-space declared front follows a rotated asset; unknown yaw never becomes front evidence', async () => {
  const s = subject({ front: { direction: [1, 0, 0], source: 'declared-front' } });
  const choice = await chooseContextPhoto(planContextPhoto(s), geometry(s));
  assert.equal(choice.status, 'ready');
  if (choice.status !== 'ready') return;
  assert.equal(choice.provenance.front, 'declared-front');
  assert.ok(choice.eye[0] > 0 && Math.abs(choice.eye[2]) < .001);
  for (const f of [undefined, { direction: [1, 0, 0] as const, source: 'entrance' as const, alternatives: [[-1, 0, 0] as const] }]) {
    const ambiguous = subject({ front: f });
    assert.ok(planContextPhoto(ambiguous).candidates.every(c => c.provenance.front === 'unknown'));
  }
});

test('entrance blocker defeats frontal composition and all ordinary candidates are ranked', async () => {
  const s = subject({ kind: 'exterior', front: { direction: [0, 0, 1], source: 'entrance' } });
  const wall = box('screen', [-1, 0, 1], [1, 3, 1.1]), plan = planContextPhoto(s);
  const evidence = geometry(s, [wall]); let count = 0;
  const choice = await chooseContextPhoto(plan, c => { count++; return evidence(c); });
  assert.equal(count, plan.candidates.length);
  assert.equal(choice.status, 'ready');
  if (choice.status !== 'ready') return;
  assert.ok(Math.abs(choice.eye[0]) > .5, 'a side view sees around the actual screen');
  assert.equal(choice.cutaway, undefined, 'exterior facade is never stripped');
  assert.ok(choice.scores.some(score => score.visibility < .6));
});

test('known front prefers admissible facade obliques; authored priority and unknown fallback remain', async () => {
  const s = subject({ kind: 'exterior', front: { direction: [0, 0, 1], source: 'entrance' } });
  const plan = planContextPhoto(s);
  assert.equal(plan.candidates.length, 6);
  // Retained v1: the cleaner side scored76.94, but the visible front oblique
  // scored70.2. Direction provenance alone never proves an entrance is visible.
  plan.candidates[3] = { ...plan.candidates[3]!, eye: [20.87245181587346, 11.392603317143058, 0] };
  const evaluate = (c: PhotoCandidate): PhotoEvidence => ({ subjectPresent: true, insideSolid: false,
    visibleFraction: c.id === 'view-0' ? .4826 : c.id === 'view-1' ? .7856 : c.id === 'view-3' ? 1 : .2,
    projectedFill: c.id === 'view-1' ? .3384 : .3594, clipping: 0 });
  const oriented = await chooseContextPhoto(plan, evaluate);
  assert.equal(oriented.status, 'ready');
  if (oriented.status === 'ready') assert.deepEqual(oriented.eye, plan.candidates[1]!.eye);
  const unknown = { ...plan, subject: { ...s, front: undefined }, candidates: plan.candidates.map(candidate =>
    ({ ...candidate, provenance: { ...candidate.provenance, front: 'unknown' as const } })) };
  const fallback = await chooseContextPhoto(unknown, evaluate);
  assert.equal(fallback.status, 'ready');
  if (fallback.status === 'ready') { assert.deepEqual(fallback.eye, plan.candidates[3]!.eye); assert.equal(fallback.provenance.front, 'unknown'); }
  const authored = { ...plan, candidates: plan.candidates.map(c => c.id === 'view-3' ? { ...c, provenance: { ...c.provenance, camera: 'authored' as const } } : c) };
  const preferred = await chooseContextPhoto(authored, evaluate);
  assert.equal(preferred.status, 'ready');
  if (preferred.status === 'ready') assert.deepEqual(preferred.eye, plan.candidates[3]!.eye);
});

test('a valid authored camera wins; inside-solid, empty and degenerate authored views are honestly unavailable', async () => {
  const s = subject({ authoredCamera: { eye: [0, 1.2, -3], at: [0, .6, 0] }, front: { direction: [0, 0, 1], source: 'declared-front' } });
  const choice = await chooseContextPhoto(planContextPhoto(s), geometry(s));
  assert.equal(choice.status, 'ready');
  if (choice.status === 'ready') { assert.deepEqual(choice.eye, s.authoredCamera!.eye); assert.equal(choice.provenance.camera, 'authored'); }
  const solid = box('wall', [-.2, 0, -3.2], [.2, 2, -2.8]);
  const inside = await chooseContextPhoto(planContextPhoto(s), geometry(s, [solid]));
  assert.equal(inside.status, 'unavailable');
  if (inside.status === 'unavailable') assert.equal(inside.reason, 'invalid-authored-camera');
  const empty = await chooseContextPhoto(planContextPhoto(s), c => ({ ...geometry(s)(c), subjectPresent: false }));
  assert.equal(empty.status, 'unavailable');
  const invalid = subject({ authoredCamera: { eye: [0, 0, 0], at: [0, 0, 0] } });
  let calls = 0; const failed = await chooseContextPhoto(planContextPhoto(invalid), c => { calls++; return geometry(s)(c); });
  assert.equal(failed.status, 'unavailable'); assert.equal(calls, 0);
});

test('room recipe provides multiple real interior positions; an exterior probe cannot masquerade as an interior view', async () => {
  const room = { polygon: [[-3, -3], [3, -3], [3, 3], [-3, 3]] as const, floor: 0, ceiling: 3 };
  const s = subject({ interior: true, room });
  const plan = planContextPhoto(s), ordinary = plan.candidates.filter(c => c.ordinaryAllowed);
  assert.ok(ordinary.length >= 3);
  assert.ok(ordinary.every(c => Math.abs(c.eye[0]) < 3 && Math.abs(c.eye[2]) < 3 && c.eye[1] > 0 && c.eye[1] < 3));
  const walls = [box('left', [-3.2, 0, -3.2], [-3, 3, 3.2]), box('right', [3, 0, -3.2], [3.2, 3, 3.2]),
    box('back', [-3, 0, -3.2], [3, 3, -3]), box('front', [-3, 0, 3], [3, 3, 3.2]), box('roof', [-3.2, 3, -3.2], [3.2, 3.2, 3.2])];
  const choice = await chooseContextPhoto(plan, geometry(s, walls));
  assert.equal(choice.status, 'ready');
  if (choice.status === 'ready') { assert.ok(Math.abs(choice.eye[0]) < 3 && Math.abs(choice.eye[2]) < 3); assert.equal(choice.cutaway, undefined); }
  const unproved = subject({ kind: 'room', authoredCamera: { eye: [0, 1, 4], at: [0, .6, 0] } });
  const unknownRoom = await chooseContextPhoto(planContextPhoto(unproved), geometry(unproved));
  assert.equal(unknownRoom.status, 'unavailable');
  if (unknownRoom.status === 'unavailable') assert.equal(unknownRoom.reason, 'needs-viewpoint');
  const outside = { ...unproved, room }; let calls = 0;
  const invalidRoom = await chooseContextPhoto(planContextPhoto(outside), c => { calls++; return geometry(outside)(c); });
  assert.equal(invalidRoom.status, 'unavailable'); assert.equal(calls, 1, 'does not silently replace the authored outside camera');
  if (invalidRoom.status === 'unavailable') assert.equal(invalidRoom.reason, 'invalid-authored-camera');
});

test('floor navigation points frame the occupied room rather than filling the image with its floor', () => {
  // Raised and translated room, rotated in world space. This is a room target,
  // not an object whose deliberately low centre should be raised.
  const floor = .5303, ceiling = 2.9303, yaw = .37;
  const transform = (x: number, z: number): [number, number] => [12 + x * Math.cos(yaw) - z * Math.sin(yaw), -36 + x * Math.sin(yaw) + z * Math.cos(yaw)];
  const polygon = [[-3,-3],[3,-3],[3,3],[-3,3]].map(([x,z]) => transform(x!,z!));
  const room = { polygon, floor, ceiling };
  const s = subject({ kind: 'room', target: [12, floor, -36], bounds: { min: [8,floor,-40], max: [16,ceiling,-32] }, room });
  const before = structuredClone(s), plan = planContextPhoto(s);
  const shell = new THREE.Group();
  for (const [id, min, max] of [
    ['floor', [-3,floor-.2,-3], [3,floor,3]], ['left', [-3.2,floor,-3], [-3,ceiling,3]],
    ['right', [3,floor,-3], [3.2,ceiling,3]], ['back', [-3,floor,-3.2], [3,ceiling,-3]],
    ['front', [-3,floor,3], [3,ceiling,3.2]],
  ] as const) shell.add(box(id,min,max).mesh);
  shell.position.set(12,0,-36); shell.rotation.y = -yaw; shell.updateMatrixWorld(true);
  const ordinary = plan.candidates.filter(c => c.ordinaryAllowed);
  assert.ok(ordinary.length >= 4);
  const floorCoverage = (candidate: PhotoCandidate) => {
    const camera = new THREE.PerspectiveCamera(candidate.fov, s.aspect ?? 10/7, .01, 100);
    camera.position.fromArray(candidate.eye); camera.lookAt(point(candidate.at)); camera.updateMatrixWorld(true);
    let floorPixels = 0, pixels = 0;
    // Independent triangle intersections count visible floor at pixel centres.
    for (let y = 0; y < 14; y++) for (let x = 0; x < 20; x++) {
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((x+.5)/10-1,(y+.5)/7-1),camera);
      const hit = ray.intersectObject(shell,true)[0]; pixels++;
      if (hit?.object.name === 'floor') floorPixels++;
    }
    return floorPixels/pixels;
  };
  for (const candidate of ordinary)
    assert.ok(floorCoverage(candidate) < .6, `${candidate.id}: floor fills ${floorCoverage(candidate)}`);
  assert.ok(floorCoverage({...ordinary[0]!,at:s.target}) > .6,'the previous floor-point aim fails this composition oracle');
  assert.deepEqual(s,before,'navigation and geometry remain untouched');
  const slot = { ...s, target: [12,floor+1.2,-36] as const };
  assert.deepEqual(plan.candidates,planContextPhoto(slot).candidates,'equivalent elevated room slot and floor part share composition');
});

test('room aim respects low ceilings, authored framing and enclosed object centres', () => {
  const room = { polygon: [[-3,-3],[3,-3],[3,3],[-3,3]] as const, floor: -4, ceiling: -3.2 };
  const s = subject({ kind: 'room', target: [0,-4,0], bounds: { min: [-3,-4,-3],max: [3,-3.2,3] }, room });
  for (const camera of planContextPhoto(s).candidates.filter(c => c.ordinaryAllowed))
    assert.ok(camera.at[1] > room.floor && camera.at[1] < room.ceiling,'aim stays inside the resolved room height');
  const authoredCamera = { eye: [0,-3.5,-2] as const,at: [0,-3.95,0] as const };
  assert.deepEqual(planContextPhoto({...s,authoredCamera}).candidates[0]!.at,authoredCamera.at);
  for (const kind of ['part','wall-image','exterior','landscape'] as const) {
    const object = { ...s,kind };
    assert.ok(planContextPhoto(object).candidates.every(camera => camera.at === object.target),`${kind} retains its semantic aim`);
  }
});

test('room filling its enclosure uses only classified render blockers in a labelled cutaway', async () => {
  const s = subject({ kind: 'room', bounds: { min: [-2, 0, -2], max: [2, 2.8, 2] }, target: [0, 1.4, 0],
    occluders: [{ id: 'front', classification: 'wall' }, { id: 'back', classification: 'wall' }, { id: 'roof', classification: 'roof' }] });
  const walls = [box('front', [-3, 0, .8], [3, 4, 1]), box('back', [-3, 0, -1], [3, 4, -.8]), box('roof', [-3, 3, -3], [3, 3.2, 3])];
  // Target is the enclosed room region; blockers surround a smaller exact interior object for this ray fixture.
  const target = subject(), evaluate = geometry(target, walls); let calls = 0;
  const choice = await chooseContextPhoto(planContextPhoto(s), c => { calls++; return evaluate(c); });
  assert.ok(calls <= MAX_PHOTO_EVALUATIONS); assert.equal(choice.status, 'ready');
  if (choice.status === 'ready') { assert.equal(choice.cutaway?.label, 'Cutaway'); assert.ok(choice.cutaway!.occluderIds.length > 0); }
  assert.ok(walls.every(w => w.mesh.visible), 'planner never changes render or physical geometry');
});

test('unknown, facade and subject blockers cannot be cut away; ordinary views always win first', async () => {
  for (const occluder of [{ id: 'wall' }, { id: 'wall', classification: 'wall' as const, exteriorFacade: true }, { id: 'podium', classification: 'wall' as const }]) {
    const s = subject({ kind: 'room', occluders: [occluder] });
    const wall = box(occluder.id, [-20, -20, .8], [20, 20, 1]);
    const opposite = box(occluder.id, [-20, -20, -1], [20, 20, -.8]);
    let cutaways = 0;
    const choice = await chooseContextPhoto(planContextPhoto(s), c => { if (c.cutaway) cutaways++; return geometry(s, [wall, opposite])(c); });
    assert.equal(choice.status, 'unavailable'); assert.equal(cutaways, 0);
  }
});

test('wall-image framing faces the declared picture plane and fits an off-centre target without clipping', async () => {
  const s = subject({ kind: 'wall-image', bounds: { min: [-3, 1, -.01], max: [3, 3, .01] }, target: [1.2, 1.8, 0],
    front: { direction: [0, 0, 1], source: 'declared-front' }, aspect: 1 });
  const choice = await chooseContextPhoto(planContextPhoto(s), geometry(s));
  assert.equal(choice.status, 'ready');
  if (choice.status === 'ready') {
    assert.ok(choice.eye[2] > 0); assert.equal(choice.eye[1], s.target[1]);
    const selected = planContextPhoto(s).candidates.find(c => c.eye.every((x, i) => x === choice.eye[i]))!;
    assert.equal(geometry(s)(selected).clipping, 0);
  }
});

test('selection is deterministic, bounded and does not accept nonfinite geometry evidence', async () => {
  const s = subject(), plan = planContextPhoto(s), evaluate = geometry(s);
  assert.deepEqual(await chooseContextPhoto(plan, evaluate), await chooseContextPhoto(plan, evaluate));
  const choice = await chooseContextPhoto(plan, c => ({ ...evaluate(c), visibleFraction: NaN }));
  assert.equal(choice.status, 'unavailable');
  const oversized = { ...plan, candidates: Array.from({ length: 20 }, (_, i) => ({ ...plan.candidates[0]!, id: `extra-${i}` })) };
  let calls = 0; await chooseContextPhoto(oversized, c => { calls++; return evaluate(c); });
  assert.ok(calls <= MAX_PHOTO_EVALUATIONS);
});

test('six obstructed ordinary probes plus two cutaways exhaust exactly eight evaluations', async () => {
  const walls = [box('left', [-1.2, -1, -1.2], [-1, 4, 1.2]), box('right', [1, -1, -1.2], [1.2, 4, 1.2]),
    box('back', [-1, -1, -1.2], [1, 4, -1]), box('front', [-1, -1, 1], [1, 4, 1.2])];
  const s = subject({ interior: true, room: { polygon: [[-5, -5], [5, -5], [5, 5], [-5, 5]], floor: 0, ceiling: 5 },
    occluders: walls.map(w => ({ id: w.mesh.name, classification: 'wall' })) });
  const plan = planContextPhoto(s); assert.equal(plan.candidates.length, 6);
  let calls = 0; const evaluate = geometry(s, walls);
  const choice = await chooseContextPhoto(plan, c => { calls++; return evaluate(c); });
  assert.equal(calls, 8); assert.equal(choice.status, 'ready');
  if (choice.status === 'ready') assert.equal(choice.cutaway?.label, 'Cutaway');
});

test('concave room cameras avoid the missing quadrant and wall boundaries', () => {
  const s = subject({ kind: 'room', room: { polygon: [[-4, -4], [4, -4], [4, 0], [0, 0], [0, 4], [-4, 4]], floor: 0, ceiling: 3 } });
  const cameras = planContextPhoto(s).candidates.filter(c => c.ordinaryAllowed);
  assert.ok(cameras.length > 1);
  for (const { eye } of cameras) {
    assert.ok(eye[0] < 0 || eye[2] < 0, `eye ${eye} must not occupy the missing quadrant`);
    assert.ok(Math.abs(eye[0]) < 3.9 && Math.abs(eye[2]) < 3.9);
  }
});
