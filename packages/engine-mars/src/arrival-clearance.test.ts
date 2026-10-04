import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory,marsCommonsTransitionFactory,EDEN_COMMONS_WORLD,EDEN_SAFE_COMMONS_WORLD,GREEN_FIELD_WORLD } from './engine.ts';
import { probeNativeHumanBirth } from './birth.ts';
import { loadMars } from './load.ts';
import { clearanceAt } from '../../../mars/viewer/engine/spatial/grid.ts';
import type { WorldState as NativeWorld } from '../../../mars/viewer/engine/world/types.ts';
import { HUMAN_RADIUS } from '../../../mars/viewer/engine/world/catalog.ts';

test('original commons keeps the thirteenth legacy placement/fault, but detached admission refuses it before canonical birth',async()=>{
  const f=await marsFactory(EDEN_COMMONS_WORLD),e=f.create(f.genesis('clock-profile'));
  for(let i=0;i<12;i++)e.spawnHuman({id:'h_'+i,label:'Resident '+i,soul:'s_'+i});
  const before=e.stateHash(),snapshot=e.snapshot(),p=probeNativeHumanBirth(e,f,{id:'h_12',label:'Resident 12',soul:'s_12'});
  assert.equal(p.outcome,'unavailable');if('diagnostic'in p)assert.equal(p.diagnostic.code,'birth.arrival-unavailable');
  assert.equal(e.stateHash(),before);assert.deepEqual(e.snapshot(),snapshot);assert.equal(e.world.entities.h_12,undefined);
  e.spawnHuman({id:'h_12',label:'Resident 12',soul:'s_12'});e.step();
  const v=e.runtime.violations.find(v=>v.code==='collision.human-static'&&v.message.startsWith('h_12 body overlaps'));
  assert.ok(v);assert.match(v.message,/commons-bench-east/);assert.equal(f.restore(snapshot).stateHash(),before);
});

test('actual corrected commons admits all 24 standing bodies with exact detached placement, full native clearance and continuation',async()=>{
  const f=await marsFactory(EDEN_SAFE_COMMONS_WORLD),e=f.create(f.genesis('clock-profile')),m=await loadMars();
  for(let i=0;i<24;i++){
    const request={id:'h_'+i,label:'Resident '+i,soul:'s_'+i},before=e.stateHash(),snapshot=e.snapshot();
    const p=probeNativeHumanBirth(e,f,request);assert.equal(p.outcome,'ready',JSON.stringify(p));
    assert.equal(e.stateHash(),before);assert.deepEqual(e.snapshot(),snapshot);e.spawnHuman(request);
    if('position'in p)assert.deepEqual(e.world.entities[request.id].pose.p,p.position);
  }
  const w=e.world as NativeWorld,sp=m.servicesFor(m.scenes)(w).spatial;sp.sync(w);
  for(const b of Object.values(w.entities).filter(e=>e.kind==='human'))assert.ok(clearanceAt(sp.level(0),[b.pose.p[0],b.pose.p[2]])>=HUMAN_RADIUS,b.id);
  const copy=f.restore(JSON.parse(JSON.stringify(e.snapshot())));
  for(let i=0;i<140;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());}
  assert.equal(Object.values(e.world.entities).filter(e=>e.kind==='human').length,24);assert.deepEqual(e.runtime.violations,[]);
});

test('arrival policy identity refuses cross-policy replay, snapshots, unknown versions and unavailable footing without reinterpretation',async()=>{
  const old=await marsFactory(EDEN_COMMONS_WORLD),next=await marsFactory(EDEN_SAFE_COMMONS_WORLD);
  assert.equal(next.rulesVersion,old.rulesVersion+'+arrival-clearance/1');
  for(const [reader,other] of [[old,next],[next,old]]){
    assert.equal(reader.canReplayHistory!(other.rulesVersion),false);assert.equal(reader.canRestoreSnapshot!(other.rulesVersion),false);
    assert.throws(()=>reader.restore(other.create(other.genesis('version')).snapshot()),/arrival policy differs/);
  }
  for(const bad of [next.rulesVersion+'+arrival-clearance/1',next.rulesVersion.replace('arrival-clearance/1','arrival-clearance/2')])assert.equal(next.canReplayHistory!(bad),false);
  const f=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,arrival:[500,500],reference:[501,500]}),e=f.create(f.genesis('outside')),before=e.stateHash();
  const p=probeNativeHumanBirth(e,f,{id:'h_new',label:'New',soul:'s_new'});assert.equal(p.outcome,'unavailable');
  assert.throws(()=>e.spawnHuman({id:'h_new',label:'New',soul:'s_new'}),/no free standing room/);assert.equal(e.stateHash(),before);assert.equal(e.world.tick,0);
});

test('existing Greenfield checkpoint explicitly targets corrected commons and the same reader probes new arrivals after adoption',async()=>{
  const old=await marsFactory(GREEN_FIELD_WORLD),f=await marsCommonsTransitionFactory(GREEN_FIELD_WORLD,{safeArrivalV1:true});
  const resident=old.create(old.genesis('existing'));resident.spawnHuman({id:'h_old',label:'Existing',soul:'s_old'});
  for(let i=0;i<37;i++)resident.step();const snap=resident.snapshot(),e=f.restore(snap),pose=structuredClone(e.world.entities.h_old);
  assert.equal(e.stateHash(),resident.stateHash());assert.equal(e.rulesVersion,old.rulesVersion);
  const p=e.previewCommonsTransition!();assert.equal(p.ok,true);if(!p.ok)throw new Error('unexpected refusal');
  assert.equal(p.transition.toRulesVersion,old.rulesVersion+'+commons/1+arrival-clearance/1');e.adoptCommons!(p.transition);
  assert.deepEqual(e.world.entities.h_old,pose);assert.equal(e.world.tick,37);
  const base=e.stateHash(),birth=probeNativeHumanBirth(e,f,{id:'h_new',label:'New',soul:'s_new'});assert.equal(birth.outcome,'ready');assert.equal(e.stateHash(),base);
  e.spawnHuman({id:'h_new',label:'New',soul:'s_new'});const copy=f.restore(e.snapshot());
  for(let i=0;i<20;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());}assert.deepEqual(e.runtime.violations,[]);
  const legacy=await marsCommonsTransitionFactory();assert.equal(legacy.canReplayHistory!(e.rulesVersion),false);assert.throws(()=>legacy.restore(e.snapshot()),/arrival policy differs/);
});
