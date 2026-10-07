// C9 body effects (flag-on in this test only): removal at 60 min idle, reclaim lands at a starting place.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@sim/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {registerEdgeComms} from './edge/comms/index.ts';
import {WorldHost} from './world.ts';
import {kernelHash} from '@sim/kernel';
import {edgeSoulResolver} from './edge/routes.ts';
test('fading (flag on): removed after 60 min idle, hidden from others; next act reclaims at a starting place',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'fade'})));}
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono();let now=1_000_000;
 const comms=registerEdgeComms(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,()=>undefined),ledger},{fading:true,now:()=>now,sweepMs:0});ledger.attachComms(comms as any);t.after(()=>comms.close());
 const ana={soulId:rows[0].id,entityId:rows[0].entity_id,name:'ana',owner:rows[0].owner};
 const first=await accept(f.host,ledger.act(ana,{capability:'rest:here',params:{seconds:600}}));assert.equal(first.accepted,true);
 for(let i=0;i<20;i++)f.host.tickOnce();
 now+=61*60_000;comms.sweep();for(let i=0;i<10;i++){f.host.tickOnce();f.host.drainInputs();}
 assert.ok(ledger.faded.has(ana.soulId),'faded');{const r=ledger.receipt(ana.soulId,(first as any).receipt.id)!;assert.deepEqual([r.phase,r.code],['failed','soul.faded'],'fading ends the open act failed, not replaced');}assert.equal(f.host.engine.programOf(ana.entityId),null,'body stopped');
 assert.ok(!ledger.perceivedBodies(rows[1].id,500).some(b=>b.soulId===ana.soulId),'hidden from others');
 assert.equal((ledger.observe(ana,new Set()) as any).self.state,'faded');
 const back=await accept(f.host,ledger.act(ana,{capability:'rest:here',params:{seconds:5}}));assert.equal(back.accepted,true,JSON.stringify(back));
 assert.ok(!ledger.faded.has(ana.soulId));assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='edge-relocate').length,1);
 const p=(f.host.engine.world as NativeWorld).entities[ana.entityId].pose.p;t.diagnostic('landed at '+JSON.stringify(p));
 for(let i=0;i<40;i++)f.host.tickOnce();f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,mode);h.stop();}
 assert.deepEqual(f.host.engine.runtime.violations,[]);
});
