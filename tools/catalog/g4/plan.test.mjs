import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateGrid, coverageOf, planBatches, shotsOf, unsupported, fixturePort, nonvisualClaim } from './plan.mjs';
import { coreLibrary } from '../../../packages/world-compiler/src/library.ts';
import { WorldModel } from '../../../packages/world-compiler/src/model.ts';
const def = (i, extra = {}) => ({ publicRef: `core/item-${i}@1`, make: { kind: 'gen', gen: 'box/1' }, params: {}, ...extra });
test('G4 fixtures refuse protected and out-of-range laptop ports before spawning', () => {
  assert.equal(fixturePort(6102), 6102);
  for (const p of [4930, 4963, 4970, 6002, 6300, NaN]) assert.throws(() => fixturePort(p), /6100/);
});
test('sound and behavior changes are not claimed as visual defects or visual passes', () => {
  assert.ok(nonvisualClaim('sound=wind')); assert.ok(nonvisualClaim('behavior=perch'));
  assert.equal(nonvisualClaim('variant=blue'), null); assert.equal(nonvisualClaim('style=barn'), null);
});
test('768 refs and over 484 jobs are bounded and accounted exactly once', () => {
  const ds = Array.from({ length: 768 }, (_, i) => def(i, { params: { variant: { type: 'enum', default: 'a', values: ['a', 'b', 'c'] } } }));
  const p = planBatches(ds);
  assert.equal(p.requested.length, 768); assert.equal(p.batches.flat().length, 768);
  for (const refs of p.batches) { const jobs = refs.flatMap((ref) => shotsOf(ds.find((d) => d.publicRef === ref)).map((j) => ({ ...j, d: { publicRef: ref } }))); allocateGrid(jobs); assert.equal(new Set(jobs.map((j) => j.p.join(','))).size, jobs.length); }
  assert.throws(() => allocateGrid(Array.from({ length: 82 }, () => ({ d: def(1), label: 'default' }))), /81 cells/);
});
test('every enum alternative is scheduled; bodies, invisibles and terrain are explicit gaps', () => {
  const d = def(0, { params: { color: { type: 'enum', values: ['a', 'b', 'c', 'd', 'e'], default: 'a' } }, state: { on: { default: false } } });
  assert.equal(shotsOf(d).length, 6);
  const gaps = [def(1, { components: { body: {} } }), def(2, { make: { kind: 'none' } }), def(3, { make: { kind: 'gen', gen: 'lake/1' } })];
  assert.equal(planBatches([d, ...gaps]).gaps.length, 3); assert.ok(gaps.every(unsupported));
  assert.throws(() => planBatches([d, d]), /duplicate/);
});
test('coverage exposes missing, duplicate, unexpected and unqualified refs', () => {
  const c = coverageOf(['a', 'b', 'c'], [{ id: 'a', ok: true, views: [{}] }, { id: 'a', ok: false }, { id: 'b', status: 'unqualified', ok: false }, { id: 'x', ok: true }]);
  assert.deepEqual(c.missing, ['c']); assert.deepEqual(c.duplicate, ['a']); assert.deepEqual(c.unexpected, ['x']); assert.equal(c.unqualified, 1);
});

test('actual resolved core library: inherited renderers and nonpoint refs are not silently dropped', () => {
  const lib = coreLibrary(), model = new WorldModel({ constants: { ground: 'land' }, seed: 'g4-test' }); model.library = lib;
  const defs = lib.all().map((d) => model.resolvedDef(d.ref)), plan = planBatches(defs);
  assert.equal(plan.requested.length, lib.all().length);
  assert.equal(new Set([...plan.batches.flat(), ...plan.gaps.map((i) => i.id)]).size, lib.all().length);
  assert.ok(plan.batches.flat().includes('core/bakery@1')); // raw make:none inherits its parent renderer
  assert.ok(plan.batches.flat().includes('core/fence@1'));
  assert.ok(plan.batches.flat().includes('core/plaza@1'));
  assert.ok(plan.gaps.some((i) => i.id === 'core/humanoid@2' && i.status === 'unqualified'));
});
