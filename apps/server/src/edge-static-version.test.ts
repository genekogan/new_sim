// L3 item 2 (2026-10-31): together's item sources were cached on counts (regions, places, nav solids/ground), so a
// god moving a shelf or renaming a place (same counts) kept the old source. They now key on the ledger's static
// version (place-index writes, a new spots object, the navigation epoch), which a moving body never changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import type {SpotsData} from './edge/ledger/activities.ts';

test('item sources follow a moved shelf and a renamed place; the static version ignores ticks', {timeout: 60000}, async t => {
  const f = fixture(':memory:'); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false});
  t.after(() => {f.host.stop(); f.db.close();});
  const spots = (at: [number, number]): SpotsData => ({contract: 'activity-spots/1', spots: [], shelves: [{id: 'shelf-x', at}], interiors: [], solids: [], rings: [], platforms: []});
  let data = spots([1, 1]);
  edge.spotsProvider = () => data;
  const shelf = () => edge.together.sources().find(s => s.id === 'shelf:shelf-x')?.at;
  assert.deepEqual(shelf(), [1, 1]);
  const v0 = edge.staticVersion();
  for (let i = 0; i < 5; i++) f.host.tickOnce();
  assert.equal(edge.staticVersion(), v0, 'ticks alone leave the static version');
  data = spots([5, 5]);   // same counts, new spots object
  assert.deepEqual(shelf(), [5, 5], 'a moved shelf is a new source');
  const root = [...edge.places.byId.values()][0]!;
  const v1 = edge.staticVersion();
  edge.places.add({...root, name: root.name + ' renamed'});
  assert.notEqual(edge.staticVersion(), v1, 'a place write moves the static version');
  edge.bumpStatic(); assert.notEqual(edge.staticVersion(), v1);
});
