import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERATORS, WorldModel, applyBatch, fieldSchema, hashOf, registerGenerator, type DefInput } from './index.ts';

const fresh = () => new WorldModel({constants: {ground: 'land'}, seed: 'define-cost'});
const def: DefInput = {schema: 'def/1', name: 'local', size: {box: [1, 1, 1]}, layer: 'decor', make: {kind: 'none'}};
const act = (w: WorldModel, ops: unknown[], trusted = false) => {
  const r = applyBatch(w, {ops}, 'god', 1, {trusted});
  assert.equal(r.result.accepted, true, JSON.stringify(r.result)); return r;
};

test('effective identities memoize each ref, include ancestor hashes, and preserve pinned aliases', t => {
  const w = fresh(), original = w.defineDef(def, 'god', 0);
  w.defineDef({...def, name: 'core-derived', extends: original.ref}, 'god', 0);
  const lookup = w.def.bind(w); let reads = 0;
  t.mock.method(w, 'def', (ref: string) => {reads++; return lookup(ref);});
  const memo = new Map<string, string>();
  const before = w.effectiveDefIdentity('core/derived@1', memo);
  for (let i = 0; i < 1000; i++) assert.equal(w.effectiveDefIdentity('core/derived@1', memo), before);
  assert.equal(reads, 2, 'one lookup per member of the chain, independent of instance count');
  assert.equal(w.effectiveDefIdentity('core-derived@1', memo), before);
  const pinned = w.effectiveDefIdentity('sha:' + original.hash, memo);
  w.defineDef({...def, description: 'revised'}, 'god', 1);
  assert.notEqual(w.effectiveDefIdentity('core/derived@1', new Map()), before);
  assert.equal(w.effectiveDefIdentity('sha:' + original.hash, new Map()), pinned);
  w.restoreDef(original.ref, original.hash);
  assert.equal(w.effectiveDefIdentity('core/derived@1', new Map()), before);
  assert.notEqual(w.effectiveDefIdentity('missing@1', new Map()), pinned);
});

test('effective identities include the parsed generator fields added by resolvedDef', t => {
  const id = 'define-cost/1', width = {type: 'number' as const, default: 2};
  registerGenerator({id, form: 'point', doc: 'test', params: {width}, physics: () => ({box: [1,1,1], colliders: [], slots: [], tris: 0})});
  t.after(() => {delete GENERATORS[id];});
  const w = fresh(), stored = w.defineDef({...def, make: {kind: 'gen', gen: id}}, 'god', 0);
  const expected = hashOf({width: fieldSchema.parse(width)});
  assert.equal(w.effectiveDefIdentity(stored.ref, new Map()), `${stored.hash}|${expected}`);
  assert.deepEqual(w.resolvedDef(stored.ref)!.params.width, fieldSchema.parse(width));
});

test('new definitions skip instance identities and redefinitions compute each distinct ref once per binding set', t => {
  const w = fresh(); w.defineDef(def, 'god', 0);
  const hash = w.def('local@1')!.hash;
  for (let i = 0; i < 120; i++) w.insert({id: `i${i}`, def: i % 2 ? 'local@1' : 'sha:' + hash, in: {parent: 'world'}, by: 'fixture', born: 0, v: 1});
  const identity = WorldModel.prototype.effectiveDefIdentity;
  const misses = new Map<Map<string, string>, string[]>(); let calls = 0;
  t.mock.method(WorldModel.prototype, 'effectiveDefIdentity', function(this: WorldModel, ref: string, memo: Map<string, string>) {
    calls++;
    if (!memo.has(ref)) {const refs = misses.get(memo) ?? []; refs.push(ref); misses.set(memo, refs);}
    return identity.call(this, ref, memo);
  });
  act(w, [{op: 'define', def: {...def, name: 'unrelated'}}]);
  assert.equal(calls, 0, 'a new definition cannot rebind existing instances');
  const r = act(w, [{op: 'define', def: {...def, description: 'revised'}}]);
  assert.equal(misses.size, 2, 'before and after have separate binding memos');
  for (const refs of misses.values()) assert.deepEqual(refs.sort(), ['local@1', 'sha:' + hash].sort());
  assert.equal(r.diff!.upserts.length, 60, 'only the named instances rebind');
});

test('multiple defines and restores in one plan invalidate identities between operations', () => {
  const w = fresh(), original = w.defineDef(def, 'god', 0);
  act(w, [{op: 'place', def: original.ref, name: 'placed'}]);
  const r = act(w, [{op: 'define', def: {...def, description: 'second'}}, {op: 'define', def: {...def, description: 'third'}}, {op: 'restore-def', ref: original.ref, hash: original.hash}], true);
  assert.equal(w.get('placed')!.v, 4);
  assert.equal(w.def(original.ref)!.hash, original.hash);
  assert.equal(r.diff!.upserts.length, 1);
  act(w, r.inverse!, true);
  assert.equal(w.get('placed')!.v, 7);
  assert.equal(w.def(original.ref)!.hash, original.hash);
});
