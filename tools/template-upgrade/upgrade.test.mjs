// node --test tools/template-upgrade/upgrade.test.mjs — the template upgrade tool's pure parts (no server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSpec, plan, batches, matchesOp, verifyApplied, rollbackGuard, verifyRolledBack, restoreOps, canon, MAX_OPS } from './upgrade.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const drum = (h) => ({ schema: 'def/1', name: 'eden-drum', version: 1, form: 'point', make: { kind: 'gen', gen: 'kit/2', args: { h } } });
const oldTpl = { batches: [
  { note: 'a', ops: [{ op: 'define', def: drum(1) },
    { op: 'place', tmp: '$h', def: 'core/hall@1', name: 'hotel', p: [10, 20], params: { w: 8, d: 6, plan: { v: 1 } } },
    { op: 'place', def: 'core/bench@1', name: 'hall-bench', in: { parent: '$h', slot: 'hall' }, p: [1, 0, 1] },
    { op: 'place', def: 'core/chalet@1', name: 'chalet', p: [50, 50], r: 0 },
    { op: 'place', def: 'core/chalet@1', name: 'cabin', p: [80, 80], r: 0 },
    { op: 'place', def: 'eden-drum@1', name: 'stage-drum', p: [-30, 0] }] }] };
const newTpl = { batches: [
  { note: 'a', ops: [{ op: 'define', def: drum(2) }, { op: 'define', def: { ...drum(1), name: 'eden-stand' } },
    { op: 'place', tmp: '$x', def: 'core/hall@1', name: 'hotel', p: [10, 20], params: { w: 8, d: 6, plan: { v: 2 } } },
    { op: 'place', tmp: '$bed', def: 'core/bed@1', name: 'guest-bed', in: { parent: '$x', slot: 'guest-1' }, p: [0, 0, 1] },
    { op: 'place', def: 'core/lamp@1', name: 'bed-lamp', in: { parent: '$bed', slot: 'top' }, p: [0, 0, 0] },
    { op: 'place', def: 'core/chalet@1', name: 'chalet', p: [50, 50], r: 1.571 },
    { op: 'place', def: 'core/chalet@1', name: 'cabin', p: [80, 80], r: 1.571 },
    { op: 'place', def: 'eden-drum@1', name: 'stage-drum', p: [-30, 0] },
    { op: 'place', def: 'eden-stand@1', name: 'stage-stand', p: [-31, 0] }] }] };
const spec = makeSpec(oldTpl, newTpl, { id: 't', world: 'w', from: 'a', to: 'b' });
const ent = (id, name, def, p, extra = {}) => ({ id, name, def, in: { parent: 'world' }, by: 'god', born: 0, v: 1, p, ...extra });
const world = () => ({ worldId: 'w-1', seq: 5, defs: [{ name: 'eden-drum', version: 1, make: drum(1).make }], entities: [
  ent('e_h', 'hotel', 'core-hall@1', [10, 0, 20], { params: { w: 8, d: 6, plan: { v: 1 }, roof: 'flat' } }),
  ent('e_b', 'hall-bench', 'core-bench@1', [1, 0, 1], { in: { parent: 'e_h', slot: 'hall' }, params: { wood: '#a' } }),
  ent('e_c', 'chalet', 'core-chalet@1', [50, 3, 50], { r: 0 }),
  ent('e_k', 'cabin', 'core-chalet@1', [80, 3, 80], { r: 0 }),
  ent('e_d', 'stage-drum', 'eden-drum@1', [-30, 0, 0]),
  { id: 'h_1', name: 'ada', def: 'core/humanoid@1', in: { parent: 'world' }, by: 'engine', v: 9, p: [-100, 0, -100] }] });

test('spec: name paths through tmp parents; add / remove / change / define', () => {
  assert.deepEqual(spec.counts, { define: 2, add: 3, remove: 1, change: 3 });
  const add = spec.items.filter((i) => i.kind === 'add').map((i) => [i.path, i.parent]);
  assert.deepEqual(add, [['hotel/guest-bed', 'hotel'], ['hotel/guest-bed/bed-lamp', 'hotel/guest-bed'], ['stage-stand', null]]);
  assert.equal(spec.items.find((i) => i.kind === 'remove').path, 'hotel/hall-bench');
  assert.ok(!('tmp' in spec.items.find((i) => i.path === 'hotel').new), 'tmp ids are batch-local, never compared');
  assert.ok(spec.oldUnits.hotel['hotel/hall-bench'] && spec.newUnits.hotel['hotel/guest-bed']);
});

