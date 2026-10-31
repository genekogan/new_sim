import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import type {PlaceData} from './edge/ledger/places.ts';
import {routeFrame} from './edge/perception/route.ts';

test('native location queries distinguish a current subplace from its containing field without changing the field walk', async t => {
  const f = fixture(':memory:', undefined, {durableClockV1: true}); f.brain.quiesce();
  let edge: EdgeLedger | undefined;
  t.after(() => {f.brain.quiesce(); f.host.stop(); edge?.comms?.close(); f.db.close();});
  await invite(f, 'ancestor-reader');
  const row = await accept(f.host, f.souls.create('dev:ancestor-reader', {name: 'Ancestor Reader', description: 'native place ancestry regression'}));
  const soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  const body = f.host.engine.world.entities[soul.entityId], [x, , z] = body.pose.p;
  const box = (cx: number, cz: number, r: number): [number, number][] => [[cx-r,cz-r],[cx+r,cz-r],[cx+r,cz+r],[cx-r,cz+r]];
  const data: PlaceData = {contract: 'place-data/1', world: f.host.worldId, places: [
    {id: 'world', name: 'World', kind: 'outdoor', parent: null, polygon: box(0, 0, 100), level: 0, enclosed: false, capacity: null, starting: true},
    {id: 'field', name: 'Green field', kind: 'walkable', parent: 'world', polygon: box(0, 0, 30), level: 0, enclosed: false, capacity: null, starting: true},
    {id: 'study-court', name: 'Study Court', kind: 'outdoor', parent: 'field', polygon: box(x, z, .25), level: 0, enclosed: false, capacity: null, starting: true},
  ]};
  edge = new EdgeLedger(f.host, f.db, data);
  assert.equal(edge.placePathOf(soul.soulId)[0].id, 'study-court');
  const pose = JSON.stringify(body.pose);
  const broad = routeFrame(edge, soul, 'Green field');
  assert.equal(broad.found, true); if (!('place' in broad)) return;
  assert.equal(broad.place.id, 'field');
  assert.deepEqual(broad.currentPlace, {id: 'study-court', name: 'Study Court'});
  assert.equal(broad.within, true, 'being in a child still means within the broad field');
  assert.equal('here' in broad ? broad.here : undefined, undefined, 'ancestor containment is not an unqualified arrival');
  assert.ok('walk' in broad);
  assert.equal(broad.walk, 'walk:field');
  assert.match(broad.say, /in Study Court, within Green field/);
  assert.doesNotMatch(broad.say, /You are at Green field now/);
  const current = routeFrame(edge, soul, 'Study Court');
  assert.equal(current.found, true); if (!('place' in current)) return;
  assert.equal('here' in current && current.here, true);
  assert.equal(current.within, true);
  assert.equal(current.say, 'You are at Study Court now.');
  assert.equal(JSON.stringify(body.pose), pose, 'perception must not move the native body');
  const result = await accept(f.host, edge.act(soul, {capability: broad.walk}));
  assert.equal(result.accepted, true, JSON.stringify(result)); if (!result.accepted) return;
  assert.equal((result.receipt.chosen as {place?: string}).place, 'field');
  for (let i = 0; i < 600 && edge.receipt(soul.soulId, result.receipt.id)?.phase !== 'completed'; i++) {
    f.host.tickOnce(); if (i % 10 === 0) {await setImmediate(); f.host.drainInputs();}
  }
  assert.equal(edge.receipt(soul.soulId, result.receipt.id)?.phase, 'completed');
  assert.deepEqual(f.host.engine.runtime.violations, []);
});
