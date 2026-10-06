import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../runtime/runtime.ts';
import {decodeSnapshot} from '../runtime/snapshot.ts';
import {encode} from '../runtime/codec.ts';
import {createRegistry,servicesFor,ENGINE_INVARIANTS} from '../api/registry.ts';
import {groundSleepFixture} from '../scenarios/sleep.ts';
import {readSleep,NATIVE_SLEEP_SNAPSHOT_V1} from '../activities/sleep.ts';
function setup(enabled=true){const f=groundSleepFixture([0,0],0),registry=createRegistry(),services=servicesFor({'ground-sleep':f.scene}),rt=new Runtime(f.world,registry,services(f.world),ENGINE_INVARIANTS);if(enabled)rt.services.nativeSleepSnapshotV1=NATIVE_SLEEP_SNAPSHOT_V1;const r=rt.submit('sleep',f.p,{preempt:false});return {...f,registry,services,rt,r};}
function until(rt:Runtime,condition:()=>boolean){for(let i=0;i<2000&&!condition();i++)rt.step();assert.ok(condition());assert.deepEqual(rt.violations,[]);}
for(const phase of ['approaching','lying-down','sleeping','waking','returning','paused'] as const)test('explicit active sleep snapshot restores '+phase+' with exact pose, holders and continuation',()=>{
 const f=setup();if(phase==='paused'){until(f.rt,()=>readSleep(f.rt,f.r.id)?.mode==='sleeping');f.rt.submit('sleep_control',{sleep:f.r.id,intent:'pause'});}until(f.rt,()=>readSleep(f.rt,f.r.id)?.mode===phase);const raw=JSON.parse(JSON.stringify(f.rt.snapshot())),copy=Runtime.restore(raw,f.registry,f.services(decodeSnapshot(raw).world),ENGINE_INVARIANTS);assert.equal(copy.stateHash(),f.rt.stateHash());assert.deepEqual(copy.holder('actor:sleeper'),f.rt.holder('actor:sleeper'));if(phase==='paused'){f.rt.submit('sleep_control',{sleep:f.r.id,intent:'resume'});copy.submit('sleep_control',{sleep:f.r.id,intent:'resume'});}for(let i=0;i<300;i++){f.rt.step();copy.step();assert.equal(copy.stateHash(),f.rt.stateHash());assert.deepEqual(readSleep(copy,f.r.id),readSleep(f.rt,f.r.id));assert.deepEqual(copy.violations,[]);assert.deepEqual(copy.holder('sleep-mat:mat'),f.rt.holder('sleep-mat:mat'));}
});
test('default sleep remains non-resumable and a snapshot cannot substitute an actor/store/progress policy',()=>{
 const disabled=setup(false);until(disabled.rt,()=>readSleep(disabled.rt,disabled.r.id)?.mode==='sleeping');assert.throws(()=>disabled.rt.snapshot(),/snapshot|not enabled/);const before=disabled.rt.stateHash();assert.throws(()=>disabled.rt.snapshot({allowDrop:true}),/prone sleep pose|drop/);assert.equal(disabled.rt.stateHash(),before);const f=setup();until(f.rt,()=>readSleep(f.rt,f.r.id)?.mode==='sleeping');const raw=f.rt.snapshot();for(const mutate of [(g:any)=>{delete g.services.nativeSleepSnapshotV1;},(g:any)=>{g.live.find((l:any)=>l.id===f.r.id).exec.elapsed=601;},(g:any)=>{g.services.sleeps.purposes[f.r.id]=structuredClone(g.services.sleeps.purposes[f.r.id]);},(g:any)=>{g.live.find((l:any)=>l.id===f.r.id).exec.p.actor='visitor';}]){const graph=decodeSnapshot(raw);mutate(graph);assert.throws(()=>Runtime.restore({...raw,data:encode(graph)},f.registry,f.services(graph.world),ENGINE_INVARIANTS),/sleep|not enabled/i);}
});