test('match: def, x/z, yaw, params subset with world defaults, slot', () => {
  const w = world(), hotel = w.entities[0];
  assert.ok(matchesOp(hotel, oldTpl.batches[0].ops[1]));
  assert.ok(!matchesOp(hotel, newTpl.batches[0].ops[2]), 'plan differs');
  assert.ok(!matchesOp({ ...hotel, p: [10.2, 0, 20] }, oldTpl.batches[0].ops[1]), 'moved 0.2 m');
  assert.ok(matchesOp({ ...w.entities[1], p: [1, 0.4, 1] }, oldTpl.batches[0].ops[2]), 'y settles on its own');
  assert.ok(!matchesOp({ ...w.entities[1], in: { parent: 'e_h', slot: 'porch' } }, oldTpl.batches[0].ops[2]));
});

test('plan: pristine units get exact ops; changed, foreign-filled and occupied buildings are skipped whole', () => {
  const p = plan(world(), spec), hotel = p.units.find((u) => u.unit === 'hotel');
  assert.deepEqual(hotel.ops.map((o) => o.op), ['remove', 'set', 'place', 'place'], 'remove before the plan change, adds last');
  assert.deepEqual(hotel.ops[1], { op: 'set', id: 'e_h', params: { plan: { v: 2 } } });
  assert.deepEqual([hotel.ops[2].in, hotel.ops[2].tmp, hotel.ops[3].in], [{ parent: 'e_h', slot: 'guest-1' }, '$u0', { parent: '$u0', slot: 'top' }]);
  assert.deepEqual(hotel.meta, ['hotel/hall-bench', 'hotel', 'hotel/guest-bed', 'hotel/guest-bed/bed-lamp']);
  assert.deepEqual(p.units.find((u) => u.unit === 'chalet').ops, [{ op: 'move', id: 'e_c', r: 1.571, p: [50, 50] }], 'a turned root resettles');
  assert.deepEqual(p.defOps.map((o) => o.def.name), ['eden-drum', 'eden-stand']);

  const w = world(); w.entities.push(ent('e_mug', 'mug', 'core-mug@1', [0, 0, 0], { in: { parent: 'e_b', slot: 'top' } })); // a visitor's mug on the bench
  w.entities[3].r = 0.3; // somebody turned the cabin
  w.entities[5].p = [11, 0, 21]; // a body inside the hotel
  w.defs[0].make = { kind: 'gen', gen: 'kit/2', args: { h: 7 } }; // the world redefined its drum
  const q = plan(w, spec);
  assert.deepEqual(q.units.map((u) => u.unit).sort(), ['chalet', 'stage-stand']);
  const why = Object.fromEntries(q.report.skipped.map((s) => [s.unit, s.why]));
  assert.match(why.hotel, /foreign mug/); assert.match(why.hotel, /occupied by h_1/); assert.match(why.cabin, /changed cabin/);
  assert.deepEqual(q.report.kept, ['def eden-drum: changed in this world']);
});

test('plan is idempotent: an upgraded world plans nothing', () => {
  const w = world(); const h = w.entities[0]; h.params.plan = { v: 2 }; w.entities.splice(1, 1);
  w.entities.push(ent('e_g', 'guest-bed', 'core-bed@1', [0, 0, 1], { in: { parent: 'e_h', slot: 'guest-1' } }), ent('e_l', 'bed-lamp', 'core-lamp@1', [0, 0.5, 0], { in: { parent: 'e_g', slot: 'top' } }),
    ent('e_s', 'stage-stand', 'eden-stand@1', [-31, 0, 0]));
  w.entities[1].r = 1.571; w.entities[2].r = 1.571; w.defs = [{ name: 'eden-drum', make: drum(2).make }, { name: 'eden-stand', make: drum(1).make }];
  const p = plan(w, spec);
  assert.equal(p.units.length + p.defOps.length, 0); assert.equal(p.report.kept.length + p.report.skipped.length, 0);
});

