// CATRUN P0: item/1 + def/2, def1to2, aliases, the registry, gates G1–G3, the pinned contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldModel, coreLibrary, hashOf, type DefInput, type StoredDef } from '@sim/world-compiler';
import { def2Schema, item1Schema, param2Schema } from './schema.ts';
import { def1to2, def2to1, def1Hash, def2Hash } from './def1to2.ts';
import { idOf, aliasesOf, engineRefOf } from './ids.ts';
import { Registry, RegistryError } from './registry.ts';
import { engineContract, loadContract } from './contract.ts';
import { g1, runGates } from './gates.ts';
import { makeItem, writeCore, buildCoreItems, licenceOf } from './import-core.ts';

const lib = coreLibrary();
const contract = loadContract();
const at = '2026-10-12T05:00:00.000Z';
const stored = (input: DefInput): StoredDef => { const w = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 't' }); w.library = lib; return w.defineDef(input, 'test', 0); };
const subject = async (d: StoredDef, o: { synonyms?: string[] } = {}) => { const { item, up } = await makeItem(d, { at, run: 'test', contract, author: 'test', status: 'draft', ...o }); return { item, def2: up.def2 }; };

test('contract: contract.json matches the engine (regenerate with `catalog contract --write` and review the diff)', () => {
  assert.deepEqual(loadContract(), engineContract());
});

test('def/2 + item/1 schemas: strict; ranged params; LAYERS inert marked; ids namespaced', () => {
  assert.throws(() => param2Schema.parse({ type: 'number', default: 1, doc: 'x', group: 'own' }));               // no range
  assert.throws(() => param2Schema.parse({ type: 'number', min: 0, max: 1, default: 2, doc: 'x', group: 'own' })); // default outside
  assert.ok(param2Schema.parse({ type: 'enum', values: ['a', 'b'], default: 'b', doc: 'x', group: 'variant' }));
  const up = def1to2(lib.get('core-bench@1')!);
  assert.throws(() => def2Schema.parse({ ...up.def2, description: 'words do not belong in the hash' }));          // strict
  assert.throws(() => def2Schema.parse({ ...up.def2, layersInert: { owner: 'x' } }));                              // INERT: true required
  assert.throws(() => item1Schema.parse({ schema: 'item/1', id: 'no-namespace' }));
});

test('def1to2: every core def upgrades; def2to1 gives back the exact def/1 (same hash) for all of them', () => {
  let n = 0, act = 0, filled = 0;
  for (const d of lib.all()) {
    const up = def1to2(d); n++;
    if (up.actuators.length) act++; if (up.filled.length) filled++;
    assert.equal(def1Hash(def2to1(up.def2, up.def1Text, { omit: up.filled })), d.hash, d.ref);
  }
  assert.equal(n, lib.all().length);
  assert.ok(act >= 60, `${act} defs recovered actuators`);
  assert.ok(filled < n / 4, `${filled} defs needed filling`);
});

test('text outside the hash: a new synonym or description never changes the def/2 rev', () => {
  const d = lib.get('core-corner-shop@1')!;
  const a = def1to2(d), b = def1to2({ ...d, synonyms: [...(d.synonyms ?? []), 'bodega deluxe'], description: d.description + ' Now with a cat.' });
  assert.equal(def2Hash(a.def2), def2Hash(b.def2));
  assert.notEqual(def1Hash({ ...d, synonyms: ['xx', 'yy', 'zz'] }), d.hash);   // (def/1 forks on words: why def/2 moves them out)
});

test('ids and aliases: core-<x>@v → eden/<x> (lm/, mars/ for the packs); the engine ref round-trips', () => {
  for (const d of lib.all()) {
    const id = idOf(d.name);
    assert.deepEqual(aliasesOf(d.name, d.version), [`core/${d.name.slice(5)}@${d.version}`, `core-${d.name.slice(5)}@${d.version}`]);
    assert.equal(engineRefOf(id, d.version), d.ref, id);
  }
  assert.equal(idOf('core-lm-ada'), 'lm/ada'); assert.equal(idOf('core-mars-mimos'), 'mars/mimos'); assert.equal(idOf('core-cafe'), 'eden/cafe');
});

