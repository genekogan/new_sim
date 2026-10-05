import test from 'node:test';
import assert from 'node:assert/strict';
import {commonsKitchenFactory} from './commons-kitchen-engine.ts';
import {COMMONS_KITCHENS,commonsKitchen} from './commons-kitchen.ts';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';
import {COMMONS_PERSONAL_RESOURCES} from './commons-provisions.ts';
import {commonsProvisionsFactory} from './commons-provisions-engine.ts';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
const factory=await commonsKitchenFactory({version:'commons-kitchen/2'});
test('recipe1 retains its published hash; recipe2 places all initial item footprints on existing inner slots',()=>{
  assert.equal(commonsKitchen('commons-kitchen/1').hash,'90b3af0545d303ca2701153bd3912865349b81820bc68dc0c82aa8398c1998c3');
  const p=commonsKitchen('commons-kitchen/2');
  for(const r of COMMONS_KITCHENS){const table=p.entities[r.table],td=CATALOG[table.def];for(const id of [r.beans,r.greens,r.pot,r.spoon]){const item=p.entities[id],d=CATALOG[item.def];assert.equal(item.support?.kind,'resting-on');assert.ok(item.support?.kind==='resting-on'&&item.support.slot?.startsWith('r1'));assert.ok(Math.abs(item.pose.p[0]-table.pose.p[0])+d.size[0]/2<=td.size[0]/2);assert.ok(Math.abs(item.pose.p[2]-table.pose.p[2])+d.size[2]/2<=td.size[2]/2);}}
});
test('retained deck-bearing commons conserves finite supported preparation and serving; old calls still refuse linked world',async()=>{
  const e=factory.create(factory.genesis('commons-kitchen-native'));e.spawnHuman({id:'h_A',label:'Synthetic native kitchen actor',soul:'s_A'});
  let q=e.previewCommonsProvisionsV1!();assert.ok(q.ok);if(!q.ok)return;e.adoptCommonsProvisionsV1!(q.transition);
  const original=structuredClone(e.world.entities),k=e.previewCommonsKitchenV1!();assert.ok(k.ok);if(!k.ok)return;e.adoptCommonsKitchenV1!(k.transition);
  for(const [id,v] of Object.entries(original))assert.deepEqual(e.world.entities[id],v);
  const r=COMMONS_KITCHENS[0],p={actor:'h_A',label:'prepare finite cold dish',steps:[{verb:'mars:prepare_food',params:{pot:r.pot,spoon:r.spoon,ingredients:[r.beans,r.greens],groundRoutePolicy:'supported-ground/1'}},{verb:'mars:put_item',params:{item:r.spoon,surfaceSlot:r.table+'#r1c4'}}]};
  const old={...p,steps:[{verb:'mars:prepare_food',params:{pot:r.pot,spoon:r.spoon,ingredients:[r.beans,r.greens]}}]};assert.equal(e.canPerform(old)?.code,'prepare_food.scope');assert.equal(e.canPerform(p),null);
  function run(program:typeof p){const admitted=e.perform(program);assert.ok(admitted.ok,JSON.stringify(admitted));let terminal:any;for(let i=0;i<6000&&!terminal;i++){const out=e.step();assert.deepEqual(e.runtime.violations,[]);terminal=out.programs.find(v=>v.id===admitted.id&&['completed','failed'].includes(v.kind));const w=(e.world as NativeWorld).entities;assert.equal((w[r.beans].contents?.fraction??0)+(w[r.greens].contents?.fraction??0)+4*(w[r.pot].contents?.fraction??0),2);}assert.equal(terminal?.kind,'completed',JSON.stringify(terminal));}
  run(p);const w=(e.world as NativeWorld).entities;assert.equal(w[r.beans].contents?.fraction,0);assert.equal(w[r.greens].contents?.fraction,0);assert.equal(w[r.pot].contents?.fraction,.5);assert.ok(w[r.pot].foodPreparation?.complete);assert.equal(factory.restore(e.snapshot()).stateHash(),e.stateHash());
  assert.equal(e.canPerform(p)?.code,'prepare_food.already-complete');
  const bowl=COMMONS_PERSONAL_RESOURCES[0].bowl,spoon=COMMONS_PERSONAL_RESOURCES[0].spoon;
  // Existing initial meal is consumed natively before serving into its empty bowl.
  let admitted=e.perform({actor:'h_A',label:'consume old meal',steps:[{verb:'mars:take_item',params:{item:bowl,hand:'left'}},{verb:'mars:take_item',params:{item:spoon,hand:'right'}},{verb:'mars:eat',params:{bowl,spoon}}]});assert.ok(admitted.ok);let done=false;for(let i=0;i<6000&&!done;i++){const out=e.step();assert.deepEqual(e.runtime.violations,[]);const t=out.programs.find(x=>x.id===admitted.id&&['completed','failed'].includes(x.kind));if(t){assert.equal(t.kind,'completed');done=true;}}assert.ok(done);assert.equal(w[bowl].contents?.fraction,0);
  admitted=e.perform({actor:'h_A',label:'serve finite prepared food',steps:[{verb:'mars:walk_to',params:{x:r.p[0]-.15,z:r.p[2]-.9,level:0}},{verb:'mars:serve',params:{bowl,pot:r.pot}},{verb:'mars:eat',params:{bowl,spoon}},{verb:'mars:put_item',params:{item:spoon,surfaceSlot:'ground'}},{verb:'mars:put_item',params:{item:bowl,surfaceSlot:'ground'}}]});assert.ok(admitted.ok,JSON.stringify(admitted));done=false;for(let i=0;i<6000&&!done;i++){const out=e.step();assert.deepEqual(e.runtime.violations,[]);const t=out.programs.find(x=>x.id===admitted.id&&['completed','failed'].includes(x.kind));if(t){assert.equal(t.kind,'completed',JSON.stringify(t));done=true;}}assert.ok(done);assert.equal(w[r.pot].contents?.fraction,.25);assert.equal(w[bowl].contents?.fraction,0);assert.equal(factory.restore(e.snapshot()).stateHash(),e.stateHash());
  const oldFactory=await commonsProvisionsFactory();assert.equal(oldFactory.canReplayHistory?.(e.rulesVersion),false);assert.throws(()=>oldFactory.restore(e.snapshot()),/commons-kitchen.reader-required/);
});

