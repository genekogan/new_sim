// Lane WALK: the walkability gate's merge / compare rules (walk/walk.mjs), on synthetic shard parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, describe, merge, WORLDS } from './walk/walk.mjs';
import { existsSync, readFileSync } from 'node:fs';

const part = (k, n, o = {}) => ({ schemaVersion: 1, version: 1, name: 'w', worldId: 'w-1', shard: [k, n], dests: 10, roots: k ? 0 : 5, bad: [], goalless: [], floats: [], ms: {}, ...o });
const base = merge('w', [
  part(0, 2, { bad: [['nav.disconnected', 'walk:house-1/kitchen', 'house-1']], floats: [['pond-lily', 0.6, 'pond-lily']] }),
  part(1, 2, { bad: [['nav.one-way', 'seat:e_1#seat', 'house-2']], goalless: [['house-3/attic', 'house-3']] }),
]);

test('walk: merged shards count per place and in total', () => {
  assert.deepEqual(base.totals, { dests: 20, bad: 2, disconnected: 1, oneWay: 1, noRoom: 0, goalless: 1, roots: 5, floats: 1 });
  assert.deepEqual(base.places, { 'house-1': { bad: 1 }, 'house-2': { bad: 1, oneWay: 1 }, 'house-3': { goalless: 1 }, 'pond-lily': { float: 1 } });
  assert.throws(() => merge('w', [part(0, 2)]), /incomplete/);
  assert.throws(() => merge('w', [part(0, 2), part(0, 2)]), /incomplete/);
});

test('walk: the same findings pass; fewer pass and are reported as better', () => {
  assert.equal(compare(base, base).ok, true);
  const fewer = merge('w', [part(0, 1, { floats: [['pond-lily', 0.6, 'pond-lily']] })]);
  const c = compare(base, fewer);
  assert.equal(c.ok, true);
  assert.equal(c.improved.length, 4);
  assert.match(describe('w', c), /better in 4/);
});

test('walk: any place worse fails with the new items, even when the world total is unchanged', () => {
  // house-1 fixed, house-4 broken: same total, a different place
  const moved = merge('w', [part(0, 1, { bad: [['nav.disconnected', 'walk:house-4', 'house-4'], ['nav.one-way', 'seat:e_1#seat', 'house-2']], goalless: [['house-3/attic', 'house-3']], floats: [['pond-lily', 0.6, 'pond-lily']] })]);
  const c = compare(base, moved);
  assert.equal(c.ok, false);
  assert.deepEqual(c.regressions.map(r => [r.place, r.metric, r.was, r.now, r.added]), [['house-4', 'bad', 0, 1, ['nav.disconnected walk:house-4']]]);
  assert.match(describe('w', c), /WORSE house-4 bad 0 -> 1: nav.disconnected walk:house-4/);
});

test('walk: a new one-way, a new goalless thing, a new float and a float that rose each fail', () => {
  const worse = merge('w', [
    part(0, 1, {
      bad: [['nav.one-way', 'walk:house-1/kitchen', 'house-1'], ['nav.one-way', 'seat:e_1#seat', 'house-2']],
      goalless: [['house-3/attic', 'house-3'], ['house-3/cellar', 'house-3']],
      floats: [['mountain-station', 6.6, 'mountain-station'], ['pond-lily', 1.2, 'pond-lily']],
    }),
  ]);
  const got = compare(base, worse).regressions.map(r => `${r.place} ${r.metric} ${r.was}->${r.now}`);
  assert.deepEqual(got, ['house-1 oneWay 0->1', 'house-3 goalless 1->2', 'mountain-station float 0->1', 'pond-lily float-rise 0.6->1.2']);
});

test('walk: every gated world has a checked-in baseline and fixture', () => {
  for (const w of WORLDS) {
    const b = JSON.parse(readFileSync(new URL(`./walk/baseline/${w.name}.json`, import.meta.url), 'utf8'));
    assert.equal(b.name, w.name); assert.ok(b.totals.dests > 0);
    if (w.db) assert.ok(existsSync(new URL(`./walk/${w.db}`, import.meta.url)), w.db);
  }
});
