// Focused closure regression. Optional SIM_TEST_SOURCE targets a frozen candidate checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const source = process.env.SIM_TEST_SOURCE ? pathToFileURL(resolve(process.env.SIM_TEST_SOURCE) + '/') : new URL('../../', import.meta.url);
const { WorldModel, applyBatch } = await import(new URL('packages/world-compiler/src/index.ts', source));
const { Db } = await import(new URL('apps/server/src/db.ts', source));
const { GodMode } = await import(new URL('apps/server/src/god/god.ts', source));
const { exportGenesis } = await import(new URL('tools/god-skill/lib/export.mjs', source));
const world = () => new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'nested-fixture' });
const raw = (name, extra = {}) => ({ schema: 'def/1', name, version: 1, form: 'point', make: { kind: 'none' },
  size: { box: [1, 1, 1] }, anchor: 'base', layer: 'decor', ...extra });
function fixture() {
  const model = world(), leaf = model.defineDef(raw('core-nested-leaf'), 'core', 0);
  const middle = model.defineDef(raw('core-nested-middle', { params: { target: { type: 'ref', default: 'sha:' + leaf.hash } } }), 'core', 0);
  const override = model.defineDef(raw('core-nested-override'), 'core', 0);
  const root = model.defineDef(raw('core-nested-root', { params: {
    palette: { type: 'json', default: { theme: { preferred: 'sha:' + middle.hash }, alternatives: [{ def: 'sha:' + leaf.hash }] } },
    reference: { type: 'ref', default: 'sha:' + middle.hash },
  } }), 'core', 0);
  const defs = [leaf, middle, override, root], map = new Map(defs.flatMap((d) => [[d.ref, d], ['sha:' + d.hash, d]]));
  const library = { id: 'registry:nested-fixture', version: '1', get: (key) => map.get(key), all: () => [] };
  const ops = [{ op: 'place', def: 'sha:' + root.hash, name: 'root', p: [0, 0, 0] }];
  return { root, middle, leaf, override, defs, library, ops };
}

test('compiler adopts nested declared JSON/ref defaults and recursive dependency closure from cold library', () => {
  const f = fixture(), model = world(); model.library = f.library;
  const result = applyBatch(model, { ops: f.ops }, 'god', 1);
  assert.equal(result.result.accepted, true, JSON.stringify(result.result));
  assert.deepEqual(new Set(model.snapshot().defs.map((d) => d.hash)), new Set([f.root.hash, f.middle.hash, f.leaf.hash]));
  const reloaded = WorldModel.fromSnapshot(model.snapshot());
  assert.equal(reloaded.def('sha:' + f.middle.hash).params.target.default, 'sha:' + f.leaf.hash);
  assert.equal(reloaded.def('sha:' + f.leaf.hash).hash, f.leaf.hash);
});

test('GodMode snapshot and durable reload retain nested entity overrides plus default dependency closure', () => {
  const f = fixture(), dir = mkdtempSync(join(tmpdir(), 'nested-snapshot-')), db = new Db(':memory:');
  try {
    const opts = { worldId: 'nested-proof', ownerId: 'owner', tick: () => 1, emit: () => {}, library: f.library, assetDir: join(dir, 'assets') };
    const god = new GodMode(db, opts);
    const result = god.act({ ops: [{ ...f.ops[0], params: { palette: { choices: [{ nested: 'sha:' + f.override.hash }] } } }] });
    assert.equal(result.accepted, true, JSON.stringify(result));
    const expected = new Set(f.defs.map((d) => d.hash));
    assert.deepEqual(new Set(god.publicSnapshot().defs.map((d) => d.hash)), expected);
    const reload = new GodMode(db, opts);
    assert.deepEqual(new Set(reload.publicSnapshot().defs.map((d) => d.hash)), expected);
    assert.equal(reload.model.def('sha:' + f.override.hash).hash, f.override.hash);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('export includes nested declared parameter dependencies and rejects a restricted transitive leaf', () => {
  const f = fixture(), model = world(); model.library = f.library;
  assert.equal(applyBatch(model, { ops: f.ops }, 'god', 1).result.accepted, true);
  const s = model.snapshot(), snapshot = { ...s, worldId: 'nested', seq: s.editSeq, library: [] };
  const exported = exportGenesis(snapshot), defs = exported.batches.flatMap((b) => b.ops).filter((op) => op.op === 'define').map((op) => op.def.name);
  assert.deepEqual(defs, ['core-nested-leaf', 'core-nested-middle', 'core-nested-root']);
  const imported = world();
  for (const batch of exported.batches) assert.equal(applyBatch(imported, batch, 'god', 1).result.accepted, true);
  for (const dependency of [f.leaf, f.middle, f.root]) assert.equal(imported.def('sha:' + dependency.hash).hash, dependency.hash);
  assert.throws(() => exportGenesis({ ...snapshot, exportBlockedHashes: [f.leaf.hash] }), /export restricted/);
});

test('export includes runtime nested JSON overrides and checks their redistribution permission', () => {
  const f = fixture(), model = world(); model.library = f.library;
  assert.equal(applyBatch(model, { ops: [{ ...f.ops[0], params: { palette: { choices: [{ nested: 'sha:' + f.override.hash }] } } }] }, 'god', 1).result.accepted, true);
  const s = model.snapshot(), snapshot = { ...s, worldId: 'nested', seq: s.editSeq, library: [] };
  const defs = exportGenesis(snapshot).batches.flatMap((b) => b.ops).filter((op) => op.op === 'define');
  assert.ok(defs.some((op) => op.def.name === f.override.name), 'override dependency bytes travel with the world');
  assert.throws(() => exportGenesis({ ...snapshot, exportBlockedHashes: [f.override.hash] }), /export restricted/);
});
