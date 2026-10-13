import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldModel, applyBatch, hashOf, type DefInput } from '@sim/world-compiler';
import { Registry } from './registry.ts';
import { makeItem, writeCore } from './import-core.ts';
import { loadContract } from './contract.ts';
import { pinReleaseSeed } from './pin-seed.ts';
import { RegistryCatalog } from './serving.ts';

const world = () => new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'seed-pin' });
const input = (name: string, extra = {}) => ({ schema: 'def/1', name, version: 1, form: 'point', make: { kind: 'none' },
  size: { box: [1, 1, 1] }, anchor: 'base', layer: 'decor', ...extra }) as DefInput;
const at = '2026-10-12T12:00:00.000Z';
async function fixture(restricted = false) {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-seed-pinning-')), registry = new Registry(dir), legacy = world();
  const base = legacy.defineDef(input('core-seed-base', { params: { color: { type: 'string', default: 'blue' } } }), 'core', 0);
  const child = legacy.defineDef(input('core-seed-child', { extends: base.ref }), 'core', 0);
  const prefab = legacy.defineDef(input('core-seed-prefab', { make: { kind: 'parts', parts: [{ id: 'part', def: child.ref }] },
    contents: [{ id: 'content', def: base.ref }], params: { kind: { type: 'string', default: base.ref } } }), 'core', 0);
  const rows = await Promise.all([base, child, prefab].map(async (def) => {
    const { item, up } = await makeItem(def, { at, run: 'seed', author: 'test', contract: loadContract() });
    if (restricted && def === base) item.licence = { spdx: 'third-party-restricted', redistribute: false, source: 'test source' };
    return { def, item, up };
  }));
  writeCore(registry, rows, 'seed');
  return { dir, registry, legacy, base, child, prefab };
}

test('release seed freezes preset, prefab, contents and def defaults; original snapshots and legacy worlds remain exact', async () => {
  const f = await fixture();
  try {
    const oldSnapshot = JSON.stringify(f.legacy.snapshot()), original = JSON.stringify(f.registry.snapshot('stable', 1));
    const result = pinReleaseSeed(f.registry, 'pin'), child = result.entries.find((e) => e.id === 'eden/seed-child')!, prefab = result.entries.find((e) => e.id === 'eden/seed-prefab')!;
    const raw = f.registry.def1(prefab.def1Hash!) as DefInput;
    assert.equal((f.registry.def1(child.def1Hash!) as DefInput).extends, 'sha:' + f.base.hash);
    assert.equal(raw.make.kind === 'parts' && raw.make.parts[0].def, 'sha:' + child.def1Hash);
    assert.equal(raw.contents![0].def, 'sha:' + f.base.hash);
    assert.equal(raw.params!.kind.default, 'sha:' + f.base.hash);
    const fresh = world(); fresh.library = new RegistryCatalog(f.registry, { hot: 0 });
    const placed = applyBatch(fresh, { ops: [{ op: 'place', def: 'eden/seed-prefab@1', name: 'prefab', p: [0, 0, 0] }] }, 'god', 1);
    assert.ok(placed.result.accepted, JSON.stringify(placed.result));
    assert.equal(fresh.snapshot().entities.find((e) => e.name === 'part')!.def, 'sha:' + child.def1Hash);
    assert.equal(fresh.resolvedDef(fresh.snapshot().entities.find((e) => e.name === 'part')!.def)!.params.color.default, 'blue');
    assert.equal(JSON.stringify(f.registry.snapshot('stable', 1)), original);
    assert.equal(JSON.stringify(f.legacy.snapshot()), oldSnapshot);
    assert.deepEqual(f.registry.def1(f.child.hash), { ...f.registry.def1(f.child.hash) as object, extends: f.base.ref });
    assert.equal(f.registry.item(child.id, child.major, child.rev, child.itemHash)!.tests.gates.G4!.grandfathered, true);
    assert.throws(() => pinReleaseSeed(f.registry, 'again'), /fresh unpublished/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('first child use after base revision update, reload, yank and rollback resolves the original frozen dependency', async () => {
  const f = await fixture();
  try {
    pinReleaseSeed(f.registry, 'pin'); const pinned = f.registry.resolve('eden/seed-child@1')!, pinnedSeq = f.registry.pointers().stable!;
    const next = world().defineDef(input('core-seed-base', { params: { color: { type: 'string', default: 'red' } } }), 'core', 0);
    const row = await makeItem(next, { at, run: 'update', author: 'test', contract: loadContract() });
    writeCore(f.registry, [{ def: next, ...row }], 'update');
    const cat = new RegistryCatalog(f.registry, { hot: 0 }), fresh = world(); fresh.library = cat;
    assert.equal(cat.get('eden/seed-base@1')!.hash, next.hash);
    assert.equal(cat.get('sha:' + f.base.hash)!.hash, f.base.hash);
    assert.ok(applyBatch(fresh, { ops: [{ op: 'place', def: 'eden/seed-child@1', name: 'child', p: [0, 0, 0] }] }, 'god', 1).result.accepted);
    assert.equal(fresh.resolvedDef(fresh.get('child')!.def)!.params.color.default, 'blue');
    const reloaded = WorldModel.fromSnapshot(fresh.snapshot(), undefined, cat);
    assert.equal(reloaded.resolvedDef(reloaded.get('child')!.def)!.params.color.default, 'blue');
    f.registry.yank('eden/seed-base', 1, 'yank', 'test');
    assert.equal(cat.get('eden/seed-base@1'), undefined);
    assert.equal(cat.get('sha:' + f.base.hash)!.hash, f.base.hash);
    assert.equal(reloaded.resolvedDef(reloaded.get('child')!.def)!.params.color.default, 'blue');
    f.registry.rollback('stable', 'rollback', pinnedSeq);
    assert.equal(cat.get('eden/seed-base@1')!.hash, f.base.hash);
    assert.equal(cat.get('sha:' + pinned.def1Hash)!.hash, pinned.def1Hash);
    assert.equal(cat.get('sha:' + 'f'.repeat(64)), undefined);
    const unknown = world().defineDef(input('core-not-in-history'), 'core', 0);
    f.registry.putDef1(unknown.hash, input('core-not-in-history'));
    assert.equal(cat.get('sha:' + unknown.hash), undefined, 'raw blob alone grants no permission');
    assert.equal(cat.canExport(f.base.hash), true);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('restricted dependency chains are held from public use, including historical raw hashes; Gene use never grants export', async () => {
  const f = await fixture(true);
  try {
    const frozen = pinReleaseSeed(f.registry, 'pin'), child = frozen.entries.find((e) => e.id === 'eden/seed-child')!;
    const publicCat = new RegistryCatalog(f.registry, { hot: 0 }), gene = new RegistryCatalog(f.registry, { ownerIsGene: true, hot: 0 });
    assert.equal(publicCat.list().length, 0);
    for (const hash of [f.base.hash, f.child.hash, child.def1Hash!]) {
      assert.equal(publicCat.get('sha:' + hash), undefined);
      assert.equal(gene.get('sha:' + hash)!.hash, hash);
      assert.equal(gene.canExport(hash), false);
      assert.equal(new RegistryCatalog(f.registry, { ownerIsGene: true, export: true }).get('sha:' + hash), undefined);
    }
    assert.equal(f.registry.snapshot('stable', 1).find((e) => e.id === child.id)!.redistribute, true, 'historical metadata remains immutable');
    assert.equal(child.redistribute, false);
    assert.notEqual(child.itemHash, hashOf(f.registry.item(child.id, 1, f.registry.snapshot('stable', 1).find((e) => e.id === child.id)!.rev)));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
