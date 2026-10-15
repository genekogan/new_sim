import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { GENERATORS, WorldModel, applyBatch, plan, registerGenerator, type Baked, type DefInput, type Failure, type Generator } from './index.ts';

const fresh = () => new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'admission-test' });
const baked = (): Baked => ({ box: [1, 1, 1], colliders: [], slots: [], tris: 12 });
const def = (gen: string, extra: Partial<DefInput> = {}): DefInput => ({ schema: 'def/1', name: 'candidate', make: { kind: 'gen', gen }, layer: 'decor', size: { box: [1, 1, 1] }, ...extra });
function register(t: TestContext, g: Generator) { registerGenerator(g); t.after(() => { delete GENERATORS[g.id]; }); }
function refusal(w: WorldModel, ops: unknown[]): Failure {
  const before = w.snapshot();
  const result = applyBatch(w, { ops }, 'god', 1).result;
  assert.equal(result.accepted, false, JSON.stringify(result));
  if (result.accepted) throw new Error('expected refusal');
  assert.deepEqual(w.snapshot(), before, 'a refusal leaves definitions, entities, terrain and editSeq unchanged');
  assert.equal(result.failures.length, 1);
  return result.failures[0];
}

test('unknown generator is refused on define with op index and nearest known ids', () => {
  const w = fresh();
  const failure = refusal(w, [{ op: 'world', state: { constitution: 'scratch only' } }, { op: 'define', def: def('kitt/2') }]);
  assert.equal(failure.op, 1);
  assert.equal(failure.code, 'def.invalid');
  assert.equal(failure.def, 'candidate@1');
  assert.equal(failure.field, 'make.gen');
  assert.equal(failure.measured, 'kitt/2');
  assert.match(failure.fix!, /kit\/2/);
});

test('malformed kit args are refused before placement with a repairable field and measured bound', () => {
  const w = fresh();
  const failure = refusal(w, [{ op: 'define', def: def('kit/2', { make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'lathe', at: [0, 0, 0], profile: [[1, 0]] }] } } }) }, { op: 'place', def: 'candidate@1' }]);
  assert.equal(failure.op, 0);
  assert.equal(failure.code, 'def.invalid');
  assert.equal(failure.field, 'make.args.shapes.0.profile');
  assert.equal(failure.fix, 'lathe profile needs ≥2 points');
  assert.equal(failure.measured, 1);
  assert.equal(failure.limit, 2);
  assert.doesNotMatch(failure.detail, /"code":|ZodError/);
});

test('any registered generator gets its own argument-schema admission', (t) => {
  let seen: unknown;
  const args = z.object({ count: z.number().int().min(2).default(2) });
  register(t, { id: 'admission-schema/1', form: 'point', params: {}, doc: 'test', args, physics(ctx) { seen = args.parse(ctx.args).count; return baked(); } });
  const w = fresh();
  const failure = refusal(w, [{ op: 'define', def: def('admission-schema/1', { make: { kind: 'gen', gen: 'admission-schema/1', args: { count: 1 } } }) }]);
  assert.equal(failure.field, 'make.args.count');
  assert.equal(failure.measured, 1);
  assert.equal(failure.limit, 2);
  const result = applyBatch(w, { ops: [{ op: 'define', def: def('admission-schema/1') }] }, 'god', 1).result;
  assert.equal(result.accepted, true);
  assert.equal(seen, 2);
});

test('define trial bake receives inherited defaults and a bounded canonical shape', (t) => {
  const seen: unknown[] = [];
  register(t, { id: 'admission-path/1', form: 'path', params: { width: { type: 'number', default: 2 } }, doc: 'test', physics(ctx) { seen.push(ctx); if (ctx.params.width !== 3) throw new Error('width must be 3 for this design'); return baked(); } });
  const w = fresh();
  w.defineDef(def('admission-path/1', { name: 'base', form: 'path', params: { width: { type: 'number', default: 3 } } }), 'god', 0);
  const result = applyBatch(w, { ops: [{ op: 'define', def: def('admission-path/1', { extends: 'base@1', form: 'path', make: { kind: 'none' } }) }] }, 'god', 1).result;
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(seen.length, 1);
  assert.deepEqual((seen[0] as { shape: unknown }).shape, { path: [[0, 0], [1, 0]] });
});

test('throwing trial bake refuses define and includes the failing definition', (t) => {
  register(t, { id: 'admission-throw/1', form: 'point', params: {}, doc: 'test', physics() { throw new Error('unsupported profile combination'); } });
  const failure = refusal(fresh(), [{ op: 'define', def: def('admission-throw/1') }]);
  assert.equal(failure.op, 0);
  assert.equal(failure.code, 'def.invalid');
  assert.equal(failure.def, 'candidate@1');
  assert.equal(failure.field, 'make');
  assert.match(failure.detail, /unsupported profile combination/);
  assert.match(failure.fix!, /admission-throw\/1/);
});

test('legacy unknown and malformed generators refuse place instead of throwing', () => {
  for (const input of [def('no-such-gen/1'), def('kit/2', { make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'lathe', at: [0, 0, 0], profile: [[1, 0]] }] } } })]) {
    const w = fresh(); w.defineDef(input, 'legacy', 0);
    const failure = refusal(w, [{ op: 'world', state: { constitution: 'unchanged' } }, { op: 'place', def: 'candidate@1' }]);
    assert.equal(failure.op, 1);
    assert.equal(failure.code, 'def.invalid');
    assert.equal(failure.def, 'candidate@1');
    assert.match(failure.entity!, /^e_/);
    assert.ok(failure.field && failure.fix);
  }
});

