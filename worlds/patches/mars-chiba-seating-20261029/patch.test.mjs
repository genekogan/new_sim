import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {layout, changedSeats, makePatch, integrateTemplate, templateBatch} from './patch.mjs';

function snapshot() {
  return {contract: 'world/1', worldId: 'isolated-chiba', seq: 14,
    defs: [layout.source, ...layout.seats].map(s => ({ref: s.ref, hash: s.hash})),
    entities: [layout.source, ...layout.seats].map((s, i) => ({id: `e_seating${i}`, name: s.name, def: `sha:${s.hash}`,
      in: {parent: 'world'}, p: structuredClone(s.before ?? s.p), r: s.r, v: 3})),
  };
}
const vacant = Object.fromEntries(changedSeats.map(s => [s.name, true]));

test('repair preserves identities and definitions; guarded inverse restores only the three changed poses', () => {
  const s = snapshot(), p = makePatch(s, {vacant});
  assert.deepEqual(p.batch.ops.map(o => o.id), ['e_seating1', 'e_seating2', 'e_seating4']);
  assert(p.batch.ops.every(o => o.op === 'move'));
  assert.equal(Object.keys(p.batch.expect).length, 6, 'unchanged family and Chiba source are also guarded');
  for (const o of p.batch.ops) {
    const before = s.entities.find(e => e.id === o.id), inverse = p.rollback.ops.find(x => x.id === o.id);
    assert.deepEqual(inverse.p, before.p);
    assert.equal(p.rollback.expect[o.id].v, before.v + 1);
    assert.equal(p.batch.expect[o.id].v, before.v);
  }
  assert.notEqual(makePatch(s, {vacant}).batch.group, p.batch.group);
  assert.match(p.undo.path, /^\/v1\/god\/undo\?group=mars-chiba-seating-20261029-/);
});

test('moved source, changed definition, ambiguous names and missing native vacancy proof refuse', () => {
  assert.throws(() => makePatch(snapshot()), /vacancy proof/);
  const pose = snapshot(); pose.entities[0].r += .1;
  assert.throws(() => makePatch(pose, {vacant}), /source pose changed/);
  const d = snapshot(); d.defs[2].hash = 'bad';
  assert.throws(() => makePatch(d, {vacant}), /definition changed/);
  const names = snapshot(); names.entities.push({...names.entities[1], id: 'e_duplicate'});
  assert.throws(() => makePatch(names, {vacant}), /one root-level tier required/);
  const occupied = {...vacant, 'tier-2': false};
  assert.throws(() => makePatch(snapshot(), {vacant: occupied}), /vacancy proof required for tier-2/);
  assert.throws(() => makePatch(snapshot(), {vacant, group: 'unrelated'}), /unique patch group/);
});

test('fully materialized template accepts one final batch and refuses changed source or later overriding edits', () => {
  const t = JSON.parse(readFileSync(new URL('../../templates/mars-two.json', import.meta.url), 'utf8'));
  t.batches = t.batches.filter(b => b.group !== layout.id);
  const before = structuredClone(t.batches);
  assert.equal(integrateTemplate(t), true);
  assert.deepEqual(t.batches.slice(0, -1), before);
  assert.deepEqual(t.batches.at(-1), templateBatch());
  assert.equal(integrateTemplate(t), false);
  t.batches.push({group: 'later', ops: []});
  assert.throws(() => integrateTemplate(t), /final batch/);
  const bad = {batches: structuredClone(before)};
  bad.batches.push({ops: [{op: 'move', id: 'tier-2', p: [0, 0, 0], r: -1.431}]});
  assert.throws(() => integrateTemplate(bad), /tier-2 final source template pose changed/);
});
