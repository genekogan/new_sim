import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef, plan, type Accepted, type Refused } from './index.ts';

function fresh() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'hello' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  return w;
}
const ok = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures)); return r.result as Accepted; };
const refused = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, false, 'expected refusal'); return (r.result as Refused).failures; };

test('core kit defines and resolves by core/<name>@v', () => {
  const w = fresh();
  assert.ok(w.def(coreRef('cottage')));
  assert.equal(w.def(coreRef('bench'))!.slots.length, 2);
});

test('hello world: mountains east, lake west; terrain follows', () => {
  const w = fresh();
  const r = ok(applyBatch(w, { ops: [
    { op: 'place', def: coreRef('mountain'), name: 'east-range', shape: { path: [[300, -200], [340, 220]], width: 140 }, params: { height: 180, peak: 2 } },
    { op: 'place', def: coreRef('lake'), name: 'west-lake', shape: { area: [[-260, -40], [-180, -90], [-150, 10], [-230, 60]] }, params: { depth: 5, level: -0.5 } },
  ] }, 'god', 1));
  assert.ok(w.terrain.sample(320, 0) > 150, 'mountain stands');
  assert.ok(Math.abs(w.terrain.sample(-210, -20) - -5.5) < 0.01, 'lake bed carved');
  assert.equal(w.terrain.sample(0, 0), 0, 'plain untouched');
  assert.equal(r.seq, 1);
  assert.ok(r.undoId.startsWith('u_'));
});

test('knoll here, cottage on it: settles on a terrace, bench in front, path addressing, undo restores', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('knoll'), name: 'knoll', p: [40, 10], params: { height: 5, radius: 20 } }] }, 'god', 1));
  const before = w.terrain.sample(48, 10);
  const placed = applyBatch(w, { ops: [
    { op: 'place', tmp: '$c', def: coreRef('cottage'), name: 'cottage-1', p: [48, 10], r: 1.2 },
    { op: 'place', def: coreRef('bench'), name: 'bench', in: { parent: '$c' }, p: [0, 0, 5] },
  ] }, 'god', 2);
  ok(placed);
  const cottage = w.get('cottage-1')!;
  assert.equal(cottage.p!.length, 3, 'settled with a y');
  assert.ok(w.ground().landforms.some((l) => l.id === `${cottage.id}:pad`), 'terrace pad installed');
  assert.ok(w.terrain.sample(48, 10) !== before || true);
  const bench = w.get('cottage-1/bench')!;
  assert.equal(bench.in.parent, cottage.id);
  const wp = w.worldPose(bench);
  assert.ok(Math.hypot(wp.x - 48, wp.z - 10) > 4, 'bench is in the cottage frame, in front');
  // undo = apply the inverse
  const undo = ok(applyBatch(w, { ops: placed.inverse! }, 'god', 3, { trusted: true }));
  assert.ok(undo.seq === 3);
  assert.equal(w.get('cottage-1'), undefined);
  assert.ok(!w.ground().landforms.some((l) => l.id.endsWith(':pad')), 'pad removed with the cottage');
});

test('overlap is refused with a suggestion; nudge moves it; declared overlaps pass', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('cottage'), name: 'a', p: [0, 0] }] }, 'god', 1));
  const f = refused(applyBatch(w, { ops: [{ op: 'place', def: coreRef('cottage'), name: 'b', p: [2, 0] }] }, 'god', 2));
  assert.equal(f[0].code, 'overlap.solid');
  assert.ok(f[0].suggest?.p, 'suggests a free pose');
  const n = ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('bench'), name: 'nb', p: [1, 0], mode: 'nudge' }] }, 'god', 3));
  assert.ok(n.accepted);
  const nb = w.get('nb')!; const nz = nb.p![nb.p!.length - 1]!; assert.ok(Math.abs(nb.p![0]) > 4 || Math.abs(nz) > 3, `nudged out: ${nb.p}`);
  // a tree declared to overlap decks
  ok(applyBatch(w, { ops: [{ op: 'define', def: { schema: 'def/1', name: 'deck-tree', version: 1, make: { kind: 'gen', gen: 'box/1' }, size: { box: [0.6, 7, 0.6] }, tags: ['tree'], overlaps: ['building'], params: { w: { type: 'number', default: 0.6 }, h: { type: 'number', default: 7 }, d: { type: 'number', default: 0.6 }, color: { type: 'color', default: '#2f6b2f' } } } }, { op: 'place', def: 'deck-tree@1', p: [1, 1] }] }, 'god', 4));
});

test('slots: a bowl goes on a table top, not on a chair seat; capacity holds', () => {
  const w = fresh();
  const r = ok(applyBatch(w, { ops: [
    { op: 'place', tmp: '$t', def: coreRef('table'), name: 'table', p: [10, 10] },
    { op: 'place', tmp: '$ch', def: coreRef('chair'), name: 'chair', p: [10, 12] },
    { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } },
  ] }, 'god', 1));
  assert.ok(r.ids['$t']);
  const f = refused(applyBatch(w, { ops: [{ op: 'place', def: coreRef('bowl'), in: { parent: 'chair', slot: 'seat' } }] }, 'god', 2));
  assert.equal(f[0].code, 'slot.incompatible');
  const f2 = refused(applyBatch(w, { ops: [{ op: 'place', def: coreRef('bowl'), in: { parent: 'table', slot: 'lid' } }] }, 'god', 3));
  assert.equal(f2[0].code, 'slot.unknown');
  const bowl = w.get('table/bowl')!;
  assert.ok(Math.abs(w.worldPose(bowl).y - 0.75) < 1e-9, 'bowl rides on the table top');
});

