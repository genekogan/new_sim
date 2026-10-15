import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch, buildLibrary, coreLibrary, type DefInput } from './index.ts';

const fresh = () => { const w = new WorldModel({ constants: { ground: 'land', extent: 128 }, seed: 'define-undo' }); w.library = coreLibrary(); return w; };
const post = (size: [number, number, number]): DefInput => ({ schema: 'def/1', name: 'probe-post', version: 1, size: { box: size }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, size[1] / 2, 0], size }] } } });
const act = (w: WorldModel, ops: unknown[], trusted = false) => applyBatch(w, { ops }, 'god', 100, { trusted });
const ok = (r: ReturnType<typeof act>) => { assert.equal(r.result.accepted, true, JSON.stringify(r.result)); return r; };

test('redefining a small post beside a bench refuses the whole batch naming the instance', () => {
  const w = fresh();
  ok(act(w, [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }, { op: 'place', def: 'core/bench@1', name: 'bench', p: [2, 0] }]));
  const before = structuredClone(w.snapshot());
  const r = act(w, [{ op: 'world', state: { constitution: 'must roll back' } }, { op: 'define', def: post([6, 6, 6]) }]);
  assert.equal(r.result.accepted, false);
  if (r.result.accepted) return;
  const f = r.result.failures[0];
  assert.equal(f.code, 'overlap.solid'); assert.equal(f.op, 1); assert.equal(f.entity, w.get('post')!.id);
  assert.match(f.detail, /bench/); assert.ok(f.field && f.fix);
  assert.deepEqual(w.snapshot(), before);
});

test('a fitting redefinition updates the diff, index and versions; inverse and redo restore stored content', () => {
  const w = fresh();
  ok(act(w, [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }]));
  const id = w.get('post')!.id, old = w.def('probe-post@1')!, before = w.footprintsOf(id);
  const changed = ok(act(w, [{ op: 'define', def: post([2, 3, 2]) }]));
  assert.deepEqual(changed.diff!.upserts.map(e => e.id), [id]);
  assert.equal(w.get(id)!.v, 2); assert.equal(w.footprintsOf(id)[0].half[0], 1);
  assert.ok(changed.inverse!.length);
  const back = ok(act(w, changed.inverse!, true));
  assert.equal(w.def('probe-post@1')!.hash, old.hash); assert.deepEqual(w.footprintsOf(id), before);
  const loaded = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
  assert.equal(loaded.def('probe-post@1')!.hash, old.hash);
  ok(act(loaded, back.inverse!, true));
  assert.equal(loaded.footprintsOf(id)[0].half[0], 1);
  const identical = ok(act(loaded, [{ op: 'define', def: post([2, 3, 2]) }]));
  assert.deepEqual(identical.diff!.upserts, []); assert.deepEqual(identical.diff!.defs, []); assert.deepEqual(identical.inverse, []);
  assert.equal(loaded.get(id)!.v, 4);
});

test('expanded prefab and contents parts are admitted, updated and reverted through their shared ref', () => {
  for (const contents of [false, true]) {
    const w = fresh(), part = { id: 'post', def: 'probe-post@1', p: [0, 0] as [number, number] };
    const root: DefInput = { schema: 'def/1', name: 'assembly', size: { box: [1, 1, 1] }, ...(contents ? { make: { kind: 'none' }, contents: [part] } : { make: { kind: 'parts', parts: [part] } }) };
    ok(act(w, [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'define', def: root }, { op: 'place', def: 'assembly@1', name: 'assembly', p: [0, 0] }, { op: 'place', def: 'core/bench@1', name: 'bench', p: [2, 0] }]));
    const before = structuredClone(w.snapshot()), child = w.get('assembly/post')!;
    const refused = act(w, [{ op: 'define', def: post([6, 6, 6]) }]);
    assert.equal(refused.result.accepted, false);
    if (!refused.result.accepted) { assert.equal(refused.result.failures[0].entity, child.id); assert.match(refused.result.failures[0].detail, /assembly\/post.*bench/); }
    assert.deepEqual(w.snapshot(), before);
    const changed = ok(act(w, [{ op: 'define', def: post([1, 2, 1]) }]));
    assert.ok(changed.diff!.upserts.some(e => e.id === child.id)); assert.equal(w.footprintsOf(child.id)[0].half[0], 0.5);
    ok(act(w, changed.inverse!, true)); assert.equal(w.footprintsOf(child.id)[0].half[0], 0.25);
  }
});

