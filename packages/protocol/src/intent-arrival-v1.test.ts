import test from 'node:test';
import assert from 'node:assert/strict';
import {intentArrivalPayloadV1Schema,intentArrivalFactV1} from './intent-arrival-v1.ts';
import {publicEvent,type LogEvent} from './index.ts';
const hash='a'.repeat(64),payload={contract:'private-intent-arrival/1',worldId:'w',soulId:'s_A',ownerId:'dev:alice',entityId:'h_A',intent:{intentId:'private-purpose',version:1},attemptId:'a_1',activityId:'p1',admissionSeq:2,admissionHash:hash,decisionSeq:1,decisionHash:hash,controllerStartSeq:3,controllerStartHash:hash,play:{seq:4,tick:10,hash,card:'go to',target:'bench'},navigation:{id:'act1',verb:'walk_to',status:'completed',endedTick:9,requestedGoal:{x:1.073,z:3.537,level:0},goal:{x:1.05,z:3.75,level:0}},observation:{tick:10,position:[1.05,0,3.75],level:0,rulesVersion:'rules/1'}};
test('arrival contract distinguishes requested and controller endpoints, enforces exact original sources and redacts private association',()=>{
  assert.ok(intentArrivalPayloadV1Schema.safeParse(payload).success);
  for(const change of [{controllerStartSeq:4},{observation:{...payload.observation,tick:11}},{navigation:{...payload.navigation,endedTick:11}},{observation:{...payload.observation,position:[5,0,3.75]}},{op:'fulfilled'},{ownerId:'not an id'}])assert.equal(intentArrivalPayloadV1Schema.safeParse({...payload,...change}).success,false);
  const e:LogEvent={seq:5,tick:10,kind:'intent-arrival-v1',author:'world:intent-arrival',at:1,payload};assert.equal(intentArrivalFactV1(e).seq,5);assert.throws(()=>intentArrivalFactV1({...e,seq:6}));assert.throws(()=>intentArrivalFactV1({...e,author:'soul:s_A'}));assert.deepEqual(publicEvent(e).payload,{worldId:'w',soulId:'s_A',privateUpdate:true});assert.ok(!JSON.stringify(publicEvent(e)).includes('private-purpose'));assert.ok(!JSON.stringify(publicEvent(e)).includes('dev:alice'));
});