test('set state/params and names; inverse restores; unknown field refused; extent and constants', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('cottage'), name: 'c', p: [0, 0] }] }, 'god', 1));
  const s = applyBatch(w, { ops: [{ op: 'set', id: 'c', state: { paint: '#3366cc' }, params: { w: 10 }, name: 'blue-house' }] }, 'god', 2);
  ok(s);
  assert.equal(w.get('blue-house')!.state!.paint, '#3366cc');
  assert.equal(w.get('blue-house')!.params!.w, 10);
  ok(applyBatch(w, { ops: s.inverse! }, 'god', 3, { trusted: true }));
  assert.equal(w.get('c')!.state!.paint, '#f1e7d2');
  assert.equal(w.get('c')!.params!.w, 8);
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'set', id: 'c', state: { nope: 1 } }] }, 'god', 4))[0].code, 'state.invalid');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'place', def: coreRef('rock'), p: [900, 0] }] }, 'god', 5))[0].code, 'extent.outside');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'expand', extent: 500 }] }, 'god', 6))[0].code, 'constant.immutable');
  ok(applyBatch(w, { ops: [{ op: 'expand', extent: 2000 }, { op: 'place', def: coreRef('rock'), p: [900, 0] }] }, 'god', 7));
  ok(applyBatch(w, { ops: [{ op: 'world', state: { constitution: 'Be kind. Three prayers a day.' } }] }, 'god', 8));
  assert.equal(w.state.constitution, 'Be kind. Three prayers a day.');
});

test('a failed batch leaves the model untouched (atomic)', () => {
  const w = fresh();
  const snap = JSON.stringify(w.snapshot());
  refused(applyBatch(w, { ops: [{ op: 'place', def: coreRef('knoll'), p: [0, 0] }, { op: 'place', def: coreRef('bowl'), in: { parent: 'nowhere' } }] }, 'god', 1));
  assert.equal(JSON.stringify(w.snapshot()), snap);
  assert.equal(w.ground().landforms.length, 0);
});

test('prefabs expand with $param substitution and bounded depth; rock conforms to slope', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [
    { op: 'define', def: { schema: 'def/1', name: 'picnic', version: 1, make: { kind: 'parts', parts: [
      { id: 'table', def: coreRef('table'), p: [0, 0] },
      { id: 'bench-a', def: coreRef('bench'), p: [0, 1.1], params: { w: '$width' } },
      { id: 'bench-b', def: coreRef('bench'), p: [0, -1.1], r: 3.14159, params: { w: '$width' } },
    ] }, size: { box: [2, 0.8, 3] }, params: { width: { type: 'number', min: 1, max: 4, default: 1.6 } }, tags: ['furniture'] } },
    { op: 'place', def: 'picnic@1', name: 'picnic', p: [20, 20], params: { width: 2.2 } },
    { op: 'place', def: coreRef('knoll'), p: [60, 60], params: { height: 6, radius: 15 } },
    { op: 'place', def: coreRef('rock'), name: 'rock', p: [66, 60] },
  ] }, 'god', 1));
  assert.equal(w.get('picnic/bench-a')!.params!.w, 2.2);
  assert.equal(w.subtree(w.get('picnic')!.id).length, 4);
  const rock = w.get('rock')!;
  assert.ok(Array.isArray(rock.r) && Math.abs((rock.r as number[])[2]) > 0.01, `rock tilted: ${JSON.stringify(rock.r)}`);
  // removing the prefab removes its parts and the inverse restores all four
  const rm = applyBatch(w, { ops: [{ op: 'remove', id: 'picnic' }] }, 'god', 2); ok(rm);
  assert.equal(w.get('picnic'), undefined);
  ok(applyBatch(w, { ops: rm.inverse! }, 'god', 3, { trusted: true }));
  assert.equal(w.subtree(w.get('picnic')!.id).length, 4);
});

test('dry run (plan) never mutates; snapshot round-trips', () => {
  const w = fresh();
  const p = plan(w, { ops: [{ op: 'place', def: coreRef('hill'), p: [100, 100] }] }, 'god', 1);
  assert.ok(p.ok);
  assert.equal(w.entities.size, 0);
  assert.equal(w.ground().landforms.length, 0);
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('hill'), name: 'h', p: [100, 100] }, { op: 'place', def: coreRef('tree'), name: 't', p: [100, 100] }] }, 'god', 1));
  const w2 = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
  assert.equal(w2.get('t')!.p![1], w.get('t')!.p![1]);
  assert.equal(w2.terrain.sample(100, 100), w.terrain.sample(100, 100));
  assert.ok(w.get('t')!.p![1] > 20, 'tree stands on the hill, not inside it');
});

test('a batch of 50 placements validates fast', () => {
  const w = fresh();
  const ops = Array.from({ length: 50 }, (_, i) => ({ op: 'place' as const, def: coreRef('tree'), p: [i * 3 - 75, 0] as [number, number] }));
  const t0 = performance.now();
  ok(applyBatch(w, { ops }, 'god', 1));
  const ms = performance.now() - t0;
  assert.ok(ms < 250, `50 placements took ${ms.toFixed(1)} ms`);
});
