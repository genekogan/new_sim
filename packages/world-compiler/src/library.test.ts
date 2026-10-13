// CATRUN: the shared core library (engine fix i). A world stores only what it uses; its own hashes win; eden/* aliases core/*.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, buildLibrary, coreLibrary, type Accepted, type DefInput } from './index.ts';

const lib = coreLibrary();
const bare = (seed = 'lib') => { const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed }); w.library = lib; return w; };
const legacy = (seed = 'lib') => { const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; };
const own = (w: WorldModel) => new Set(w.defs.values()).size;

test('library: built once, every core def under name@v, core/<x>@v and sha:<hash>; version is stable', () => {
  assert.equal(lib, coreLibrary());
  assert.ok(lib.all().length > 700, `${lib.all().length} defs`);
  const chair = lib.get('core-chair@1')!;
  assert.equal(lib.get('core/chair@1'), chair); assert.equal(lib.get('sha:' + chair.hash), chair);
  assert.equal(buildLibrary('core', CORE_KIT).version, lib.version);
  assert.match(lib.version, /^[0-9a-f]{16}$/);
});

test('library: a fresh world stores 0 defs, resolves every core ref, and adopts (pins) a def the first time it is placed', () => {
  const w = bare();
  assert.equal(own(w), 0);
  assert.equal(w.def('core/bench@1')?.ref, 'core-bench@1');
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'core/bench@1', name: 'b', p: [0, 0, 0] }] }, 'god', 1);
  assert.ok(r.result.accepted, JSON.stringify(r.result));
  assert.deepEqual(r.diff!.defs.map((d) => d.ref), ['core-bench@1']);
  assert.ok(w.owns('core-bench@1')); assert.equal(own(w), 1);
  // a second bench adopts nothing new
  const r2 = applyBatch(w, { ops: [{ op: 'place', def: 'core/bench@1', name: 'b2', p: [5, 0, 0] }] }, 'god', 2);
  assert.deepEqual(r2.diff!.defs, []);
  // a dry run adopts nothing into the live model
  const before = own(w);
  applyBatch(w, { ops: [{ op: 'place', def: 'core/table@1', name: 't', p: [0, 0, 9] }, { op: 'remove', id: 'nope' }] }, 'god', 3);
  assert.equal(own(w), before);
});

test('library: a preset adopts its extends chain; the stored world reloads to the same resolution without the library', () => {
  const preset = lib.all().find((d) => d.extends && d.form === 'point' && lib.get(d.extends) && !lib.get(d.extends)!.contents?.length && d.size.box[0] < 6)!;
  assert.ok(preset, 'a preset def exists in the core kit');
  const w = bare();
  const r = applyBatch(w, { ops: [{ op: 'place', def: preset.ref.replace(/^core-/, 'core/'), name: 'p', p: [0, 0, 0] }] }, 'god', 1);
  assert.ok(r.result.accepted, JSON.stringify(r.result));
  const refs = r.diff!.defs.map((d) => d.ref);
  assert.ok(refs.includes(preset.ref) && refs.includes(lib.get(preset.extends!)!.ref), refs.join(','));
  const re = WorldModel.fromSnapshot(w.snapshot());   // no library: only what it stored
  assert.deepEqual(re.resolvedDef(preset.ref), w.resolvedDef(preset.ref));
});

test('library: same batch on a legacy (full-copy) world and a library world gives the same entities and def hashes', () => {
  const ops = [
    { op: 'place', def: 'core/cottage@1', name: 'home', p: [0, 0, 0] },
    { op: 'place', def: 'core/bench@1', name: 'bench', p: [8, 0, 6] },
    { op: 'place', def: 'core/lamp-post@1', name: 'lamp', p: [-8, 0, 6] },
    { op: 'place', def: 'core/knoll@1', name: 'k', p: [60, 0, 60] },
  ];
  const a = legacy('same'), b = bare('same');
  const ra = applyBatch(a, { ops }, 'god', 5) as unknown as { result: Accepted }, rb = applyBatch(b, { ops }, 'god', 5) as unknown as { result: Accepted };
  assert.ok(ra.result.accepted && rb.result.accepted);
  const ents = (w: WorldModel) => JSON.stringify(w.snapshot().entities);
  assert.equal(ents(a), ents(b));
  for (const e of b.entities.values()) assert.equal(b.def(e.def)!.hash, a.def(e.def)!.hash, e.def);
  assert.equal(JSON.stringify(a.ground()), JSON.stringify(b.ground()));
});

test('library: an old world keeps its own (older) hash for a ref; the library never overrides it', () => {
  const fountain = CORE_KIT.find((d) => d.name === 'core-fountain')!;
  const older: DefInput = { ...fountain, description: 'An older fountain text (a previous release).' };
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'old' });
  const pinned = w.defineDef(older, 'core', 0);
  const re = WorldModel.fromSnapshot(w.snapshot(), undefined, lib);
  assert.notEqual(pinned.hash, lib.get('core-fountain@1')!.hash);
  assert.equal(re.def('core/fountain@1')!.hash, pinned.hash);
  const r = applyBatch(re, { ops: [{ op: 'place', def: 'core/fountain@1', name: 'f', p: [0, 0, 0] }] }, 'god', 1);
  assert.ok(r.result.accepted); assert.deepEqual(r.diff!.defs, []);
  assert.equal(re.def(re.get('f')!.def)!.hash, pinned.hash);
  // and the world's own copy is what allDefs lists for that ref (once)
  assert.equal(re.allDefs().filter((d) => d.ref === 'core-fountain@1').length, 1);
  assert.equal(re.allDefs().find((d) => d.ref === 'core-fountain@1')!.hash, pinned.hash);
});

test('library: eden/<x>@v is an alias of core/<x>@v (CATALOG-PROGRAM P0); entities still record core-<x>@v', () => {
  const w = bare();
  assert.equal(w.def('eden/bench@1'), w.def('core/bench@1'));
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'eden/bench@1', name: 'b', p: [0, 0, 0] }] }, 'god', 1);
  assert.ok(r.result.accepted, JSON.stringify(r.result));
  assert.equal(w.get('b')!.def, 'core-bench@1');
});

test('library: defining a def identical to a library one pins the library record (same hash, no fork)', () => {
  const w = bare();
  const input = CORE_KIT.find((d) => d.name === 'core-table')!;
  const r = applyBatch(w, { ops: [{ op: 'define', def: input }] }, 'god', 1);
  assert.ok(r.result.accepted, JSON.stringify(r.result));
  assert.equal(r.diff!.defs[0].hash, lib.get('core-table@1')!.hash);
  assert.equal(r.diff!.defs[0].by, 'core');
});

test('library: pack namespaces alias too: lm/<x>@v → core/lm-<x>@v, mars/<x>@v → core/mars-<x>@v', () => {
  const w = bare();
  const lm = lib.all().find((d) => d.name.startsWith('core-lm-'))!, mars = lib.all().find((d) => d.name.startsWith('core-mars-'))!;
  assert.equal(w.def(`lm/${lm.name.slice(8)}@${lm.version}`), lm);
  assert.equal(w.def(`mars/${mars.name.slice(10)}@${mars.version}`), mars);
  assert.equal(w.def('eden/no-such-thing@1'), undefined);
});
