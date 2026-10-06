import test from 'node:test';
import assert from 'node:assert/strict';
import {humanCompilerOutputV1Schema,humanSteeringOutcomeV1Schema,humanCapabilityRegistryV1Schema} from './human-goals-v1.ts';
test('compiler intentionally selects no-action separately from technical failure; invented actions/cards are outside the closed grammar',()=>{
 const noAction={kind:'no_action',reason:'unsupported_here',explanation:'There is no supported airplane or flight here.'};assert.deepEqual(humanCompilerOutputV1Schema.parse(noAction),noAction);
 assert.equal(humanCompilerOutputV1Schema.safeParse({kind:'plan',registryHash:'0'.repeat(64),goals:[{goal:'fly',bindingId:'invented-airplane'}],explanation:'Fly.'}).success,false);
 assert.equal(humanCompilerOutputV1Schema.safeParse({...noAction,new_cards:[{name:'invented fly'}]}).success,false);
 for(const code of ['budget','provider','key','closed'])assert.equal(humanSteeringOutcomeV1Schema.parse({kind:'system_unavailable',code,explanation:'The system cannot process this request.'}).kind,'system_unavailable');
 assert.equal(humanSteeringOutcomeV1Schema.safeParse({kind:'no_action',reason:'budget',explanation:'Budget unavailable.'}).success,false);
});
test('seated goals and bounded same-goal approximation are distinct from walking and cannot introduce arbitrary parameters',()=>{
 const base={kind:'plan',registryHash:'0'.repeat(64),explanation:'Sit on the available bench.'};const planned=humanCompilerOutputV1Schema.parse({...base,goals:[{goal:'sit',bindingId:'seat:commons-bench-east',seconds:60}]});assert.equal(planned.kind,'plan');
 assert.equal(humanCompilerOutputV1Schema.safeParse({...base,goals:[{goal:'sit',bindingId:'seat:commons-bench-east',seconds:60,verb:'fly'}]}).success,false);
 assert.equal(humanCompilerOutputV1Schema.safeParse({...base,goals:[{goal:'walk',bindingId:'landmark:known-tree'}],adaptation:{originalGoal:'hang_out',substituteBindingId:'landmark:known-tree',explanation:'A different activity.'}}).success,false);
 assert.equal(humanCompilerOutputV1Schema.safeParse({...base,goals:[{goal:'hang_out',bindingId:'landmark:known-tree',seconds:60}],adaptation:{originalGoal:'fly',substituteBindingId:'landmark:known-tree',explanation:'Walk instead.'}}).success,false);
});

test('a sitting capability cannot advertise walking as its seated postcondition',()=>{const registry={contract:'human-capabilities/1',worldId:'fixture-world',soulId:'fixture-soul',entityId:'fixture-body',tick:0,registryHash:'0'.repeat(64),goals:[{id:'sit',description:'Sit on a real bench.',postcondition:'native_navigation_arrival',bindings:[{id:'seat:fixture-bench',targetId:'fixture-bench',label:'Bench',available:true}]}]};assert.equal(humanCapabilityRegistryV1Schema.safeParse(registry).success,false);registry.goals[0].postcondition='native_seated';assert.equal(humanCapabilityRegistryV1Schema.safeParse(registry).success,true);registry.goals[0].bindings[0].available=false;assert.equal(humanCapabilityRegistryV1Schema.safeParse(registry).success,false);});
