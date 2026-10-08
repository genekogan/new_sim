import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory} from './retained-shore-engine.ts';
test('detached cancellation is shared within one pure feasibility batch, invalidated by native state, cleared on exception and absent from replay',async()=>{
 const f=await retainedCommonsShoreFactory(),e=f.create(f.genesis('feasibility-read')),transition=e.previewRetainedCommonsShoreV1!();assert.ok(transition.ok);if(!transition.ok)return;e.adoptRetainedCommonsShoreV1!(transition.transition);e.spawnHuman({id:'h',label:'Hypothetical native feasibility actor',soul:'fixture'});assert.ok(e.perform({actor:'h',label:'long supported native movement',steps:[{verb:'walk_to',params:{to:'shore-water'}}]}).ok);e.step();
 const native=e as any,physical=native.physical,restore=physical.restore.bind(physical);let copies=0;physical.restore=(s:any)=>{copies++;return restore(s);};
 const probe={actor:'h',label:'read only replacement',steps:[{verb:'rest',params:{seconds:2}}]},hash=e.stateHash(),single=e.canPerform(probe);copies=0;
 e.withFeasibilityRead!(()=>{for(let i=0;i<8;i++)assert.deepEqual(e.canPerform(probe),single);});assert.equal(copies,1);assert.equal(e.stateHash(),hash);assert.equal(native.feasibilityRead,undefined);
 copies=0;e.withFeasibilityRead!(()=>{e.canPerform(probe);e.withFeasibilityRead!(()=>{e.canPerform(probe);});e.canPerform(probe);});assert.equal(copies,1,'nested synchronous reads share the same exact-state cancellation probe');assert.equal(native.feasibilityRead,undefined);
 copies=0;e.withFeasibilityRead!(()=>{e.canPerform(probe);e.step();e.canPerform(probe);});assert.equal(copies,2,'canonical native tick prevents reuse');assert.equal(native.feasibilityRead,undefined);
 copies=0;e.withFeasibilityRead!(()=>{e.canPerform(probe);native.rt.mark('fixture cache invalidation');e.canPerform(probe);});assert.equal(copies,2,'same-tick native event prevents reuse');
 copies=0;e.withFeasibilityRead!(()=>{e.canPerform(probe);e.world.entities.h.pose.yaw+=.1;e.withFeasibilityRead!(()=>e.canPerform(probe));});assert.equal(copies,2,'same-tick direct canonical state change invalidates nested reuse');
 copies=0;const deferred=e.withFeasibilityRead!(()=>{e.canPerform(probe);return Promise.resolve().then(()=>e.canPerform(probe));});assert.equal(native.feasibilityRead,undefined,'cache closes before an async continuation');await deferred;assert.equal(copies,2,'no cache crosses an await boundary');
 assert.throws(()=>e.withFeasibilityRead!(()=>{e.canPerform(probe);throw Error('fixture callback failed');}),/callback failed/);copies=0;e.canPerform(probe);assert.equal(copies,1,'unscoped subsequent query does not reuse failed batch');assert.equal(native.feasibilityRead,undefined);
 const snapshot=e.snapshot();assert.equal('feasibilityRead' in snapshot,false);assert.equal(f.restore(snapshot).stateHash(),e.stateHash());
});
