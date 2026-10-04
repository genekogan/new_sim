import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soulLifecycleSchema, ownerLifecycleListSchema, lifecycleRequestIdSchema, lifecycleCursorSchema } from './lifecycle.ts';
const pending={contract:'soul-lifecycle/1',worldId:'world',requestId:'lc_'+'a'.repeat(32),soulId:'s_A',entityId:'h_A',name:'Alice',operation:'create',state:'pending',revision:1,requestedAt:1,fact:null,ready:false,reason:'reconciling',allocation:{countsTowardLimit:true,reservesName:true}};
test('strict G005 codec accepts only consistent lifecycle facts/readiness/allocation',()=>{
  assert.deepEqual(soulLifecycleSchema.parse(pending),pending);
  for(const ready of [true,false])assert.ok(soulLifecycleSchema.safeParse({...pending,state:'admitted',ready,reason:ready?null:'reconciling',fact:{seq:1,tick:0}}).success);
  const historical={...pending,state:'admitted',reason:'retirement-accepted',fact:{seq:1,tick:0},allocation:{countsTowardLimit:false,reservesName:false}};
  assert.ok(soulLifecycleSchema.safeParse(historical).success);
  for(const change of [{ready:true},{state:'pending'},{fact:null},{allocation:{countsTowardLimit:true,reservesName:true}}])assert.equal(soulLifecycleSchema.safeParse({...historical,...change}).success,false);
  assert.ok(soulLifecycleSchema.safeParse({...pending,state:'refused',reason:'arrival-unavailable',allocation:{countsTowardLimit:false,reservesName:false}}).success);
  for(const state of ['retiring','retired'])assert.ok(soulLifecycleSchema.safeParse({...pending,operation:'retire',state,reason:state==='retiring'?'removal-pending':null,fact:state==='retired'?{seq:2,tick:30}:null,allocation:{countsTowardLimit:false,reservesName:false}}).success);
  for(const change of [{ready:true},{fact:{seq:1,tick:0}},{state:'retiring'},{reason:null},{allocation:{countsTowardLimit:false,reservesName:true}},{revision:0},{requestedAt:Infinity},{owner:'private'},{requestId:'caller-key'}])assert.equal(soulLifecycleSchema.safeParse({...pending,...change}).success,false);
});
test('private page bounds reject mixed worlds, duplicate identities and unbounded cursor grammars',()=>{
  const page={contract:'owner-lifecycle-list/1',worldId:'world',requests:[pending],nextCursor:null};assert.ok(ownerLifecycleListSchema.safeParse(page).success);
  for(const requests of [[pending,pending],[{...pending,worldId:'elsewhere'}],Array.from({length:21},(_,i)=>({...pending,requestId:'lc_'+i.toString(16).padStart(32,'0')}))])assert.equal(ownerLifecycleListSchema.safeParse({...page,requests}).success,false);
  assert.equal(lifecycleRequestIdSchema.safeParse('lc_'+'A'.repeat(32)).success,false);assert.equal(lifecycleCursorSchema.safeParse('lc1_'+pending.requestId).success,true);
  assert.equal(lifecycleCursorSchema.safeParse('lc1_'+'x'.repeat(512)).success,false);
});