test('inherited definitions rebake while direct hash-pinned instances retain their content', () => {
  const w = fresh();
  ok(act(w, [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'define', def: { schema: 'def/1', name: 'derived', extends: 'probe-post@1', make: { kind: 'none' }, size: { box: [1, 1, 1] } } }]));
  const hash = w.def('probe-post@1')!.hash;
  ok(act(w, [{ op: 'place', def: 'derived@1', name: 'derived', p: [0, 0] }, { op: 'place', def: 'sha:' + hash, name: 'pinned', p: [10, 0] }]));
  const pinned = w.get('pinned')!, derived = w.get('derived')!;
  const changed = ok(act(w, [{ op: 'define', def: post([2, 3, 2]) }]));
  assert.deepEqual(changed.diff!.upserts.map(e => e.id), [derived.id]);
  assert.equal(w.footprintsOf(derived.id)[0].half[0], 1); assert.equal(w.footprintsOf(pinned.id)[0].half[0], 0.25);
  ok(act(w, changed.inverse!, true)); assert.equal(w.footprintsOf(derived.id)[0].half[0], 0.25);
});

test('redefinition checks changed instances against each other, without old indexed footprints', () => {
  const w = fresh();
  ok(act(w, [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'a', p: [0, 0] }, { op: 'place', def: 'probe-post@1', name: 'b', p: [2, 0] }]));
  const before = structuredClone(w.snapshot()), r = act(w, [{ op: 'define', def: post([3, 2, 3]) }]);
  assert.equal(r.result.accepted, false);
  if (!r.result.accepted) { assert.equal(r.result.failures[0].code, 'overlap.solid'); assert.equal(r.result.failures[0].entity, w.get('b')!.id); }
  assert.deepEqual(w.snapshot(), before);
});

test('slot changes re-admit descendants and refuse missing or smaller slots atomically', () => {
  const w = fresh();
  const parent: DefInput = { schema: 'def/1', name: 'host', make: { kind: 'none' }, size: { box: [1, 1, 1] }, slots: [{ id: 'top', kind: 'surface', p: [0, 1, 0], accepts: { maxSize: [2, 2, 2] } }] };
  ok(act(w, [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'define', def: parent }, { op: 'place', def: 'host@1', name: 'host', p: [0, 0] }, { op: 'place', def: 'probe-post@1', name: 'post', in: { parent: 'host', slot: 'top' } }]));
  const before = structuredClone(w.snapshot());
  for (const def of [{ ...parent, slots: [] }, { ...parent, slots: [{ ...parent.slots![0], accepts: { maxSize: [0.1, 0.1, 0.1] } }] }] as DefInput[]) {
    const r = act(w, [{ op: 'define', def }]); assert.equal(r.result.accepted, false);
    if (!r.result.accepted) { assert.match(r.result.failures[0].code, /^slot\./); assert.equal(r.result.failures[0].entity, w.get('host/post')!.id); assert.ok(r.result.failures[0].fix); }
    assert.deepEqual(w.snapshot(), before);
  }
  const changed = ok(act(w, [{ op: 'define', def: { ...parent, slots: [{ ...parent.slots![0], p: [0, 2, 0] }] } }]));
  assert.equal(changed.diff!.upserts.length, 2); assert.equal(w.footprintsOf(w.get('host/post')!.id)[0].y0, 2);
  ok(act(w, changed.inverse!, true)); assert.equal(w.footprintsOf(w.get('host/post')!.id)[0].y0, 1);
});

test('scale, float support and body use apply to redefinition with repair context', () => {
  for (const kind of ['scale', 'float', 'occupied', 'held'] as const) {
    const w = fresh();
    ok(act(w, [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }]));
    const before = structuredClone(w.snapshot());
    const def: DefInput = { ...post([1, 2, 1]), ...(kind === 'scale' ? { size: { box: [1, 2, 1], scale: [2, 3] } } : kind === 'float' ? { anchor: 'float' } : {}) };
    const r = applyBatch(w, { ops: [{ op: 'define', def }] }, 'god', 100, { uses: kind === 'occupied' || kind === 'held' ? () => ({ code: kind === 'occupied' ? 'occupied.by-body' : 'held.by-body', detail: `post is ${kind} by Ada` }) : undefined });
    assert.equal(r.result.accepted, false);
    if (!r.result.accepted) {
      const f = r.result.failures[0]; assert.equal(f.code, kind === 'scale' ? 'size.range' : kind === 'float' ? 'float.no-water' : `${kind}.by-body`);
      assert.equal(f.entity, w.get('post')!.id); assert.equal(f.op, 0); assert.ok(f.field && f.fix);
    }
    assert.deepEqual(w.snapshot(), before);
  }
});

