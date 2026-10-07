// Edge: several Souls swim at once; a crossing body never fails a swim receipt with occupied-route.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@sim/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
test('four edge swims at once all complete; peak simultaneous swimmers >= 3',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 await accept<unknown>(f.host,f.host.enableQuietStallReleaseV1());await accept<unknown>(f.host,f.host.enableYieldTimeoutV1());
 const rows:any[]=[];for(const n of ['ana','ben','cy','di']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'edge swimmer'})));}
 const ledger=new EdgeLedger(f.host,f.db),souls=rows.map(r=>({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner}));
 const receipts:string[]=[];for(const s of souls){const r=await accept(f.host,ledger.act(s,{capability:'swim:shore-water'}));assert.equal(r.accepted,true,JSON.stringify(r));if(r.accepted)receipts.push(r.receipt.id);}
 const w=f.host.engine.world as NativeWorld;let peak=0;
 const done=()=>receipts.every((id,i)=>!['waiting','started'].includes(ledger.receipt(souls[i].soulId,id)!.phase));
 for(let i=0;i<20000&&!done();i++){f.host.tickOnce();if(i%20===0)await setImmediate();peak=Math.max(peak,souls.filter(s=>['swim','tread'].includes(String(w.entities[s.entityId].human?.activity))).length);}
 const final=receipts.map((id,i)=>ledger.receipt(souls[i].soulId,id));
 assert.deepEqual(final.map(r=>r!.phase),['completed','completed','completed','completed'],JSON.stringify(final.map(r=>[r!.phase,r!.code])));
 assert.ok(peak>=3,'peak '+peak);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic('peak simultaneous swimmers '+peak);
});
