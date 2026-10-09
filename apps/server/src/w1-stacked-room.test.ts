import assert from 'node:assert/strict';
import test from 'node:test';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {fixtureSlots} from '../../../mars/viewer/engine/social/slots.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';

test('W1 room selection never substitutes a downstairs seat for an unadmitted stacked upper room', {timeout:90000},async t=>{
 const w=await coreAWorld(1);t.after(()=>w.close());const soul=w.souls[0],lower=w.ledger.places.byId.get('eden-classroom-1')!;
 const upper={...structuredClone(lower),id:'test-upper-room',name:'Stacked upper room',level:1};w.ledger.places.byId.set(upper.id,upper);
 const before={events:w.f.db.events(w.f.host.worldId).length,receipts:Number((w.f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as {n:number}).n)};
 const out=w.ledger.intents.dryRun(soul,{verb:'sit',target:{in:upper.name,row:'front'}}) as {ok:boolean;code?:string;would?:{chosen:{place:string;seat:string}}};
 const chosen=out.would?.chosen,entity=chosen?((w.f.host.kernel.things[chosen.seat]?.traits.entity as string|undefined)??chosen.seat):null;
 const fixture=entity?w.engine.world.entities[entity]:null,slots=fixture?fixtureSlots((w.engine as unknown as {rt:Runtime}).rt,fixture):[];
 console.log('W1_STACKED_ROOM_PROOF '+JSON.stringify({requested:{place:upper.id,level:upper.level},resolution:out,actualSlotLevels:slots.filter(s=>s.kind==='seat').map(s=>s.level)}));
 assert.equal(out.ok,false,'a room with only XZ overlap and no admitted upper floor must refuse');assert.equal(out.code,'place.unsupported-floor');
 assert.deepEqual({events:w.f.db.events(w.f.host.worldId).length,receipts:Number((w.f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as {n:number}).n)},before);
 const downstairs=w.ledger.intents.dryRun(soul,{verb:'sit',target:{in:lower.id,row:'front'}}) as {ok:boolean;would?:{chosen:{place:string;seat:string}}};assert.ok(downstairs.ok);assert.equal(downstairs.would!.chosen.place,lower.id);
 const fixtureId=(w.f.host.kernel.things[downstairs.would!.chosen.seat]?.traits.entity as string|undefined)??downstairs.would!.chosen.seat;
 const hash=w.engine.stateHash();assert.deepEqual(w.engine.nativeSeatLevelsV1(fixtureId),[0]);assert.equal(w.engine.stateHash(),hash,'native seat level read leaves the canonical state/hash unchanged');
 // An admitted upper polygon still cannot borrow a lower-floor seat.
 (w.engine.world.regions as any)[upper.id]={id:upper.id,label:upper.name,kind:'place',level:1,polygon:structuredClone(upper.polygon),provenance:{origin:'test-fixture',confidence:'hypothetical'}};
 const mismatch=w.ledger.intents.dryRun(soul,{verb:'sit',target:{in:upper.id,row:'front'}});assert.equal(mismatch.ok,false);assert.equal(mismatch.code,'seat.none-in-place');
});
