// CATRUN P0: hot/cold tiers (TieredLibrary promotes cold defs on demand) and retrieval (BM25 + embedding, fused).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldModel, applyBatch, coreLibrary } from '@sim/world-compiler';
import { Registry } from './registry.ts';
import { buildCoreItems, writeCore } from './import-core.ts';
import { TieredLibrary, hotSet, renderT0, templateUse } from './tiers.ts';
import { buildIndex, docsOf, search, rrf } from './embed.ts';

const at = '2026-10-12T05:00:00.000Z';
const dir = mkdtempSync(join(tmpdir(), 'catalog-tiers-'));
const reg = new Registry(dir);
const built = await buildCoreItems({ at, run: 't', gates: false });
writeCore(reg, built.items, 't');
const items = built.items.map((x) => x.item);
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('hot set: every category has exemplars, template-used items are hot, the cap holds', () => {
  const hot = hotSet(items, 300);
  assert.equal(hot.size, 300);
  const cats = new Set(items.map((i) => i.text.category));
  for (const c of cats) assert.ok(items.some((i) => i.text.category === c && hot.has(i.id)), c);
  const use = templateUse();
  assert.ok(use.size > 100, `${use.size} defs placed by templates`);
  assert.ok(hot.has('eden/chair') && hot.has('eden/humanoid'));
});

test('T0: the whole catalogue in ≤ 6k tokens (taxonomy + counts + 3 exemplars per category); exemplars redistributable first', () => {
  const t0 = renderT0(items, hotSet(items, 300));
  assert.ok(t0.tokens < 6000, `${t0.tokens} tokens`);
  assert.equal(t0.categories, new Set(items.map((i) => i.text.category)).size);
  assert.match(t0.text, /^building\.commercial \(Commercial, \d+\): bakery/m);
});

test('TieredLibrary: hot in memory, a cold def loads from the registry on first use and stays (promoted); same hash as the core kit', () => {
  const hot = hotSet(items, 300);
  const lib = new TieredLibrary(reg, hot);
  const hotEntries = reg.current('stable').filter((e) => hot.has(e.id)).length;   // an id can have two majors (humanoid@1, @2)
  assert.equal(lib.inMemory().defs, hotEntries);
  const cold = items.find((i) => !hot.has(i.id) && i.id.startsWith('eden/') && i.provenance.route === 'kit')!;
  const w = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'tier' }); w.library = lib;
  const r = applyBatch(w, { ops: [{ op: 'place', def: `${cold.id}@1`, name: 'c', p: [0, 0, 0] }] }, 'god', 1);
  assert.ok(r.result.accepted, JSON.stringify(r.result));
  assert.equal(lib.stats.promoted, 1); assert.equal(lib.inMemory().defs, hotEntries + 1);
  assert.equal(w.def(w.get('c')!.def)!.hash, coreLibrary().get(cold.aliases[1])!.hash);
  lib.get(cold.aliases[0]); assert.equal(lib.stats.loads, 1, 'a promoted def is not reloaded');
  assert.ok(lib.inMemory().bytes < 0.6 * coreLibrary().all().reduce((a, d) => a + JSON.stringify(d).length, 0));
});

test('retrieval: find returns the right thing for names and paraphrases; fused never needs the manifest', () => {
  const idx = buildIndex(docsOf(reg));
  assert.equal(idx.ids.length, items.length);
  const top = (q: string, mode = 'fused') => search(idx, q, { k: 3, mode }).map((h) => h.id);
  assert.equal(top('bodega', 'lexical')[0], 'eden/corner-shop@1');
  assert.ok(top('kids playground').includes('eden/playground@1'));
  assert.ok(top('light the street at night').some((id) => /streetlight|lamp-post|lantern-post/.test(id)));
  assert.deepEqual(rrf([{ ids: ['a', 'b'] }, { ids: ['b', 'c'] }], 2), ['b', 'a']);
  // the paraphrase eval set names real items
  const evalSet = JSON.parse(readFileSync(new URL('../eval/intents.json', import.meta.url), 'utf8')).intents as { any: string[] }[];
  const have = new Set(items.map((i) => i.id));
  assert.ok(evalSet.filter((e) => e.any.some((id) => have.has(id))).length >= 90);
});