test('batches: defines travel with their users; units never split; <= 256 ops', () => {
  const p = plan(world(), spec), bs = batches(p, 'g', 'n');
  assert.deepEqual(bs[0].units[0], 'stage-stand'); assert.equal(bs[0].ops[0].op, 'define');
  const big = { defOps: [], units: Array.from({ length: 5 }, (_, i) => ({ unit: `u${i}`, ops: Array.from({ length: 100 }, () => ({ op: 'move', id: `e${i}`, r: 1 })), meta: Array(100).fill(`u${i}`), expect: {} })) };
  const bb = batches(big, 'g', 'n');
  assert.deepEqual(bb.map((b) => b.ops.length), [200, 200, 100]); assert.ok(bb.every((b) => b.ops.length <= MAX_OPS && b.meta.length === b.ops.length));
  assert.deepEqual(bb.map((b) => b.clientRef), ['g-b0', 'g-b1', 'g-b2']);
});

test('verify, rollback guard, rollback check', () => {
  const pre = world(), p = plan(pre, spec), bs = batches(p, 'g', 'n');
  const newOps = Object.fromEntries(spec.items.filter((i) => i.new && i.path).map((i) => [i.path, i.new]));
  const receipt = { batches: bs, newOps };
  const after = world(); after.entities.splice(1, 1); after.entities[0].params.plan = { v: 2 }; after.entities[0].v = 2; after.entities[1].r = 1.571; after.entities[1].v = 2; after.entities[2].r = 1.571; after.entities[2].v = 2;
  after.entities.push(ent('e_g', 'guest-bed', 'core-bed@1', [0, 0, 1], { in: { parent: 'e_h', slot: 'guest-1' } }), ent('e_l', 'bed-lamp', 'core-lamp@1', [0, 0, 0], { in: { parent: 'e_g', slot: 'top' } }), ent('e_s', 'stage-stand', 'eden-stand@1', [-31, 0, 0]));
  after.entities.find((e) => e.id === 'h_1').p = [3, 0, 3]; // bodies walk about; never a difference
  const v = verifyApplied(after, pre, receipt); assert.ok(v.ok, v.problems.join('; ')); assert.equal(v.placed, 3);
  const bad = structuredClone(after); bad.entities.find((e) => e.id === 'e_d').p = [-29, 0, 0];
  assert.deepEqual(verifyApplied(bad, pre, receipt).problems, ['changed e_d stage-drum']);
  receipt.applied = { versions: { e_h: 2, e_c: 2, e_k: 2, e_g: 1, e_l: 1, e_s: 1 }, placed: ['e_g', 'e_l', 'e_s'], roots: ['e_h'] };
  assert.deepEqual(rollbackGuard(after, receipt), []);
  const used = structuredClone(after); used.entities.push(ent('e_cup', 'cup', 'core-cup@1', [0, 0, 0], { in: { parent: 'e_g', slot: 'top' } }));
  used.entities.find((e) => e.id === 'e_c').v = 3;
  assert.deepEqual(rollbackGuard(used, receipt), ['e_c changed since the upgrade (v2 -> v3)', 'e_cup was put into upgraded e_g']);
  const back = world(); back.entities[1].v = 3;
  const r = verifyRolledBack(back, pre, receipt); assert.ok(r.ok); assert.equal(r.sameButVersion, 1);
  back.entities.push(ent('e_s', 'stage-stand', 'eden-stand@1', [-31, 0, 0])); assert.deepEqual(verifyRolledBack(back, pre, receipt).problems, ['left behind e_s stage-stand']);
});