test('licences: own kit CC0; Quaternius packs CC0 with source; Mars Eden-internal; LM art restricted (never redistributed)', () => {
  assert.equal(licenceOf(lib.get('core-bench@1')!, 'eden/bench').spdx, 'CC0-1.0');
  const cow = licenceOf(lib.get('core-cow-pack@1')!, 'eden/cow-pack'); assert.equal(cow.spdx, 'CC0-1.0'); assert.match(cow.source ?? '', /Quaternius/);
  const mars = lib.all().find((d) => d.name.startsWith('core-mars-') && d.make.kind === 'mesh')!;
  assert.deepEqual([licenceOf(mars, idOf(mars.name)).spdx, licenceOf(mars, idOf(mars.name)).redistribute], ['Eden-internal', false]);
  const lm = lib.all().find((d) => d.name.startsWith('core-lm-') && /Vanessa Rosa/.test(d.description))!;
  assert.deepEqual([licenceOf(lm, idOf(lm.name)).spdx, licenceOf(lm, idOf(lm.name)).redistribute], ['third-party-restricted', false]);
});

test('registry: content-addressed, write-once, channels; publish, promote, rollback, yank; restricted never offered out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-reg-'));
  try {
    const reg = new Registry(dir);
    const picks = ['core-bench@1', 'core-chair@1', 'core-corner-shop@1', lib.all().find((d) => d.name.startsWith('core-lm-'))!.ref].map((r) => lib.get(r)!);
    const items = await Promise.all(picks.map(async (d) => { const { item, up } = await makeItem(d, { at, run: 'r1', contract, author: 'test' }); return { item, up, def: d }; }));
    const { stable, candidate } = writeCore(reg, items, 'r1');
    assert.deepEqual([stable, candidate], [1, 1]);
    assert.equal(reg.current('stable').length, 4);
    // resolve by id@major, by either alias, by the hash worlds pinned
    const bench = reg.resolve('eden/bench@1')!;
    assert.deepEqual(reg.resolve('core/bench@1'), bench);
    assert.equal(reg.resolve('core-bench@1')!.rev, bench.rev);
    assert.equal(reg.resolve(lib.get('core-bench@1')!.hash)!.id, 'eden/bench');
    assert.equal(hashOf(reg.def(bench.rev)), bench.rev);
    // write-once
    assert.throws(() => (reg as unknown as { writeOnce(a: string, b: string): void }).writeOnce(`defs/${bench.rev}.json`, 'tampered\n'), (e: unknown) => e instanceof RegistryError && e.code === 'registry.immutable');
    writeCore(reg, items, 'r1-again');   // idempotent content; new snapshots
    // a candidate-only change, promoted
    const d2 = { ...items[0].up.def2, size: { ...items[0].up.def2.size, scale: [0.5, 3] as [number, number] } };
    const rev2 = reg.putDef(d2);
    const nextItem = { ...items[0].item, rev: rev2, status: 'candidate' as const, supersedes: [bench.rev] };
    reg.putItem(nextItem);
    reg.publish('candidate', [{ ...bench, rev: rev2, itemHash: hashOf(nextItem), status: 'candidate' }], 'r2');
    assert.equal(reg.resolve('eden/bench@1', 'stable')!.rev, bench.rev);
    assert.equal(reg.resolve('eden/bench@1', 'candidate')!.rev, rev2);
    const s3 = reg.promote(['eden/bench'], 'r3');
    assert.equal(reg.resolve('eden/bench@1')!.rev, rev2);
    // rollback: one pointer write back to the previous snapshot
    const back = reg.rollback('stable', 'r4');
    assert.ok(back < s3); assert.equal(reg.resolve('eden/bench@1')!.rev, bench.rev);
    // yank: gone from search and new placement; a pinned hash still resolves (worlds keep it)
    reg.yank('eden/chair', 1, 'r5', 'test');
    assert.equal(reg.resolve('eden/chair@1'), null); assert.equal(reg.resolve('core/chair@1'), null);
    assert.equal(reg.resolve(lib.get('core-chair@1')!.hash)!.status, 'yanked');
    // redistribution limit
    const lm = reg.current('stable').find((e) => e.id.startsWith('lm/'))!;
    assert.equal(reg.offerable(lm, { ownerIsGene: false }), false);
    assert.equal(reg.offerable(lm, { ownerIsGene: true }), true);
    assert.equal(reg.offerable(lm, { ownerIsGene: true, export: true }), false);
    // the ledger saw every move
    assert.deepEqual([...new Set(reg.ledger().map((r) => r.op))].sort(), ['import-core', 'publish', 'rollback', 'yank']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gates: a good kit item passes G1–G3', async () => {
  const o = await runGates({ ...(await subject(lib.get('core-chair@1')!, { synonyms: ['seat', 'dining chair', 'stool'] })) }, contract, { all: true });
  assert.ok(o.ok, JSON.stringify(o.outcomes.map((g) => [g.gate, g.errors])));
  assert.equal(o.measured.how, 'kit'); assert.ok(o.measured.tris > 0 && o.measured.draws >= 1);
});