test('retained actor occupying a future table refuses the checkpoint without mutation; ordinary departure makes it admissible',()=>{
  const e=factory.create(factory.genesis('kitchen-conflict'));e.spawnHuman({id:'h_A',label:'Synthetic retained native actor',soul:'s_A'});
  const p=e.previewCommonsProvisionsV1!();assert.ok(p.ok);if(!p.ok)return;e.adoptCommonsProvisionsV1!(p.transition);
  const r=COMMONS_KITCHENS[0];
  function walk(x:number,z:number){const a=e.perform({actor:'h_A',label:'ordinary ground walk',steps:[{verb:'mars:walk_to',params:{x,z,level:0}}]});assert.ok(a.ok);let done=false;for(let i=0;i<2000&&!done;i++){const out=e.step();assert.deepEqual(e.runtime.violations,[]);const t=out.programs.find(v=>v.id===a.id&&['completed','failed'].includes(v.kind));if(t){assert.equal(t.kind,'completed');done=true;}}assert.ok(done);}
  walk(r.p[0],r.p[2]);const before=e.stateHash(),no=e.previewCommonsKitchenV1!();assert.equal(no.ok,false);if(!no.ok)assert.equal(no.diagnostic.code,'commons-kitchen.physical-conflict');assert.equal(e.stateHash(),before);assert.ok(!e.world.entities[r.table]);
  walk(r.p[0]+2.5,r.p[2]);assert.ok(e.previewCommonsKitchenV1!().ok);
});
