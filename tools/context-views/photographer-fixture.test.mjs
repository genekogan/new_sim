import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { photographerFixture, bindPhotographerFixture, photographerEdit, assertPhotographerBudget } from './photographer-fixture.mjs';

// Only needed before coordinator integration: resolve the owner's exact shared
// fixture/server sources without copying them or changing the five-case fixture.
const referenceRoot = resolve(process.env.PHOTOGRAPHER_CONTEXT_ROOT ?? fileURLToPath(new URL('../..', import.meta.url)));
const load = path => import(pathToFileURL(join(referenceRoot, path)).href);
const [base, { bindCases }, { Db }, { GodMode }, scene] = await Promise.all([
  load('tools/context-views/fixture.mjs'), load('tools/context-views/bindings.mjs'),
  load('apps/server/src/db.ts'), load('apps/server/src/god/god.ts'), load('apps/server/src/god/context-view-scene.ts'),
]);
const [{ MaterialLib }, { meshFor }, { GENERATORS }] = await Promise.all([
  load('apps/web/src/gen-mesh/materials.ts'), load('apps/web/src/gen-mesh/registry.ts'), load('packages/generators/src/index.ts'),
]);
await load('apps/web/src/gen-mesh/building.mesh.ts');
await load('apps/web/src/gen-mesh/basic.mesh.ts');
const fixture = photographerFixture(base);
function world() {
  const db = new Db(':memory:');
  const god = new GodMode(db, { genesis: fixture.genesis, worldId: 'photographer-fixture', ownerId: null,
    tick: () => 1, emit() {}, assetDir: mkdtempSync(join(tmpdir(), 'photographer-fixture-')) });
  const targets = () => scene.contextTargets(god.model).map(t => ({ ...t, enclosed: scene.contextEnclosed(god.model, t) }));
  const bind = () => bindPhotographerFixture(fixture, [...god.model.entities.values()], targets(), bindCases);
  return { db, god, targets, bind };
}
const near = (actual, expected) => { assert.equal(actual.length, expected.length); actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-6, `${actual} != ${expected}`)); };

test('extension preserves all five original subjects and binds actual room/exterior', () => {
  assert.deepEqual(fixture.genesis, base.genesis); assert.deepEqual(fixture.cases, base.cases);
  assert.equal(fixture.steps.length, 11); assert.equal(fixture.steps.filter(s => !s.optional).length, 10);
  const w = world();
  try {
    const bindings = w.bind(), room = bindings.find(b => b.id === 'enclosed-room');
    assert.equal(bindings.length, 6); assert.notEqual(room.slot, 'ground');
    assert.equal(w.god.model.slotsOf(w.god.model.entities.get(room.entity)).find(s => s.id === room.slot)?.kind, 'room');
    const seat = bindings.find(b => b.id === 'interior-seat');
    const roomShape = scene.contextRoom(w.god.model, w.targets().find(t => t.ref === seat.ref));
    assert.ok(roomShape?.polygon.length >= 3); assert.ok(roomShape.ceiling > roomShape.floor);
    assert.throws(() => bindPhotographerFixture(fixture, [...w.god.model.entities.values()], w.targets().filter(t => t.ref !== room.ref), bindCases), /exactly one enclosed room/);
  } finally { w.db.close(); }
});

test('declared front and authored camera follow real parent and owner transforms', () => {
  for (const id of ['declared-front-rotation', 'transformed-authored']) {
    const w = world();
    try {
      const result = w.god.act({ ops: photographerEdit(id, [...w.god.model.entities.values()]) });
      assert.equal(result.accepted, true, JSON.stringify(result).slice(0, 1000));
      const seat = [...w.god.model.entities.values()].find(e => e.name === 'podium');
      const target = w.targets().find(t => t.ref === seat.id);
      const pose = w.god.model.worldPose(seat), localFront = seat.about.front;
      near(target.front.direction, [(localFront[0] * Math.cos(pose.yaw) + localFront[1] * Math.sin(pose.yaw)), 0,
        (-localFront[0] * Math.sin(pose.yaw) + localFront[1] * Math.cos(pose.yaw))]);
      assert.equal(target.front.source, 'declared-front');
      if (id === 'transformed-authored') {
        near(target.viewpoint.eye, scene.localContextPoint(w.god.model, seat, seat.about.viewpoint.eye));
        near(target.viewpoint.at, scene.localContextPoint(w.god.model, seat, seat.about.viewpoint.at));
        assert.ok(scene.contextRoom(w.god.model, target));
      }
      assert.equal(w.bind().find(b => b.id === 'interior-seat').ref, seat.id);
    } finally { w.db.close(); }
  }
});