test('gates catch seeded defects: unknown capability, too few words, floating, buried, solid block where it is entered', async () => {
  const chair = lib.get('core-chair@1')!;
  // G1: an unknown generator and too few synonyms on a new item
  const s1 = await subject(chair, { synonyms: ['seat'] });
  const bad = { ...s1, def2: { ...s1.def2, make: { kind: 'gen' as const, gen: 'excavator-arm/1' } } };
  const o1 = g1({ ...bad, item: { ...bad.item, rev: def2Hash(bad.def2) } }, contract);
  assert.ok(o1.errors.some((e) => e.startsWith('capability.unknown: generator excavator-arm/1')), o1.errors.join('; '));
  assert.ok(o1.errors.some((e) => /1 synonyms \(need ≥ 3\)/.test(e)));
  // G3: a kit thing whose shapes float 1.2 m above its base (tonight's dartboard/awning class)
  const args = chair.make.kind === 'gen' ? (chair.make.args as { shapes: { at: number[] }[] }) : null;
  const floating = stored({ ...(chair as DefInput), name: 'test-floating-chair', make: { kind: 'gen', gen: 'kit/2', args: { ...args, shapes: args!.shapes.map((s) => ({ ...s, at: [s.at[0], s.at[1] + 1.2, s.at[2]] })) } } } as DefInput);
  const o3 = await runGates(await subject(floating, { synonyms: ['aa', 'bb', 'cc'] }), contract, { all: true });
  assert.ok(o3.outcomes.find((g) => g.gate === 'G3')!.errors.some((e) => /floating 1\.\d+ m above the floor/.test(e)), JSON.stringify(o3.outcomes));
  // G3: buried 0.3 m
  const buried = stored({ ...(chair as DefInput), name: 'test-buried-chair', make: { kind: 'gen', gen: 'kit/2', args: { ...args, shapes: args!.shapes.map((s) => ({ ...s, at: [s.at[0], s.at[1] - 0.3, s.at[2]] })) } } } as DefInput);
  const ob = await runGates(await subject(buried, { synonyms: ['aa', 'bb', 'cc'] }), contract, { all: true });
  assert.ok(ob.outcomes.find((g) => g.gate === 'G3')!.errors.some((e) => /below the floor/.test(e)));
  // G3: something you enter (a room slot) that collides as one solid block
  const block = stored({ schema: 'def/1', name: 'test-solid-shed', description: 'A shed you can walk into (seeded defect).', form: 'point', make: { kind: 'gen', gen: 'box/1' }, size: { box: [4, 3, 4] }, params: { w: { type: 'number', min: 1, max: 8, default: 4 }, h: { type: 'number', min: 1, max: 6, default: 3 }, d: { type: 'number', min: 1, max: 8, default: 4 } }, slots: [{ id: 'inside', kind: 'room', p: [0, 0, 0], yaw: 0, accepts: {}, capacity: 4 }] } as DefInput);
  const os = await runGates(await subject(block, { synonyms: ['shed', 'hut', 'cabin'] }), contract, { all: true });
  assert.ok(os.outcomes.find((g) => g.gate === 'G3')!.errors.includes('enterable but one solid block (walls expected)'), JSON.stringify(os.outcomes.map((g) => g.errors)));
});

test('import-core: 768 items, all G1-valid, published to stable + candidate; every def/1 round-trips', async () => {
  const { items, rows } = await buildCoreItems({ at, run: 'test-import', gates: false });
  assert.equal(items.length, lib.all().length);
  for (const { item } of items) item1Schema.parse(item);
  for (const { item, up } of items) assert.equal(g1({ item, def2: up.def2, grandfathered: true }, contract).ok, true, item.id);
  const dir = mkdtempSync(join(tmpdir(), 'catalog-imp-'));
  try { const reg = new Registry(dir); writeCore(reg, items, 'test-import'); assert.equal(reg.current('stable').length, rows.length); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// keep fs imports used when tests are filtered
void writeFileSync; void readFileSync;
