import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, type MarsWorldConfig } from './engine.ts';
import { edenCampActivities, CAMP_ARRIVALS } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import { constructionDone } from './construction.ts';
import type { Engine } from '@sim/engine-contract';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';
const cfg: MarsWorldConfig={scene:'eden-camp',arrival:CAMP_ARRIVALS[0].p,arrivalPlace:'yard',reference:CAMP_ARRIVALS[1].p,grounds:{id:'grounds',name:'Camp'}};
async function setup(){const f=await marsFactory(cfg),e=f.create(f.genesis('construction-proof'));for(const [i,name] of ['Alice','Bob','Carol','David'].entries())e.spawnHuman({id:`h${i}`,label:name,soul:`s${i}`});return {f,e};}
function build(e:Engine,phase:string){const p={actor:'h0',label:`build ${phase}`,steps:[{verb:'build_lookout',params:{phase}}]};assert.equal(e.canPerform(p),null,JSON.stringify(e.canPerform(p)));const r=e.perform(p);assert.equal(r.ok,true,JSON.stringify(r));return r.id;}
function finish(e:Engine,id:string,cancelled=false){for(let n=0;n<90000;n++){const out=e.step();assert.deepEqual(e.runtime.violations,[]);const ev=out.programs.find(p=>p.id===id&&['completed','failed','cancelled'].includes(p.kind));if(ev){assert.equal(ev.kind,cancelled?'cancelled':'completed',JSON.stringify(ev));return;}}assert.fail('finite construction did not finish');}
test('finite chosen jobs assemble all original parts, survive fresh Runtime, and refuse repeated work',async()=>{
 const {f,e}=await setup();
 for(const phase of ['stage','frame','deck','stairs']){finish(e,build(e,phase));assert.equal(e.canPerform({actor:'h0',label:'repeat',steps:[{verb:'build_lookout',params:{phase}}]})?.code,'construction.done');}
 const w=e.world as WorldState;
 for(const a of edenCampActivities().filter(a=>a.id.startsWith('build.')&&a.id!=='build.climb-lookout'))assert.equal(constructionDone(w,a),true,a.id);
 assert.equal(Object.values(w.entities).filter(e=>e.kind==='component'&&e.phase==='installed').length,24);
 e.beginQuiet!();for(let i=0;i<500&&!e.isQuiet!();i++)e.step();assert.equal(e.isQuiet!(),true);
 const before=e.physicalHash();e.compact!();assert.equal(e.physicalHash(),before);
 const fresh=f.create(structuredClone(e.world));for(let i=0;i<100;i++)fresh.step();assert.deepEqual(fresh.runtime.violations,[]);
 for(const a of edenCampActivities().filter(a=>a.id.startsWith('build.')&&a.id!=='build.climb-lookout'))assert.equal(constructionDone(fresh.world as WorldState,a),true,a.id);
});
test('stop and daily quiet drain an in-flight frame to safe support; crew cannot be stolen',async()=>{
 const {e}=await setup();finish(e,build(e,'stage'));const id=build(e,'frame');let held=false;
 for(let i=0;i<90000;i++){e.step();const w=e.world as WorldState;if(['upright-a','upright-b'].every(id=>w.entities[id].support?.kind==='held')){held=true;break;}}
 assert.equal(held,true);assert.equal(e.canSnapshot!(),false);assert.throws(()=>e.snapshot(),{code:'snapshot.non-resumable'});
 assert.equal(e.canPerform({actor:'h2',label:'other work',steps:[{verb:'rest',params:{seconds:1}}]})?.code,'construction.committed');
 assert.equal(e.actorBorrowed!('h2'),true);e.stop(id);e.beginQuiet!();finish(e,id,true);
 for(let i=0;i<500&&!e.isQuiet!();i++)e.step();assert.equal(e.isQuiet!(),true);
 for(const id of ['upright-a','upright-b'])assert.equal((e.world as WorldState).entities[id].support?.kind,'connected');
 assert.deepEqual(e.runtime.violations,[]);
});
