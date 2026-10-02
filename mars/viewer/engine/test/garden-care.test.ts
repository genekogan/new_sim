import test from 'node:test';
import assert from 'node:assert/strict';
import { gardenCareRuntime, gardenCareParams, GARDEN_PLANTER_ASSET } from '../scenarios/garden-care.ts';
import { CATALOG } from '../world/catalog.ts';
import { readGarden, type GardenEntity } from '../objects/garden.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { hashOf } from '../core/hash.ts';
import { Runtime } from '../runtime/runtime.ts';
import type { ActionDef } from '../actions/types.ts';
import { z } from 'zod';

// Test-local registration until the root-owned catalog integration lands. No existing def changes.
function fixture() {
  CATALOG['garden-planter'] ??= GARDEN_PLANTER_ASSET;
  return gardenCareRuntime();
}
const state = (rt: Runtime, plant = 'plant-a') => {
  const s = readGarden(rt, plant); assert.ok(!('code' in s), JSON.stringify(s)); return s;
};
const conserved = (rt: Runtime) => rt.world.entities['water-bowl'].contents!.fraction + ['plant-a','plant-b'].reduce((n,id) => n + (rt.world.entities[id] as GardenEntity).gardenCare!.waterReceived, 0);
function until(rt: Runtime, done: () => boolean, max = 2400) {
  for (let i = 0; i < max && !done(); i++) { rt.step(); assert.deepEqual(rt.violations, []); assert.equal(conserved(rt), 1); }
  assert.ok(done(), JSON.stringify([...rt.records.values()].filter(r => rt.isActive(r.id))));
}
function steps(rt: Runtime, count: number) { for(let i=0;i<count;i++) rt.step(); }
function clean(rt: Runtime) {
  steps(rt,2); assert.deepEqual(rt.violations, []);
  for (const e of Object.values(rt.world.entities)) assert.deepEqual(rt.holder(`entity:${e.id}`), []);
  assert.deepEqual(rt.holder('actor:carer'), []); assert.deepEqual(rt.holder('hand:carer:right'), []); assert.deepEqual(rt.holder('holds:carer'), []);
  assert.equal([...rt.records.values()].filter(r => rt.isActive(r.id)).length, 0);
  assert.deepEqual(rt.world.entities['water-bowl'].support, { kind:'resting-on', on:'water-table', slot:'r0c2' });
}
function care(rt: Runtime, plant = 'plant-a') {
  const r = rt.submit('garden_care', gardenCareParams(plant)); assert.notEqual(r.status,'failed',r.diagnostic?.message);
  until(rt,()=>!rt.isActive(r.id)); assert.equal(r.status,'completed',r.diagnostic?.message); clean(rt); return r;
}
test('two planters conserve finite water, identity and supported ordinary take/walk/put', () => {
  const rt=fixture(), ids=Object.keys(rt.world.entities).sort(); care(rt); care(rt,'plant-b');
  assert.equal(state(rt).cycles,1); assert.equal(state(rt,'plant-b').cycles,1); assert.equal(rt.world.entities['water-bowl'].contents!.fraction,.5);
  assert.deepEqual(Object.keys(rt.world.entities).sort(),ids);
  assert.ok([...rt.records.values()].some(r=>r.verb==='take_item'&&r.status==='completed'));
  assert.ok([...rt.records.values()].some(r=>r.verb==='put_item'&&r.status==='completed'));
});
for (const phase of ['taking','walking','reaching','watering','putting']) test(`Pause in ${phase} drains safely and retains exact partial care`, () => {
  const rt=fixture(), r=rt.submit('garden_care',gardenCareParams());
  until(rt,()=> r.phase===phase && (phase!=='watering'||(state(rt).pending?.delivered??0)>0));
  const before=structuredClone(state(rt)), water=rt.world.entities['water-bowl'].contents!.fraction;
  rt.cancel(r.id); until(rt,()=>!rt.isActive(r.id)); assert.equal(r.status,'cancelled'); clean(rt);
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction,water);
  assert.equal(state(rt).waterReceived,before.waterReceived);
  if (before.pending) { assert.equal(state(rt).pending?.purpose,before.pending.purpose); care(rt); assert.equal(state(rt).cycles,1); }
  else assert.equal(state(rt).cycles,1);
});
test('director handoff returns bowl before independent walk; explicit retry keeps the purpose', () => {
  const rt=fixture(), r=rt.submit('garden_care',gardenCareParams());
  until(rt,()=> (state(rt).pending?.delivered??0)>0); const purpose=state(rt).pending!.purpose;
  const direction=rt.submit('walk_to',{actor:'carer',x:-5,z:3});
  until(rt,()=>!rt.isActive(r.id)&&!rt.isActive(direction.id)); assert.equal(r.status,'cancelled'); assert.equal(direction.status,'completed'); clean(rt);
  assert.equal(state(rt).pending?.purpose,purpose); care(rt); assert.equal(state(rt).cycles,1);
});
test('repeat due is deterministic elapsed time; four cycles exhaust water without refill', () => {
  const rt=fixture(); care(rt); const before=rt.stateHash();
  const denied=rt.submit('garden_care',gardenCareParams()); assert.equal(denied.diagnostic?.code,'garden_care.not-due'); assert.equal(rt.stateHash(),before);
  for (let i=1;i<4;i++) { steps(rt,state(rt).remainingTicks); assert.equal(state(rt).due,true); care(rt); }
  assert.equal(state(rt).cycles,4); assert.equal(rt.world.entities['water-bowl'].contents!.fraction,0);
  steps(rt,state(rt).remainingTicks); const empty=rt.submit('garden_care',gardenCareParams()); assert.equal(empty.diagnostic?.code,'garden_care.water-unavailable'); clean(rt);
});
for (const invalid of ['missing-plant','missing-water','empty-water','unsupported-plant','wrong-water','foreign-held','occupied-return','bad-state']) test(`${invalid} refuses before any physical effect`, () => {
  const rt=fixture(), p=gardenCareParams(), w=rt.world.entities['water-bowl'];
  if(invalid==='missing-plant') p.plant='absent';
  if(invalid==='missing-water') p.water='absent';
  if(invalid==='empty-water') w.contents!.fraction=0;
  if(invalid==='unsupported-plant') rt.world.entities['plant-a'].support={kind:'none'};
  if(invalid==='wrong-water') w.contents!.food='soup';
  if(invalid==='foreign-held') w.support={kind:'in-hand',by:'other',hand:'right'};
  if(invalid==='occupied-return') { const e=itemEntity('foreign','bowl',[0,0,0]); const s=surfaceSlot(rt.world,p.returnSlot); assert.ok(!('code'in s)); placeOnSlot(e,s,0); rt.world.entities[e.id]=e; }
  if(invalid==='bad-state') (rt.world.entities['plant-a'] as GardenEntity).gardenCare!.waterReceived=.1;
  const before=rt.stateHash(), r=rt.submit('garden_care',p); assert.equal(r.status,'failed',JSON.stringify(r)); assert.equal(rt.stateHash(),before); assert.deepEqual(rt.holder('actor:carer'),[]);
});
test('foreign planter lease refuses without cancelling owner', () => {
  const rt=fixture(); const lease: ActionDef = {verb:'garden_test_lease', description:'fixture lease',schema:z.object({}),reservations:()=>[{resource:'entity:plant-a',mode:'exclusive'}],plan:()=>({ok:true,program:null}),start:()=>null,step:()=>({status:'running'}),cancel:()=>({ok:true})};
  rt.registry.set(lease.verb,lease); const owner=rt.submit(lease.verb,{});rt.step(); const before=rt.stateHash(), r=rt.submit('garden_care',gardenCareParams());
  assert.equal(r.diagnostic?.code,'garden_care.occupied');assert.equal(rt.stateHash(),before);assert.ok(rt.isActive(owner.id));rt.cancel(owner.id);clean(rt);
});
test('same commands repeat exact care state and action provenance deterministically', () => {
  const run=()=>{const rt=fixture();care(rt);care(rt,'plant-b');return hashOf([rt.world,[...rt.records.values()],rt.events]);}; assert.equal(run(),run());
});

