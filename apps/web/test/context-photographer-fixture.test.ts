import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { chooseContextPhoto, planContextPhoto, type PhotoCandidate, type PhotoSubject } from '../src/context-photographer.ts';

// Compile the unchanged five-subject fixture and its frozen cover edit. No
// server/browser or PNG capture: real generator triangles support regression
// evidence; they do not establish image composition or pixel-mask visibility.
const referenceRoot = resolve(process.env.PHOTOGRAPHER_CONTEXT_ROOT ?? fileURLToPath(new URL('../../..', import.meta.url)));
const load = (path: string): Promise<any> => import(pathToFileURL(join(referenceRoot, path)).href);
const [base, { photographerEdit }, { Db }, { GodMode }, scene, photoScene, { MaterialLib }, { meshFor }, { GENERATORS }] = await Promise.all([
  load('tools/context-views/fixture.mjs'), load('tools/context-views/photographer-fixture.mjs'),
  load('apps/server/src/db.ts'), load('apps/server/src/god/god.ts'), load('apps/server/src/god/context-view-scene.ts'),
  load('apps/web/src/context-photo-scene.ts'), load('apps/web/src/gen-mesh/materials.ts'),
  load('apps/web/src/gen-mesh/registry.ts'), load('packages/generators/src/index.ts'),
]);
await load('apps/web/src/gen-mesh/building.mesh.ts');
await load('apps/web/src/gen-mesh/kit.mesh.ts');

function actualSubject(name: string, covered = false) {
  const db = new Db(':memory:'), god = new GodMode(db, { genesis: base.genesis, worldId: 'context-baseline-1', ownerId: null,
    tick: () => 1, emit() {}, assetDir: mkdtempSync(join(tmpdir(), 'photographer-geometry-')) });
  if (covered) {
    const result = god.act({ ops: photographerEdit('classified-roof', [...god.model.entities.values()]) });
    assert.equal(result.accepted, true, JSON.stringify(result).slice(0, 500));
  }
  const entries: { id: string; entity: string; mesh: THREE.Mesh }[] = [];
  for (const entity of god.model.entities.values()) {
    if (!['hall', 'podium', 'artwork', 'photographer-roof-cover'].includes(entity.name)) continue;
    const def = god.model.resolvedDef(entity.def), params = Object.fromEntries(Object.entries({ ...GENERATORS[def.make.gen].params, ...def.params })
      .filter(([, field]: [string, any]) => field.default !== undefined).map(([key, field]: [string, any]) => [key, field.default]));
    Object.assign(params, entity.params);
    const root = meshFor(def).build({ canonicalContext: true, def, entity, params, args: def.make.args ?? {},
      baked: god.model.bake(def, entity.params ?? {}, entity.seed ?? 0, entity.shape), model: god.model,
      materials: new MaterialLib(), tint: (_key: unknown, fallback: string) => fallback });
    const pose = god.model.worldPose(entity);
    root.position.set(pose.x, pose.y, pose.z); root.rotation.y = pose.yaw; root.scale.setScalar(pose.s); root.updateMatrixWorld(true);
    const walk = (object: THREE.Object3D, path: string) => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh;
        mesh.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        entries.push({ id: `${entity.id}:${path}`, entity: entity.id, mesh });
      }
      object.children.forEach((child, i) => walk(child, `${path}.${i}`));
    };
    walk(root, '0');
  }
  const entity = [...god.model.entities.values()].find((entity: any) => entity.name === name) as any;
  const target = scene.contextTargets(god.model).find((target: any) => target.ref === entity.id);
  const selection = photoScene.contextPhotoScene({ ...target, interior: true, room: scene.contextRoom(god.model, target),
    subjectKind: name === 'artwork' ? 'wall-image' : 'part', fixedCamera: false }, entries);
  assert.ok(selection);
  return { db, entries, subject: selection.subject as PhotoSubject, dispose: () => { selection.dispose(); db.close(); } };
}

