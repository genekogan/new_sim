// Focused prototype proof for the requested compiler SHA-pinning patch. Use only an isolated compiler COPY.
// node tools/catalog/sha-pin-rehearsal.mjs .lane/pin-probe/src/compile.ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorldModel, hashOf } from '../../packages/world-compiler/src/index.ts';
import { Registry, RegistryCatalog, makeItem, loadContract, def1to2 } from '../../packages/catalog/src/index.ts';

const compiler = resolve(process.argv[2] ?? '');
if (!compiler.includes('/.lane/')) throw new Error('use an isolated compiler copy under .lane; never patch the authoritative compiler');
const { applyBatch } = await import(pathToFileURL(compiler).href);
const dir = mkdtempSync(join(tmpdir(), 'catalog-pin-probe-'));
try {
  const registry = new Registry(dir);
  const input = (color) => ({ schema: 'def/1', name: 'core-pin-proof-box', version: 1, form: 'point', description: '',
    make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color, round: 0 }], round: 0 } },
    anchor: 'base', layer: 'solid', size: { box: [1, 1, 1] }, tags: ['fixture'] });
  const publish = async (color) => {
    const scratch = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'source' });
    const stored = scratch.defineDef(input(color), 'core', 0), up = def1to2(stored);
    const { item } = await makeItem(stored, { at: '2026-10-12T12:00:00.000Z', run: 'proof', author: 'test', contract: loadContract() });
    registry.putDef(up.def2); registry.putDef1(stored.hash, input(color)); registry.putItem(item);
    const entry = { id: item.id, major: item.major, rev: item.rev, itemHash: hashOf(item), status: 'stable', tier: 'cold', aliases: item.aliases, def1Hash: stored.hash, line: 'fixture', redistribute: true };
    registry.publish('stable', [entry], 'proof'); return stored;
  };
  const old = await publish('#336699'), catalog = new RegistryCatalog(registry, { hot: 0 });
  const model = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'world' }); model.library = catalog;
  assert.ok(applyBatch(model, { ops: [{ op: 'place', def: 'sha:' + old.hash, name: 'old', p: [0, 0, 0] }] }, 'god', 1).result.accepted);
  assert.equal(model.get('old').def, 'sha:' + old.hash);
  const next = await publish('#885533');
  assert.ok(applyBatch(model, { ops: [{ op: 'place', def: 'sha:' + next.hash, name: 'new', p: [3, 0, 0] }] }, 'god', 2).result.accepted);
  assert.equal(model.def(model.get('old').def).hash, old.hash);
  assert.equal(model.def(model.get('new').def).hash, next.hash);
  const snapshot = model.snapshot(), reloaded = WorldModel.fromSnapshot(snapshot, undefined, catalog);
  assert.equal(reloaded.def(reloaded.get('old').def).hash, old.hash);
  assert.equal(reloaded.def(reloaded.get('new').def).hash, next.hash);
  registry.yank('eden/pin-proof-box', 1, 'yank', 'probe');
  assert.equal(catalog.get('eden/pin-proof-box@1'), undefined);
  assert.equal(reloaded.def(reloaded.get('new').def).hash, next.hash);
  registry.rollback('stable', 'rollback', 1);
  assert.equal(catalog.get('eden/pin-proof-box@1').hash, old.hash);
  assert.equal(reloaded.def(reloaded.get('new').def).hash, next.hash);
  const legacy = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'legacy' });
  const stored = legacy.defineDef(input('#336699'), 'core', 0);
  assert.ok(applyBatch(legacy, { ops: [{ op: 'place', def: stored.ref, name: 'legacy', p: [0, 0, 0] }] }, 'god', 1).result.accepted);
  assert.equal(legacy.get('legacy').def, stored.ref, 'non-registry paths keep their existing refs');
  console.log(JSON.stringify({ ok: true, coexist: 2, reload: true, yank: true, rollback: true, legacyUnchanged: true }));
} finally { rmSync(dir, { recursive: true, force: true }); }
