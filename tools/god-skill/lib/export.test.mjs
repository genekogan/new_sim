import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch } from '../../../packages/world-compiler/src/index.ts';
import { exportGenesis } from './export.mjs';

const world = () => new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'export' });
const definition = (name, extra = {}) => ({ schema: 'def/1', name, version: 1, form: 'point', make: { kind: 'none' },
  size: { box: [1, 1, 1] }, anchor: 'base', layer: 'decor', ...extra });
const entity = (id, def, extra = {}) => ({ id, name: id, def, in: { parent: 'world' }, p: [0, 0, 0], ...extra });
const snapshot = (defs, entities, extra = {}) => ({ worldId: 'test', seq: 5, constants: { extent: 100, ground: 'land' },
  state: { sky: {}, weather: {}, layers: { wallets: { private: 9 } } }, library: defs, defs, entities, ...extra });
const operations = (genesis) => genesis.batches.flatMap((b) => b.ops);

test('same-major SHA revisions export exact bytes and import both hashes', () => {
  const source = world();
  const a = source.defineDef(definition('core-revision', { description: 'one' }), 'core', 0);
  const b = source.defineDef(definition('core-revision', { description: 'two' }), 'core', 0);
  const s = snapshot([a, b], [entity('one', 'sha:' + a.hash), entity('two', 'sha:' + b.hash, { p: [4, 0, 0] })]);
  const before = JSON.stringify(s), g = exportGenesis(s), destination = world();
  for (const batch of g.batches) {
    const result = applyBatch(destination, batch, 'god', 1).result;
    assert.equal(result.accepted, true, JSON.stringify(result));
  }
  assert.equal(destination.def('sha:' + a.hash).hash, a.hash);
  assert.equal(destination.def('sha:' + b.hash).hash, b.hash);
  assert.equal(JSON.stringify(s), before, 'export is pure');
  assert.equal(g.state.layers, undefined);
  for (const op of operations(g).filter((o) => o.op === 'define'))
    for (const field of ['hash', 'ref', 'born', 'budget', 'by']) assert.equal(op.def[field], undefined);
});

test('inheritance and prefab dependencies precede parents; expanded children are skipped', () => {
  const w = world(), base = w.defineDef(definition('core-base'), 'core', 0);
  const part = w.defineDef(definition('core-part', { extends: 'sha:' + base.hash }), 'core', 0);
  const prefab = w.defineDef(definition('core-prefab', { make: { kind: 'parts', parts: [{ id: 'part', def: 'sha:' + part.hash }] } }), 'core', 0);
  const g = exportGenesis(snapshot([prefab, part, base], [entity('child', 'sha:' + part.hash, { in: { parent: 'parent' } }), entity('parent', 'sha:' + prefab.hash)]));
  const ops = operations(g);
  assert.deepEqual(ops.filter((o) => o.op === 'define').map((o) => o.def.name), ['core-base', 'core-part', 'core-prefab']);
  assert.deepEqual(ops.filter((o) => o.op === 'place').map((o) => o.name), ['parent']);
});

test('explicit blocked dependency fails export; legacy metadata adds no restriction', () => {
  const w = world(), base = w.defineDef(definition('private-base'), 'human', 0);
  const item = w.defineDef(definition('custom-item', { extends: 'sha:' + base.hash }), 'human', 0);
  const s = snapshot([item, base], [entity('item', item.ref)]);
  assert.throws(() => exportGenesis({ ...s, exportBlockedHashes: [base.hash] }), /export restricted/);
  assert.deepEqual(operations(exportGenesis(s)).filter((o) => o.op === 'define').map((o) => o.def.name), ['private-base', 'custom-item']);
  assert.throws(() => exportGenesis(snapshot([], [entity('missing', 'sha:' + 'a'.repeat(64))])), /missing pinned/);
});

test('legacy native core refs keep template behavior and batch parent paths', () => {
  const w = world(), native = w.defineDef(definition('core-native'), 'core', 0);
  const entities = Array.from({ length: 200 }, (_, i) => entity('item' + i, native.ref));
  entities.push(entity('child', native.ref, { in: { parent: 'item0' }, p: [1, 2, 3] }));
  const g = exportGenesis(snapshot([native], entities));
  assert.equal(operations(g).some((op) => op.op === 'define'), false);
  assert.equal(g.batches[1].ops[0].in.parent, 'item0');
  assert.deepEqual(g.batches[1].ops[0].p, [1, 2, 3]);
});
