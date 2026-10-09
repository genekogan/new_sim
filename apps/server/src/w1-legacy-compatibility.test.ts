import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import type {EdgeLedger} from './edge/ledger/ledger.ts';
import type {EdgeCapability} from './edge/contract.ts';
import {knownBootPlaces,explicitPlaceCapability,offeredWalkObject,resolvePlaceForVerb} from './edge/boot/world-places.ts';
test('W1 compatibility diagnostics use actual offered fire and park destinations',async t=>{
 const w=await edenNavWorld(2,{nav:false});t.after(()=>{w.f.host.stop();w.f.db.close();});const a=w.souls[0];
 const caps=w.ledger.capabilities(a).filter(c=>c.verb==='walk'&&/fire|park|pond/i.test(c.id+' '+c.label));
 t.diagnostic(JSON.stringify({caps,known:knownBootPlaces(w.ledger).filter(p=>/fire/.test(p.id)),regions:Object.keys(w.engine.world.regions).filter(id=>/fire/.test(id))}));assert.ok(caps.length>0);
 const exact=w.ledger.intents.dryRun(a,{verb:'go',target:{place:'walk:social-eden-fire-circle'}}) as any;assert.equal(exact.ok,true,JSON.stringify(exact));assert.equal(exact.would.capability,'walk:social-eden-fire-circle');
 const fire=w.ledger.intents.dryRun(a,{verb:'go',target:{place:'the fire'}}) as any;assert.equal(fire.ok,true,JSON.stringify(fire));assert.equal(fire.would.capability,'walk:social-eden-fire');assert.equal(fire.would.chosen.kind,'object');
});

const soul={soulId:'s_test',entityId:'h_test',name:'Test',owner:'fixture'};
function mock(places:{id:string;name:string;level:number}[],caps:EdgeCapability[],levels:Record<string,number>={}){return {places:{byId:new Map(places.map(p=>[p.id,p]))},coreA:{binds:()=>({caps})},host:{minds:new Map(),engine:{world:{regions:Object.fromEntries(places.map(p=>[p.id,{level:levels[p.id]??p.level}])),entities:{}}}},spots:{spots:[]},together:{publicItems:()=>[]}} as unknown as EdgeLedger;}
test('offered object labels refuse ambiguity and unavailable destinations; exact offered IDs and idlike authored names remain intact',()=>{
 const fire={id:'walk:fire-id',verb:'walk',label:'Fire',target:{kind:'object' as const,id:'fire-id'},available:true};
 const other={...fire,id:'walk:other-fire',target:{kind:'object' as const,id:'other-fire'}};
 const ambiguous=offeredWalkObject(mock([], [fire,other]),soul,'the fire');assert.equal(ambiguous?.ok,false);if(ambiguous&&!ambiguous.ok)assert.equal(ambiguous.code,'place.ambiguous');
 const collision=offeredWalkObject(mock([{id:'room',name:'Fire',level:0}],[fire]),soul,'Fire');assert.equal(collision?.ok,false);
 const blocked=offeredWalkObject(mock([],[{...fire,available:false,blocked:{code:'route.no-route',reason:'No route'}}]),soul,'Fire');assert.equal(blocked?.ok,false);if(blocked&&!blocked.ok)assert.equal(blocked.code,'route.no-route');
 assert.equal(explicitPlaceCapability(mock([],[fire]),soul,fire.id),null);
 const L=mock([{id:'native-room',name:'quiet-room',level:0}],[{id:'walk:native-room',verb:'walk',label:'quiet-room',target:{id:'native-room',kind:'place'},available:true}]);const named=explicitPlaceCapability(L,soul,'walk:quiet-room');assert.equal(named?.ok,true);if(named?.ok)assert.equal(named.chosen.place,'native-room');
 const unknown=explicitPlaceCapability(L,soul,'walk:invented-room');assert.equal(unknown?.ok,false);if(unknown&&!unknown.ok)assert.match(unknown.reason,/not an id in this world/);
});
test('finite legacy destination aliases preserve native floor and capability admission instead of choosing scenery',()=>{
 const L=mock([{id:'region-park',name:'Park with pond',level:0},{id:'upper',name:'Upper room',level:1}],[{id:'walk:region-park',verb:'walk',label:'Park',target:{id:'region-park',kind:'place'},available:true},{id:'walk:upper',verb:'walk',label:'Upper',target:{id:'upper',kind:'place'},available:true}],{upper:0});
 const park=resolvePlaceForVerb(L,soul,'the park');assert.equal(park.ok,true);if(park.ok)assert.equal(park.chosen.place,'region-park');
 const upper=resolvePlaceForVerb(L,soul,'Upper room');assert.equal(upper.ok,false);if(!upper.ok)assert.equal(upper.code,'place.unsupported-floor');
});
