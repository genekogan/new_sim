import test from'node:test';import assert from'node:assert/strict';
import{destinationBinding,assertDestinationBindings,destinationChoiceMatches}from'./destination-choice.mjs';
const snapshot={defs:[{ref:'pier@1',hash:'definition-hash'}],entities:[{id:'pier-entity',name:'west-pier',def:'pier@1',in:{parent:'world'},shape:{path:[[10,139],[10,167]]},params:{width:3},p:[0,0,0]}]};
const choice={binding:destinationBinding(snapshot,'west-pier'),receipt:{verb:'walk',capabilities:['walk:west-pier','walk:g-west-pier']}};
const scenario=c=>({director:{script:[{expect:{journey:{firstDestinationChoices:[c]}}}]}});
test('explicit destination credit binds exact physical entity, definition and geometry; stale bindings fail closed',()=>{
 assert.doesNotThrow(()=>assertDestinationBindings(scenario(choice),snapshot));
 for(const mutate of[s=>s.entities[0].p[0]=1,s=>s.entities[0].shape.path[1][1]=168,s=>s.entities[0].id='other',s=>s.defs[0].hash='new-def',s=>s.entities[0].name='other-pier']){const s=structuredClone(snapshot);mutate(s);assert.throws(()=>assertDestinationBindings(scenario(choice),s));}
 assert.throws(()=>assertDestinationBindings(scenario({...choice,receipt:{verb:'walk',capabilities:['walk:harbour']}}),snapshot));
});
test('canonical legacy receipt is eligible but mismatched chosen targets, harbour or other pier cannot count',()=>{
 assert.equal(destinationChoiceMatches({capability:'walk:west-pier'},choice),true);
 assert.equal(destinationChoiceMatches({capability:'walk:g-west-pier',chosen:{target:'g-west-pier',place:'g-west-pier'}},choice),true);
 for(const r of[{capability:'walk:harbour'},{capability:'walk:east-pier'},{capability:'sit:west-pier'},{capability:'walk:west-pier',chosen:{target:'g-east-pier'}},{capability:'walk:west-pier',chosen:{}},{capability:'walk:west-pier',chosen:{target:'g-west-pier',place:'g-harbour'}}])assert.equal(destinationChoiceMatches(r,choice),false);
});

test('genesis destination bindings survive new generated IDs but reject physical drift and unreviewed rooms',async()=>{
 const binding=destinationBinding(snapshot,'west-pier',{portable:true,room:'hall'}),c={binding,receipt:{verb:'walk',capabilities:['walk:west-pier/hall','walk:g-west-pier.hall']}};
 const changed=structuredClone(snapshot);changed.entities[0].id='fresh-seed-id';assert.doesNotThrow(()=>assertDestinationBindings(scenario(c),changed));
 for(const mutate of[s=>s.entities[0].p[1]=1,s=>s.entities[0].shape.path[0][0]=11,s=>s.defs[0].hash='different',s=>s.entities[0].in.parent='other']){const bad=structuredClone(changed);mutate(bad);assert.throws(()=>assertDestinationBindings(scenario(c),bad));}
 assert.throws(()=>assertDestinationBindings(scenario({...c,binding:{...binding,room:'wrong-room'}}),changed));
 assert.throws(()=>assertDestinationBindings(scenario({...c,receipt:{verb:'walk',capabilities:['walk:west-pier/wrong-room']}}),changed));
 const {bindJourneyFixtures}=await import('../arena/fixture-bindings.mjs');assert.doesNotThrow(()=>bindJourneyFixtures(scenario(c),changed));changed.entities[0].p[0]=99;assert.throws(()=>bindJourneyFixtures(scenario(c),changed),'actual fresh boot rejects before seat provisioning');
});
