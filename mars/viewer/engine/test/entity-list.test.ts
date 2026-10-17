// One entity list per invariant pass (world/entity-list.ts, lane L1 tick cost): the shared list is exactly
// Object.values' list, only inside the pass, and a runtime's violations are the same as when every invariant lists
// the world itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { entitiesById, entityList, listEntities, withEntityList } from '../world/entity-list.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { Entity, WorldState } from '../world/types.ts';

const open = (half: number): SpatialScene => ({
  bounds: [-half, -half, half, half],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [half, half], yaw: 0 } }],
  obstacles: [],
  links: [],
});
const fixtures = (n: number): Entity[] =>
  Array.from({ length: n }, (_, i) => ({ ...component(`f${(i * 7919) % n}`, 'test-wall', [-15 + (i % 30), 0, 12 + Math.floor(i / 30)], 0, { phase: 'stored' }), kind: 'fixture' as const }));
/** A world that breaks several invariants at once: overlapping people, an unsupported part, a part held by nobody. */
function world(): WorldState {
  return addAll(
    emptyWorld('open', open(30)),
    ...fixtures(120),
    human('p1', 0, 0), human('p2', 0.2, 0), human('p3', 5, 5),
    component('loose', 'beam-12ft', [8, 0, -8], 0, { phase: 'staged', support: { kind: 'none' } }),
    component('ghost-held', 'beam-12ft', [-8, 0, -8], 0, { phase: 'staged', support: { kind: 'held', by: ['nobody'] } }),
  );
}

test('entity list: fresh outside a pass, one shared list (Object.values order) inside it, scoped to its world', () => {
  const w = world(), other = world();
  const a = entityList(w), b = entityList(w);
  assert.notEqual(a, b, 'outside a pass each call lists the world afresh');
  assert.deepEqual(a, Object.values(w.entities));
  withEntityList(w, () => {
    const s = entityList(w);
    assert.equal(entityList(w), s, 'one list for the whole pass');
    assert.deepEqual(s, Object.values(w.entities));
    const byId = entitiesById(w);
    assert.equal(entitiesById(w), byId);
    assert.deepEqual(byId.map((e) => e.id), Object.keys(w.entities).sort());
    assert.deepEqual(s.map((e) => e.id), Object.keys(w.entities), 'sorting by id leaves the shared list alone');
    assert.notEqual(entityList(other), entityList(other), 'another world is listed afresh');
    withEntityList(other, () => assert.equal(entityList(other), entityList(other)));
    assert.equal(entityList(w), s, 'the outer pass is back after a nested one');
  });
  assert.notEqual(entityList(w), entityList(w), 'nothing is kept after the pass');
  assert.deepEqual(entitiesById(w).map((e) => e.id), Object.keys(w.entities).sort());
});

test('listEntities is Object.values: integer-like keys first (ascending), then insertion order, own keys only', () => {
  const proto = { inherited: { id: 'x' } } as unknown as WorldState['entities'];
  const ents = Object.assign(Object.create(proto), { b: { id: 'b' }, '10': { id: '10' }, a: { id: 'a' }, '2': { id: '2' }, '-1': { id: '-1' }, '01': { id: '01' } }) as WorldState['entities'];
  delete (ents as Record<string, unknown>).a; (ents as Record<string, unknown>).a = { id: 'a2' };
  assert.deepEqual(listEntities(ents), Object.values(ents));
  assert.deepEqual(listEntities(ents).map((e) => e.id), ['2', '10', 'b', '-1', '01', 'a2']);
  const w = world();
  assert.deepEqual(listEntities(w.entities), Object.values(w.entities));
});

test('a runtime\'s violations and state are the same as with every invariant listing the world itself', () => {
  const unscoped = world();   // an unrelated world: a nested pass for it makes every invariant list rt.world afresh (the old code)
  const shared = new Runtime(world(), createRegistry(), { spatial: new Spatial(open(30)) }, ENGINE_INVARIANTS);
  const own = new Runtime(world(), createRegistry(), { spatial: new Spatial(open(30)) }, ENGINE_INVARIANTS.map((inv) => (rt: Runtime) => withEntityList(unscoped, () => inv(rt))));
  for (const rt of [shared, own]) rt.submit('walk_to', { actor: 'p3', x: 12, z: 6 });
  for (let t = 0; t < 120; t++) {
    if (t === 40) for (const rt of [shared, own]) rt.world.entities.p1.pose.p = [3, 0, 0];   // a teleport (motion.teleport, stateful)
    shared.step(); own.step();
    assert.equal(shared.stateHash(), own.stateHash(), `tick ${t}`);
  }
  assert.ok(shared.violations.length > 100, `violations recorded (${shared.violations.length})`);
  assert.deepEqual(new Set(shared.violations.map((v) => v.code)), new Set(['collision.human-human', 'support.unsupported', 'support.holder-missing', 'motion.teleport']));
  assert.deepEqual(shared.violations, own.violations);
  assert.deepEqual(shared.events, own.events);
});
