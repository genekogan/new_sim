import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerChunk } from './hub.ts';

test('live viewers get takes without the static entity physics; the recorded chunk is untouched', () => {
  const chunk = { fromTick: 0, toTick: 20, take: { startTick: 0, ticks: 20, finalState: { tick: 20, entities: { a: { p: [1, 0, 2] } }, entityPhysicsV1: { version: 1, hash: 'h', byEntity: { house: { solids: [1, 2, 3] } } } } } };
  const live = viewerChunk(chunk);
  assert.equal('entityPhysicsV1' in live.take.finalState, false);
  assert.deepEqual(live.take.finalState.entities, chunk.take.finalState.entities);
  assert.equal(live.fromTick, 0); assert.equal(live.take.ticks, 20);
  assert.ok(chunk.take.finalState.entityPhysicsV1, 'the recorded chunk keeps its physics');
  const plain = { fromTick: 0, toTick: 20, take: { finalState: { tick: 20 } } };
  assert.equal(viewerChunk(plain), plain, 'worlds without built physics are sent as they were');
});

test('slim viewer carries only tracked loads grip geometry and no static catalog',()=>{
 const handling={carryCrew:[1,1],hands:2,carryHeight:.95,carryPose:'edge',grips:{1:[{id:'grip',local:[0,.2,.2],span:[.4,0,0]}]}};
 const chunk={take:{tracks:{body:[],load:[]},finalState:{entities:{body:{def:'human'},load:{def:'opted-load'},distant:{def:'irrelevant-load'}},entityPhysicsV1:{assets:{'opted-load':{capabilities:{fixtureCarry:{handling}}},'irrelevant-load':{capabilities:{fixtureCarry:{handling}}},hugeStatic:{geometry:'x'.repeat(100000)}}}}}};
 const live=viewerChunk(chunk) as any;assert.deepEqual(live.take.fixtureCarryHandlingV1,{'opted-load':handling});assert.equal(live.take.finalState.entityPhysicsV1,undefined);assert.ok(JSON.stringify(live).length<1000);assert.ok(chunk.take.finalState.entityPhysicsV1.assets.hugeStatic);
});
