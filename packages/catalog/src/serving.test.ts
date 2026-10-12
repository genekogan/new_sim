import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldModel, coreLibrary, applyBatch, hashOf } from '@sim/world-compiler';
import { Registry, RegistryError } from './registry.ts';
import { RegistryCatalog } from './serving.ts';
import { makeItem, writeCore, lineOf } from './import-core.ts';
import { loadContract } from './contract.ts';
import { buildIndex, buildLexicalIndex, lexical } from './embed.ts';

const dir = mkdtempSync(join(tmpdir(), 'catalog-serving-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const reg = new Registry(dir), lib = coreLibrary(), at = '2026-10-12T12:00:00.000Z';
const picks = ['core-bench@1', 'core-chair@1', 'core-stool@1', 'core-sofa@1', lib.all().find((d) => d.name.startsWith('core-lm-'))!.ref];
const imports = await Promise.all(picks.map(async (ref) => {
  const def = lib.get(ref)!, { item, up } = await makeItem(def, { at, run: 'serve', author: 'test', contract: loadContract() });
  return { def, item, up };
}));
writeCore(reg, imports, 'serve');

test('cold search and pages do not load engine defs; use pins one exact engine hash', () => {
  const cat = new RegistryCatalog(reg, { hot: 0 });
  assert.equal(cat.list().length, 4, 'restricted art is not offered to another owner');
  const before = cat.stats();
  const cold = cat.list().find((h) => !cat.all().some((d) => d.hash === h.entry.def1Hash));
  // Category exemplars may be hot even with a zero extra-use cap. Search itself never promotes.
  cat.find('chair'); cat.list({ category: 'furniture' }); cat.taxonomy(); cat.t0();
  assert.deepEqual(cat.stats(), before);
  assert.ok(cold, 'the fourth seat must remain cold');
  const hit = cold;
  const w = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'serve' }); w.library = cat;
  assert.equal(w.defs.size, 0);
  const r = applyBatch(w, { ops: [{ op: 'place', def: hit.row.ref, name: 'used', p: [0, 0, 0] }] }, 'god', 1);
  assert.ok(r.result.accepted, JSON.stringify(r.result));
  assert.equal(w.def(w.get('used')!.def)!.hash, hit.entry.def1Hash);
  assert.equal(new Set(w.defs.values()).size, 1);
});

test('licence context allows Gene to use restricted art, and still refuses its export', () => {
  assert.equal(new RegistryCatalog(reg, { ownerIsGene: true }).list().length, 5);
  assert.equal(new RegistryCatalog(reg, { ownerIsGene: true, export: true }).list().length, 4);
  const catalog = new RegistryCatalog(reg, {ownerIsGene: true});
  const restricted = catalog.list().find((h) => !h.entry.redistribute)!;
  assert.equal(catalog.canExport(restricted.entry.def1Hash!), false);
  assert.equal(catalog.canExport(imports[0].def.hash), true);
});

test('text update publishes with identical def hashes; rollback and yank affect live resolution, stored worlds stay pinned', () => {
  const cat = new RegistryCatalog(reg), entry = reg.resolve('eden/bench@1')!;
  const before = reg.pointers().stable!;
  const original = reg.item(entry.id, entry.major, entry.rev, entry.itemHash)!;
  const next = { ...original, text: { ...original.text, synonyms: [...original.text.synonyms, 'sundial seating'] } };
  reg.putItem(next);
  const legacy = readFileSync(join(dir, `items/${entry.id}/${entry.major}/${entry.rev}.json`), 'utf8');
  reg.publish('stable', [{ ...entry, itemHash: hashOf(next), line: lineOf(next) }], 'words');
  assert.equal(cat.find('sundial')[0].row.ref, 'eden/bench@1');
  assert.equal(cat.get('eden/bench@1')!.hash, entry.def1Hash);
  assert.deepEqual(reg.item(entry.id, entry.major, entry.rev, entry.itemHash), original);
  assert.equal(readFileSync(join(dir, `items/${entry.id}/${entry.major}/${entry.rev}.json`), 'utf8'), legacy);
  const w = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'pinned' }); w.library = cat;
  assert.ok(applyBatch(w, { ops: [{ op: 'place', def: 'eden/bench@1', name: 'b', p: [0, 0, 0] }] }, 'god', 1).result.accepted);
  const pinned = JSON.stringify(w.snapshot());
  reg.yank('eden/bench', 1, 'yank', 'rehearsal');
  assert.equal(cat.get('eden/bench@1'), undefined);
  assert.equal(cat.find('sundial').length, 0);
  assert.equal(w.def('eden/bench@1')!.hash, entry.def1Hash);
  assert.equal(JSON.stringify(w.snapshot()), pinned);
  reg.rollback('stable', 'restore', before);
  assert.equal(cat.find('sundial').length, 0);
  assert.equal(cat.get('eden/bench@1')!.hash, entry.def1Hash);
});

test('publisher contention fails cleanly without losing another worker snapshot', () => {
  const before = reg.pointers();
  mkdirSync(join(dir, '.publish-lock'));
  try {
    assert.throws(() => reg.yank('eden/chair', 1, 'blocked', 'test'), (e: unknown) => e instanceof RegistryError && e.code === 'registry.busy');
    assert.deepEqual(reg.pointers(), before);
  } finally { rmSync(join(dir, '.publish-lock'), { recursive: true }); }
  const seq = reg.publish('candidate', [], 'later');
  assert.ok(seq > before.candidate!);
});

test('lexical-only index matches the lexical half of the SVD index and accepts an empty catalogue', () => {
  const docs = imports.map(({ item }) => ({ id: item.id, title: item.text.title, synonyms: item.text.synonyms,
    category: item.text.category, affords: item.affords, first: item.text.first, description: item.text.description }));
  const fast = buildLexicalIndex(docs), full = buildIndex(docs);
  assert.equal(fast.V.length, 0);
  for (const q of ['bench', 'chair', 'sit down']) assert.deepEqual(lexical(fast, q), lexical(full, q));
  assert.deepEqual(lexical(buildLexicalIndex([]), 'anything'), []);
});