test('entrance evidence comes from actual baked exterior openings, never yaw', () => {
  const w = world();
  try {
    const binding = w.bind().find(b => b.id === 'hall-exterior'), hall = w.god.model.entities.get(binding.entity);
    const def = w.god.model.resolvedDef(hall.def);
    const openings = w.god.model.bake(def, hall.params ?? {}, hall.seed ?? 0, hall.shape).openings
      .filter(o => o.exterior && ['door', 'gate', 'arch'].includes(o.kind));
    assert.ok(openings.length > 0, 'fixture has an actual exterior entrance');
    const front = scene.contextFront(w.god.model, hall);
    assert.equal(front.source, 'entrance');
    const result = w.god.act({ ops: photographerEdit('entrance-occluder', [...w.god.model.entities.values()]) });
    assert.equal(result.accepted, true, JSON.stringify(result).slice(0, 1000));
    assert.deepEqual(scene.contextFront(w.god.model, hall), front, 'wall changes visibility, not front evidence');
  } finally { w.db.close(); }
});

test('roof and unknown obstruction are real independently frozen variants with unchanged subject binding', () => {
  for (const id of ['classified-roof', 'unclassified-obstruction']) {
    const w = world();
    try {
      const before = w.bind().find(b => b.id === 'interior-seat');
      const result = w.god.act({ ops: photographerEdit(id, [...w.god.model.entities.values()]) });
      assert.equal(result.accepted, true, JSON.stringify(result).slice(0, 1000));
      const cover = [...w.god.model.entities.values()].find(e => e.name === (id === 'classified-roof' ? 'photographer-roof-cover' : 'photographer-opaque-cover'));
      const def = w.god.model.resolvedDef(cover.def);
      assert.equal(def.make.gen, id === 'classified-roof' ? 'building/1' : 'box/1');
      assert.equal(cover.in.parent, [...w.god.model.entities.values()].find(e => e.name === 'hall').id);
      assert.equal(w.bind().find(b => b.id === 'interior-seat').ref, before.ref);
      assert.equal(cover.userData, undefined, 'authoring never injects trusted mesh classification');
      const params = Object.fromEntries(Object.entries({ ...GENERATORS[def.make.gen].params, ...def.params })
        .filter(([, field]) => field.default !== undefined).map(([key, field]) => [key, field.default]));
      Object.assign(params, cover.params);
      const mesh = meshFor(def).build({ canonicalContext: true, def, entity: cover, params, args: def.make.args ?? {},
        baked: w.god.model.bake(def, params, cover.seed ?? 0, cover.shape), model: w.god.model,
        materials: new MaterialLib(), tint: (_key, fallback) => fallback });
      const structures = [];
      mesh.traverse(object => { if (object.userData.contextStructure) structures.push(object.userData.contextStructure); });
      if (id === 'classified-roof') {
        assert.ok(structures.some(s => s.classification === 'roof' && !s.exteriorFacade));
        assert.ok(structures.filter(s => s.classification === 'wall').every(s => s.exteriorFacade));
      } else assert.equal(structures.length, 0, 'box geometry cannot acquire roof evidence from its name/position');
    } finally { w.db.close(); }
  }
});

test('result/evaluation ceilings include unavailable cases', () => {
  assertPhotographerBudget(fixture.steps.map(s => ({ id: s.id, status: 'unavailable' })));
  assert.throws(() => assertPhotographerBudget(Array.from({ length: 12 }, () => ({ status: 'unavailable' }))), /result ceiling/);
  assert.throws(() => assertPhotographerBudget(Array.from({ length: 11 }, () => ({ url: 'fixture.png' }))), /image ceiling/);
  assertPhotographerBudget([{ photo: { status: 'ready', scores: Array(8).fill({}) } },
    { status: 'unavailable', photo: { status: 'unavailable', diagnostics: Array(8).fill({}) } }]);
  assert.throws(() => assertPhotographerBudget([{ photo: { status: 'ready', scores: Array(9).fill({}) } }]), /evaluation ceiling/);
  assert.throws(() => assertPhotographerBudget([{ status: 'unavailable', photo: { status: 'unavailable', diagnostics: Array(9).fill({}) } }]), /evaluation ceiling/);
});
