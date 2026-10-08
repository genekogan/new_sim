import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory} from './retained-shore-engine.ts';
import {withStaticGridReadCache} from '../../../mars/viewer/engine/spatial/grid.ts';
test('cached geometry preserves exact restored native bodies, dynamic seat holders, refusal and subsequent execution',async()=>{
 const factory=await retainedCommonsShoreFactory(),engine=factory.create(factory.genesis('static-grid-restore'));
 const transition=engine.previewRetainedCommonsShoreV1!();assert.ok(transition.ok);if(!transition.ok)return;engine.adoptRetainedCommonsShoreV1!(transition.transition);
 engine.spawnHuman({id:'host',label:'Synthetic seat holder',soul:'host'});engine.spawnHuman({id:'guest',label:'Synthetic independent body',soul:'guest'});
 const snapshot=engine.snapshot(),plain=factory.restore(snapshot),cached=withStaticGridReadCache(()=>factory.restore(snapshot));assert.deepEqual(cached.snapshot(),plain.snapshot());
 const seat={actor:'host',label:'hold exact native seat',steps:[{verb:'mars:sit',params:{slot:'commons-bench-west#seat0'}}]};assert.deepEqual(cached.canPerform(seat),plain.canPerform(seat));assert.ok(plain.perform(seat).ok);assert.ok(cached.perform(seat).ok);
 for(let i=0;i<1500&&plain.world.entities.host.human?.activity!=='sit';i++){plain.step();cached.step();}assert.equal(plain.world.entities.host.human?.activity,'sit');assert.equal(cached.stateHash(),plain.stateHash());assert.deepEqual(cached.snapshot(),plain.snapshot());
 const held=plain.snapshot(),fresh=factory.restore(held),memo=withStaticGridReadCache(()=>factory.restore(held));assert.deepEqual(memo.snapshot(),fresh.snapshot());
 const blocked={actor:'guest',label:'cannot borrow held seat',steps:[{verb:'mars:sit',params:{slot:'commons-bench-west#seat0'}}]},free={actor:'guest',label:'independent free seat',steps:[{verb:'mars:sit',params:{slot:'commons-bench-west#seat1'}}]};
 assert.deepEqual(memo.canPerform(blocked),fresh.canPerform(blocked));assert.deepEqual(memo.canPerform(free),fresh.canPerform(free));assert.equal(fresh.canPerform(free),null);
 assert.ok(fresh.perform(blocked).ok);assert.ok(memo.perform(blocked).ok);for(let i=0;i<60;i++){fresh.step();memo.step();}assert.equal(fresh.world.entities.host.human?.activity,'sit');assert.notEqual(fresh.world.entities.guest.human?.activity,'sit','a named occupied slot must not be stolen');assert.equal(memo.stateHash(),fresh.stateHash());assert.equal(fresh.programOf('guest'),null,'the occupied named-slot attempt ends rather than stealing its claim');
 const leave={actor:'host',label:'ordinary native stand',steps:[{verb:'stand',params:{}}]};assert.ok(fresh.perform(leave).ok);assert.ok(memo.perform(leave).ok);for(let i=0;i<60;i++){fresh.step();memo.step();}assert.equal(memo.stateHash(),fresh.stateHash());
 const move={actor:'host',label:'clear the released native approach',steps:[{verb:'walk_to',params:{to:'commons-bench-east'}}]};assert.ok(fresh.perform(move).ok);assert.ok(memo.perform(move).ok);for(let i=0;i<1500&&fresh.programOf('host');i++){fresh.step();memo.step();}assert.equal(fresh.programOf('host'),null);assert.equal(memo.stateHash(),fresh.stateHash());
 assert.ok(fresh.perform(blocked).ok);assert.ok(memo.perform(blocked).ok);for(let i=0;i<1500&&fresh.world.entities.guest.human?.activity!=='sit';i++){fresh.step();memo.step();assert.equal(memo.stateHash(),fresh.stateHash());}assert.equal(fresh.world.entities.guest.human?.activity,'sit','a fresh attempt may occupy the seat only after the native holder released it');assert.equal(memo.stateHash(),fresh.stateHash());assert.deepEqual(memo.runtime.violations,[]);
});
