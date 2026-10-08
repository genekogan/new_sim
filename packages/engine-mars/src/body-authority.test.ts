import test from 'node:test';import assert from 'node:assert/strict';
import {marsFactory,GREEN_FIELD_WORLD} from './engine.ts';
import {sampleTake} from '../../../mars/viewer/engine/take/replay.ts';
test('BODY native authority: safe swap changes replica/take, exact snapshot; unsafe programs refuse without mutation',async()=>{
 const f=await marsFactory(GREEN_FIELD_WORLD),e=f.create(f.genesis('body-authority'));e.spawnHuman({id:'h',label:'Human',soul:'s'});
 const body={family:'floater' as const,type:'ceramic' as const,model:'verdelis',modelUrl:'/world-assets/littlemartians/characters/verdelis.glb',radius:.35,hoverHeight:1.45};
 assert.equal(e.bodyAssignmentProblemV1('h',body),null);assert.equal(e.assignBodyV1('h',body),true);let changed=false;
 for(let i=0;i<25;i++){const out=e.step();changed ||= out.changes.some(c=>c[1]==='h'&&c[2]==='body');}
 assert.ok(changed);const snap=e.snapshot(),restored=f.restore(snap);assert.equal(restored.stateHash(),e.stateHash());assert.deepEqual(restored.world.entities.h.body,body);
 const hash=e.stateHash();for(const verb of ['sit','build_lookout','mars:pose_v1','mars:take_item'])assert.equal(e.perform({actor:'h',label:verb,steps:[{verb,params:{}}]}).diagnostic?.code,'body.unsupported');assert.equal(e.stateHash(),hash);
 const r=e.perform({actor:'h',label:'hover',steps:[{verb:'rest',params:{seconds:2}}]});assert.equal(r.ok,true);assert.equal(e.assignBodyV1('h',null),false);assert.equal(e.perform({actor:'h',label:'unsupported sit',steps:[{verb:'sit',params:{}}]}).ok,false);assert.equal(e.programOf('h'),r.id);for(let i=0;i<100;i++)e.step();assert.equal(e.assignBodyV1('h',null),true);for(let i=0;i<10;i++)e.step();
 const take=(e as any).recorder.finish(),frame=sampleTake(take,(e.world.tick-take.startTick)*take.dt);assert.equal(frame.entities.h.state.body,null);assert.deepEqual(e.runtime.violations,[]);
});