test('rollback restore: written-out defaults are the same meaning; re-seated poses get one strict move back', () => {
  const pre = { entities: [ent('e_a', 'house', 'core-house@1', [1, 3.727, 2], { params: { w: 3 } }), { ...ent('e_b', 'bowl', 'core-bowl@1', undefined, { in: { parent: 'e_a', slot: 'top' } }) }, ent('e_c', 'hall', 'core-hall@1', [5, 0, 5], { params: { w: 1 } })] };
  delete pre.entities[1].p;
  const now = structuredClone(pre);
  now.entities[0].p = [1, 3.165, 2]; now.entities[0].v = 3;                     // ground re-seated it
  Object.assign(now.entities[1], { p: [-0.001, 0, 0], r: 0, s: 1, v: 3 });      // undo wrote a re-seat out
  Object.assign(now.entities[2], { r: 0, s: 1, v: 3, params: { plan: null, w: 1 } }); // cleared param + defaults: same meaning
  assert.equal(canon(now.entities[2]), canon(pre.entities[2]));
  assert.notEqual(canon(now.entities[0]), canon(pre.entities[0]));
  assert.deepEqual(restoreOps(now, pre), [
    { op: 'move', id: 'e_a', in: { parent: 'world' }, p: [1, 3.727, 2], r: 0, s: 1, mode: 'strict' },
    { op: 'move', id: 'e_b', in: { parent: 'e_a', slot: 'top' }, p: [0, 0, 0], r: 0, s: 1, mode: 'strict' }]);
  const changed = structuredClone(now); changed.entities[2].params.w = 2;    // a real param change is never "restored" by a move
  assert.equal(restoreOps(changed, pre).length, 2);
  const v = verifyRolledBack(changed, pre, {}); assert.deepEqual(v.problems, ['differs e_a house', 'differs e_b bowl', 'differs e_c hall']);
  now.entities[0].p = [1, 3.727, 2]; now.entities[1].p = [0, 0, 0];
  const ok = verifyRolledBack(now, pre, {}); assert.ok(ok.ok, ok.problems.join('; ')); assert.equal(ok.sameButVersion, 1); assert.equal(ok.sameMeaning, 2);
});

test('the shipped Eden 2026 spec is the af01d75c -> current template diff', () => {
  const s = JSON.parse(readFileSync(`${root}worlds/patches/eden-2026-upgrade-20261018/spec.json`, 'utf8'));
  assert.equal(s.schema, 'template-upgrade/1'); assert.equal(s.world, 'eden-2026'); assert.equal(s.from, 'af01d75c');
  assert.deepEqual(s.counts, { define: 7, add: 183, remove: 20, change: 76 });
  const cur = JSON.parse(readFileSync(`${root}worlds/templates/eden-2026.json`, 'utf8'));
  const names = new Set(cur.batches.flatMap((b) => b.ops.filter((o) => o.op === 'place').map((o) => o.name)));
  assert.ok(s.items.filter((i) => i.kind === 'add').every((i) => names.has(i.path.split('/').pop())), 'every add is in the current template');
});

test('a def change replaces the thing under the same name in one batch with its new define (E2: the big wheel)', () => {
  const wheel = { schema: 'def/1', name: 'eden-big-wheel', version: 1, form: 'point', make: { kind: 'gen', gen: 'kit/2', args: { r: 13 } } };
  const o = { batches: [{ note: 'a', ops: [{ op: 'place', def: 'core/ferris-wheel@1', name: 'wheel', p: [5, 5] }] }] };
  const n = { batches: [{ note: 'a', ops: [] }, { note: 'b', ops: [{ op: 'define', def: wheel }, { op: 'place', def: 'eden-big-wheel@1', name: 'wheel', p: [5, 5] }] }] };
  const s = makeSpec(o, n, { id: 't', world: 'w', from: 'a', to: 'b' });
  assert.deepEqual(s.counts, { define: 1, add: 0, remove: 0, change: 1 });
  const w = { worldId: 'w-1', seq: 5, defs: [], entities: [ent('e_w', 'wheel', 'core-ferris-wheel@1', [5, 0, 5])] };
  const p = plan(w, s), [b] = batches(p, 'g', 'n');
  assert.deepEqual(b.ops.map((x) => x.op), ['define', 'remove', 'place']);
  assert.equal(b.ops[1].id, 'e_w'); assert.equal(b.ops[2].name, 'wheel'); assert.equal(b.ops[2].def, 'eden-big-wheel@1');
  const after = { ...w, entities: [ent('e_n', 'wheel', 'eden-big-wheel@1', [5, 0, 5])] };
  const v = verifyApplied(after, w, { batches: [b], newOps: s.newOps ?? Object.fromEntries(s.items.filter((i) => i.new).map((i) => [i.path, i.new])) });
  assert.equal(v.ok, true, JSON.stringify(v));
  const again = plan(after, s); assert.equal(again.units.length, 0, 'an upgraded world plans nothing');
});
