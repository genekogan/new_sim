// Stage B (lane srv-source-spot, 2026-10-31): a place's item-source spot must not depend on people. together.ts
// sources() caches each place source's spot from nearestStandableV1(centroid); that read skipped points within 0.8 m of
// anyone standing there, and people are not in the cache key, so the spot (and the nearest source of a kind, and the
// distance sort of pick-up offers) depended on who stood on the centroid when the cache was built — main's answers
// flipped over time and main and the read worker disagreed by ~1 m (B-serve's HTTP compare). Sources now ignore people.
import test from 'node:test';
import assert from 'node:assert/strict';
import {accept, fixture, invite} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import type {EdgeSoul} from './edge/contract.ts';

test('a place source spot is the same with a person standing on its centroid or not; so are the pick-up offers', {timeout: 60000}, async t => {
  const f = fixture(':memory:'); f.brain.quiesce();
  const L = new EdgeLedger(f.host, f.db, undefined, {ambient: false});
  t.after(() => {f.host.stop(); f.db.close();});
  const souls: EdgeSoul[] = [];
  for (const name of ['ana', 'bea']) {
    await invite(f, name);
    const row = await accept(f.host, f.souls.create(`dev:${name}`, {name, description: 'source spot'})) as {id: string; entity_id: string; name: string; owner: string};
    souls.push({soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner});
  }
  const [ana, bea] = souls as [EdgeSoul, EdgeSoul];
  const pos = (s: EdgeSoul): [number, number] => {const p = f.host.engine.world.entities[s.entityId]!.pose.p; return [p[0]!, p[2]!];};
  const eng = f.host.engine as unknown as {nearestStandableV1(at: [number, number], except?: string): [number, number] | null};
  const relocate = async (s: EdgeSoul, near: [number, number]) => {
    const to = eng.nearestStandableV1(near, s.entityId); assert.ok(to, `standing room near ${near}`);
    await accept(f.host, f.host.enqueue('edge-relocate', `edge:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to}));
    assert.ok(Math.hypot(pos(s)[0] - to[0], pos(s)[1] - to[1]) < 0.5, `${s.name} relocated to ${to} (at ${pos(s)})`);
  };
  // Ana stands on open ground at c; a lawn (a frisbee source) and a meadow (frisbee + flower) are centred on c and c + 1 m,
  // so which frisbee source is nearest, and the offer's label, turn on a metre
  const c = pos(ana), sq = (x: number, z: number, h: number): [number, number][] => [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]];
  const root = [...L.places.byId.values()][0]!;
  L.places.add({...root, id: 'test-lawn', name: 'Test lawn', kind: 'lawn', parent: root.id, polygon: sq(c[0], c[1], 4)});
  L.places.add({...root, id: 'test-meadow', name: 'Test meadow', kind: 'meadow', parent: root.id, polygon: sq(c[0] + 1, c[1], 4)});
  await relocate(bea, [c[0] - 15, c[1]]);
  const snap = () => {
    L.bumpStatic();   // a fresh build of the source cache (people are not in its key)
    const src = L.together.sources().filter(s => s.id.startsWith('place:test-')).map(s => `${s.id}/${s.kind}@${s.at.join(',')}`);
    const offers = L.capabilities(bea).filter(x => x.id.startsWith('pick-up:')).map(x => `${x.id} ${x.label}`);
    return {src, offers};
  };
  const on = pos(ana);
  const occupied = snap();
  assert.ok(occupied.src.length >= 3, `the test places are sources (${occupied.src})`);
  assert.ok(occupied.src.some(s => s.startsWith('place:test-lawn/frisbee@')), 'the lawn is a frisbee source');
  assert.ok(Math.hypot(on[0] - c[0], on[1] - c[1]) < 0.8, 'Ana stands on the lawn centroid');
  await relocate(ana, [c[0] + 15, c[1] + 15]);
  assert.ok(Math.hypot(pos(ana)[0] - c[0], pos(ana)[1] - c[1]) > 20, 'Ana moved off the centroid');
  const empty = snap();
  assert.deepEqual(empty.src, occupied.src, 'source spots do not depend on who stands on the centroid');
  assert.deepEqual(empty.offers, occupied.offers, 'pick-up offers (nearest source, label, order) do not either');
});