function triangleEvidence(s: PhotoSubject, entries: ReturnType<typeof actualSubject>['entries']) {
  return (candidate: PhotoCandidate) => {
    const camera = new THREE.PerspectiveCamera(candidate.fov, s.aspect ?? 10 / 7, .01, 10000);
    camera.position.fromArray(candidate.eye); camera.lookAt(new THREE.Vector3(...candidate.at)); camera.updateMatrixWorld(true);
    const subjectIds = new Set(s.objectIds), active = entries.filter(entry => !candidate.cutaway?.occluderIds.includes(entry.id));
    const occluders = active.filter(entry => !subjectIds.has(entry.id)), blockerIds = new Set<string>();
    let visible = 0, clipped = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) for (const z of [0, .5, 1]) {
      const point = new THREE.Vector3(s.bounds.min[0] + x * (s.bounds.max[0] - s.bounds.min[0]),
        s.bounds.min[1] + y * (s.bounds.max[1] - s.bounds.min[1]), s.bounds.min[2] + z * (s.bounds.max[2] - s.bounds.min[2]));
      const projected = point.clone().project(camera);
      x0 = Math.min(x0, projected.x); x1 = Math.max(x1, projected.x); y0 = Math.min(y0, projected.y); y1 = Math.max(y1, projected.y);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) clipped++;
      const delta = point.sub(camera.position), ray = new THREE.Raycaster(camera.position, delta.clone().normalize(), .01, delta.length() - .01);
      const hits = ray.intersectObjects(occluders.map(entry => entry.mesh), false);
      if (!hits.length) visible++;
      for (const hit of hits) blockerIds.add(occluders.find(entry => entry.mesh === hit.object)!.id);
    }
    const geometry = photoScene.contextPhotoGeometry(s, candidate, entries);
    return { ...geometry, subjectPresent: true, visibleFraction: visible / 27,
      projectedFill: Math.min(1, Math.max(0, (x1 - x0) * (y1 - y0) / 4)), clipping: clipped / 27, occluderIds: [...blockerIds] };
  };
}

test('actual retained wall artwork has a tightly fitted ordinary camera inside the real hall', async () => {
  const actual = actualSubject('artwork');
  try {
    const plan = planContextPhoto(actual.subject), choice = await chooseContextPhoto(plan, triangleEvidence(actual.subject, actual.entries));
    assert.equal(choice.status, 'ready');
    if (choice.status === 'ready') {
      assert.equal(choice.cutaway, undefined);
      assert.ok(plan.candidates.some(candidate => candidate.ordinaryAllowed && candidate.eye.every((n, i) => n === choice.eye[i])));
      assert.ok(choice.scores.length <= 6);
    }
  } finally { actual.dispose(); }
});

test('actual nested roof-cover fixture permits only classified roof removal from a close interior probe', async () => {
  const actual = actualSubject('podium', true);
  try {
    const evidence = triangleEvidence(actual.subject, actual.entries), evaluations: unknown[] = [];
    const choice = await chooseContextPhoto(planContextPhoto(actual.subject), candidate => {
      const result = evidence(candidate); evaluations.push({ id: candidate.id, eye: candidate.eye, cutaway: candidate.cutaway, ...result }); return result;
    });
    const structures = actual.entries.filter(entry => entry.entity !== actual.subject.objectIds[0]!.split(':')[0]).map(entry => ({
      id: entry.id, group: entry.mesh.parent?.name, name: entry.mesh.name,
      min: new THREE.Box3().setFromObject(entry.mesh).min.toArray(), max: new THREE.Box3().setFromObject(entry.mesh).max.toArray(),
      structure: entry.mesh.userData.contextStructure,
    }));
    assert.equal(choice.status, 'ready', JSON.stringify({ subject: actual.subject, choice, evaluations, structures }));
    if (choice.status === 'ready') {
      assert.equal(choice.cutaway?.label, 'Cutaway');
      assert.ok(choice.cutaway!.occluderIds.length > 0);
      for (const id of choice.cutaway!.occluderIds) {
        assert.equal(actual.entries.find(entry => entry.id === id)!.mesh.userData.contextStructure?.classification, 'roof');
        assert.ok(!actual.subject.objectIds.includes(id));
      }
      assert.ok(choice.scores.length <= 8);
    }
  } finally { actual.dispose(); }
});