test('instance-param and moved-shape bake failures are typed and atomic', (t) => {
  register(t, { id: 'admission-instance/1', form: 'path', params: { bad: { type: 'bool', default: false } }, doc: 'test', physics({ params, shape }) { if (params.bad) throw new Error('bad instance option'); if (shape?.path?.length === 3) throw new Error('three-point path unsupported'); return baked(); } });
  const w = fresh(); w.defineDef(def('admission-instance/1', { form: 'path' }), 'legacy', 0);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'candidate@1', name: 'item', shape: { path: [[0, 0], [1, 0]] } }] }, 'god', 0).result.accepted, true);
  for (const op of [{ op: 'set', id: 'item', params: { bad: true } }, { op: 'move', id: 'item', shape: { path: [[0, 0], [1, 0], [2, 0]] } }]) {
    const failure = refusal(w, [op]);
    assert.equal(failure.op, 0);
    assert.equal(failure.code, 'def.invalid');
    assert.equal(failure.entity, w.get('item')!.id);
    assert.equal(failure.field, op.op === 'set' ? 'params' : 'shape');
  }
});

test('clone catches bake failures in restored legacy worlds', (t) => {
  let throwing = false;
  register(t, { id: 'admission-clone/1', form: 'point', params: {}, doc: 'test', physics() { if (throwing) throw new Error('clone bake failed'); return baked(); } });
  const original = fresh(); original.defineDef(def('admission-clone/1'), 'legacy', 0);
  assert.equal(applyBatch(original, { ops: [{ op: 'place', def: 'candidate@1', name: 'source' }] }, 'god', 0).result.accepted, true);
  const w = WorldModel.fromSnapshot(original.snapshot()); throwing = true;
  const failure = refusal(w, [{ op: 'clone', id: 'source', count: 2 }]);
  assert.equal(failure.op, 0);
  assert.equal(failure.code, 'def.invalid');
  assert.equal(failure.def, 'candidate@1');
  assert.equal(failure.entity, w.get('source')!.id);
});

test('dependent rebake failures name the dependent and the causative op', (t) => {
  let throwing = false;
  register(t, { id: 'admission-dependent/1', form: 'point', params: {}, doc: 'test', physics() { if (throwing) throw new Error('dependent bake failed'); return baked(); } });
  const original = fresh(); original.defineDef(def('admission-dependent/1'), 'legacy', 0);
  original.defineDef(def('box/1', { name: 'target', make: { kind: 'none' } }), 'god', 0);
  assert.equal(applyBatch(original, { ops: [{ op: 'place', def: 'target@1', name: 'target', p: [2, 0] }, { op: 'place', def: 'candidate@1', name: 'dependent', constraints: [{ kind: 'facing', ref: 'target', offset: 0 }] }] }, 'god', 0).result.accepted, true);
  const w = WorldModel.fromSnapshot(original.snapshot()); throwing = true;
  const failure = refusal(w, [{ op: 'move', id: 'target', p: [4, 0] }, { op: 'world', state: { constitution: 'unrelated' } }]);
  assert.equal(failure.op, 0);
  assert.equal(failure.code, 'def.invalid');
  assert.equal(failure.entity, w.get('dependent')!.id);
  assert.equal(failure.def, 'candidate@1');
});

test('trial bake failure is a typed refusal from plan as well as applyBatch', (t) => {
  register(t, { id: 'admission-plan/1', form: 'point', params: {}, doc: 'test', physics() { throw new TypeError('invalid plan'); } });
  const result = plan(fresh(), { ops: [{ op: 'define', def: def('admission-plan/1') }] }, 'god', 0);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected refusal');
  assert.equal(result.failures[0].code, 'def.invalid');
});

test('parent-slot bake failures preserve the actual failing def and parent entity', () => {
  const w = fresh();
  w.defineDef(def('kit/2', { name: 'bad-parent' }), 'legacy', 0);
  w.defineDef(def('box/1', { name: 'child', make: { kind: 'none' } }), 'god', 0);
  w.insert({ id: 'e_parent01', name: 'parent', def: 'bad-parent@1', in: { parent: 'world' }, by: 'legacy', born: 0, v: 1 });
  const failure = refusal(w, [{ op: 'place', def: 'child@1', in: { parent: 'parent', slot: 'top' } }]);
  assert.equal(failure.op, 0);
  assert.equal(failure.code, 'def.invalid');
  assert.equal(failure.def, 'bad-parent@1');
  assert.equal(failure.entity, 'e_parent01');
  assert.equal(failure.field, 'make.args.shapes');
});

test('prefab expansion bake failures refuse the entire placement', () => {
  const w = fresh();
  w.defineDef(def('kit/2', { name: 'bad-part' }), 'legacy', 0);
  w.defineDef(def('box/1', { name: 'prefab', make: { kind: 'parts', parts: [{ id: 'part', def: 'bad-part@1' }] } }), 'legacy', 0);
  const failure = refusal(w, [{ op: 'place', def: 'prefab@1' }]);
  assert.equal(failure.code, 'def.invalid');
  assert.equal(failure.def, 'bad-part@1');
  assert.match(failure.entity!, /^e_/);
  assert.equal(failure.field, 'make.args.shapes');
});

test('a bake exception from final refusal-hook planning stays typed', () => {
  const w = fresh(); w.defineDef(def('no-such-gen/1'), 'legacy', 0);
  const before = w.snapshot();
  const result = plan(w, { ops: [{ op: 'world', state: { constitution: 'scratch' } }] }, 'god', 0, { refuse(scratch) { scratch.bake(scratch.resolvedDef('candidate@1')!, {}, 0); return null; } });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected refusal');
  assert.equal(result.failures[0].op, 0);
  assert.equal(result.failures[0].code, 'def.invalid');
  assert.equal(result.failures[0].def, 'candidate@1');
  assert.deepEqual(w.snapshot(), before);
});
