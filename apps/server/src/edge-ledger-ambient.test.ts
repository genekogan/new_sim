// Ambient life reflex: idle Souls do small native things between agent decisions; logged as decisions (replay exact),
// no receipts, never an accepted action; any agent act replaces it at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@sim/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {WorldHost} from './world.ts';
import {kernelHash} from '@sim/kernel';
test('ambient life: idle Souls stroll/sit/face/warm, no receipts, agent act replaces it, replay exact',{timeout:300000},async t=>{
 const factory=()=>retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
 const f=fixture(':memory:',await factory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben','cy']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'ambient'})));}
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),souls=rows.map(r=>({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner}));
 const start=souls.map(s=>[...(f.host.engine.world as any).entities[s.entityId].pose.p]);
 const ambient=()=>f.db.events(f.host.worldId).filter(e=>e.kind==='decision'&&(e.payload as any).trigger==='edge-ambient');
 let moved=false,busy=0;
 for(let i=0;i<2400;i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}
  if(i>500&&souls.some(s=>f.host.engine.programOf(s.entityId)))busy++;
  moved||=souls.some((s,k)=>{const p=(f.host.engine.world as any).entities[s.entityId].pose.p;return Math.hypot(p[0]-start[k][0],p[2]-start[k][2])>0.5;});}
 const picks=ambient().map(e=>(e.payload as any).option.split(':')[0]);t.diagnostic(JSON.stringify(picks));
 assert.ok(picks.length>=3,'ambient decisions logged');assert.ok(moved,'visibly alive');assert.ok(busy>200,'bodies occupied between decisions');
 assert.equal(Number((f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as any).n),0,'no receipts');assert.equal(f.db.paidCost(),0);
 // an agent act replaces whatever ambient thing is running
 const a=souls[0];const r=await accept(f.host,ledger.act(a,{capability:'stand:here'}));assert.equal(r.accepted,true);
 const w=await accept(f.host,ledger.act(a,{capability:'wander:here',params:{seconds:10}}));assert.equal(w.accepted,true,JSON.stringify(w));
 for(let i=0;i<400&&ledger.receipt(a.soulId,(w as any).receipt.id)!.phase==='waiting';i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
 assert.ok(['started','completed'].includes(ledger.receipt(a.soulId,(w as any).receipt.id)!.phase),'agent act took the body');
 for(let i=0;i<40;i++)f.host.tickOnce();f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
 const h=new WorldHost(f.db,await factory(),f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);h.stop();
 assert.deepEqual(f.host.engine.runtime.violations,[]);
});