test('a newly occupied return slot retains held water and claims until the obstacle clears', () => {
  const rt=fixture(), r=rt.submit('garden_care',gardenCareParams());
  until(rt,()=> (state(rt).pending?.delivered??0)>0);
  const retained=structuredClone(state(rt)), water=rt.world.entities['water-bowl'].contents!.fraction;
  const foreign=itemEntity('foreign','bowl',[0,0,0]), slot=surfaceSlot(rt.world,'water-table#r0c2');
  assert.ok(!('code' in slot)); placeOnSlot(foreign,slot,0); rt.world.entities.foreign=foreign;
  rt.cancel(r.id); until(rt,()=>r.status==='blocked'&&r.diagnostic?.code==='garden_care.return-occupied');
  assert.equal(rt.isActive(r.id),true); assert.deepEqual(rt.world.entities['water-bowl'].support,{kind:'in-hand',by:'carer',hand:'right'});
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction,water); assert.equal(state(rt).waterReceived,retained.waterReceived);
  assert.deepEqual(rt.holder('actor:carer'),[r.id]); assert.deepEqual(rt.world.entities.foreign.support,foreign.support);
  delete rt.world.entities.foreign; until(rt,()=>!rt.isActive(r.id)); assert.equal(r.status,'cancelled'); clean(rt);
  assert.equal(state(rt).pending?.purpose,retained.pending?.purpose); care(rt); assert.equal(state(rt).cycles,1);
});
