import test from 'node:test';
import assert from 'node:assert/strict';
import{materialize,replay}from'./materialize.mjs';
const named=w=>[...w.entities.values()].filter(e=>e.name).map(e=>({ref:w.pathOf(e.id),def:w.resolvedDef(e.def).ref,pose:w.worldPose(e),shape:e.shape})).sort((a,b)=>a.ref.localeCompare(b.ref));
test('patched Mars genesis replays with a different seed without detached-child references or changed poses',()=>{
 const {template,world}=materialize('mars-two');const again=replay(template,{seed:'independent-world'});
 assert.deepEqual(named(again),named(world));assert.ok(again.get('campus-swimming-pond'));
 assert.equal(again.get('presenter-timber-box').p[1],.373);
});
test('Eden cumulative genesis keeps subsequent furniture revisions and supports the actual pier bench',()=>{
 const{world}=materialize('eden-2026');const bench=world.get('harbour-west-pier-bench'),pier=world.get('land-harbour-west-pier');
 assert.equal(bench.p[1],pier.params.at.y);assert.equal(world.slotsOf(bench).filter(s=>s.kind==='seat').length,2);
 assert.ok(world.entities.size>4900);
});