test('library core refs reject changed content; identical adoption remains allowed; trusted ops stay internal', () => {
  const w = fresh(), core = coreLibrary().get('core/bench@1')!;
  ok(act(w, [{ op: 'define', def: core }]));
  const before = structuredClone(w.snapshot());
  const r = act(w, [{ op: 'define', def: { ...core, description: 'agent override' } }]);
  assert.equal(r.result.accepted, false);
  if (!r.result.accepted) { assert.equal(r.result.failures[0].code, 'constant.immutable'); assert.equal(r.result.failures[0].field, 'def.name'); }
  assert.deepEqual(w.snapshot(), before);
  assert.equal(act(w, [{ op: 'restore-def', ref: core.ref, hash: core.hash }]).result.accepted, false);
  assert.equal(act(w, []).result.accepted, false);
  ok(act(w, [], true));
});

test('trusted library revision adoption retains both exact hashes and refuses ordinary redefinition', () => {
  const old = post([0.5, 1, 0.5]), current = { ...old, description: 'current library revision' };
  // Library membership, rather than a core-* spelling, owns the ref.
  const library = buildLibrary('revisions', [old, current]);
  const w = fresh(); w.library = library;
  const source = new WorldModel({ constants: { ground: 'land' }, seed: 'revisions' });
  const pinned = source.defineDef(old, 'core', 0), latest = library.get(pinned.ref)!;
  const before = structuredClone(w.snapshot());
  const refused = act(w, [{ op: 'define', def: old }]);
  assert.equal(refused.result.accepted, false);
  if (!refused.result.accepted) assert.equal(refused.result.failures[0].code, 'constant.immutable');
  assert.deepEqual(w.snapshot(), before);
  ok(act(w, [{ op: 'define', def: old }], true));
  ok(act(w, [
    { op: 'place', def: 'sha:' + pinned.hash, name: 'old', p: [0, 0] },
    { op: 'place', def: 'sha:' + latest.hash, name: 'latest', p: [4, 0] },
  ]));
  const loaded = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
  assert.deepEqual(loaded.def('sha:' + pinned.hash), pinned);
  assert.deepEqual(loaded.def('sha:' + latest.hash), latest);
  assert.equal(loaded.get('old')!.def, 'sha:' + pinned.hash);
  assert.equal(loaded.get('latest')!.def, 'sha:' + latest.hash);
  assert.equal(w.def(pinned.ref)!.hash, pinned.hash, 'adopting another hash does not rebind the pinned name');
  const adopted = structuredClone(w.snapshot());
  assert.equal(act(w, [{ op: 'define', def: { ...old, description: 'agent override' } }]).result.accepted, false);
  assert.deepEqual(w.snapshot(), adopted);
});

test('a world-local core-* name is not a library definition', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'local-core' });
  const def = { ...post([0.5, 1, 0.5]), name: 'core-local-post' };
  ok(act(w, [{ op: 'define', def }]));
  const previous = w.def('core-local-post@1')!.hash;
  ok(act(w, [{ op: 'define', def: { ...def, description: 'second local revision' } }]));
  assert.notEqual(w.def('core-local-post@1')!.hash, previous);
  assert.equal(w.def('sha:' + previous)!.hash, previous);
});

test('legacy core-owned definitions remain protected without a live library', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'legacy-core' });
  const def = { ...post([0.5, 1, 0.5]), name: 'core-legacy-post' };
  w.defineDef(def, 'core', 0);
  const before = structuredClone(w.snapshot());
  const r = act(w, [{ op: 'define', def: { ...def, description: 'agent override' } }]);
  assert.equal(r.result.accepted, false);
  if (!r.result.accepted) assert.equal(r.result.failures[0].code, 'constant.immutable');
  assert.deepEqual(w.snapshot(), before);
});

test('definition undo restores geometry prepared by a new generator while preserving later state edits', () => {
  const w = fresh();
  const base: DefInput = { schema: 'def/1', name: 'lane', form: 'path', layer: 'surface', make: { kind: 'none' }, size: { box: [10, 0.1, 10] }, state: { label: { type: 'string', default: 'old', max: 30 } } };
  ok(act(w, [{ op: 'define', def: base }, { op: 'place', def: 'lane@1', name: 'lane', shape: { path: [[0, 0], [10, 0]], width: 2 } }]));
  const before = structuredClone(w.get('lane')!);
  const changed = ok(act(w, [{ op: 'define', def: { ...base, make: { kind: 'gen', gen: 'path/1' } } }]));
  assert.ok(w.get('lane')!.params?.grade);
  ok(act(w, [{ op: 'set', id: 'lane', state: { label: 'later' } }]));
  const reverted = ok(act(w, changed.inverse!, true));
  assert.deepEqual(w.get('lane')!.params, before.params); assert.equal(w.get('lane')!.state!.label, 'later');
  ok(act(w, reverted.inverse!, true)); assert.ok(w.get('lane')!.params?.grade);
});
