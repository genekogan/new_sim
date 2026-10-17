import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownLiveChunk} from '../src/owned-live-chunks.ts';
// Eden 2026 (3.5k entities, 244 furnished buildings): each take's finalState carried ~290k nodes of static physics, past
// the old 200k cap, so every live chunk was silently dropped and the viewer never drew a first frame.
const fixture=()=>({fromTick:0,toTick:20,take:{schema:'mars-take/4',id:'t0',baselineStateHash:'start',finalStateHash:'end',rulesVersion:'test/1',keyframeEvery:5,startTick:0,ticks:20,dt:.05,tracks:{a:[[0,0,0,0,0],[20,2000,0,0,0]]},changes:[[0,'a','present',true]],events:[],entities0:{a:{body:null}},finalState:{entities:{a:{body:null}}}}}) as any;
test('a built world: static physics past the old 200k-node cap still yields an owned live chunk, without the physics',()=>{
 const raw=fixture(),walls=Array.from({length:30000},(_,i)=>({id:'w'+i,obb:{c:[i,0],half:[1,.1],yaw:0},y0:0,y1:3}));
 raw.take.finalState.entityPhysicsV1={version:1,hash:'h',byEntity:{house:{solids:walls}}};
 const owned=ownLiveChunk(raw) as any;assert.ok(owned,'an Eden 2026 sized chunk is drawn');
 assert.equal('entityPhysicsV1' in owned.take.finalState,false);assert.deepEqual(owned.take.finalState.entities,{a:{body:null}});
 assert.ok(Object.isFrozen(owned.take.finalState));assert.ok(raw.take.finalState.entityPhysicsV1,'caller input untouched');
});
test('accessors and non-plain data are still refused around the physics',()=>{
 const getter=fixture();Object.defineProperty(getter.take.finalState,'entityPhysicsV1',{get:()=>({}),enumerable:true});
 assert.equal(ownLiveChunk(getter),null);
 const nan=fixture();nan.take.finalState.entityPhysicsV1={x:1};nan.take.finalState.entities.a.p=NaN;assert.equal(ownLiveChunk(nan),null);
});
