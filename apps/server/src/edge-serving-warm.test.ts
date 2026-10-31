// Boot warm (EdgeLedger.prepareForServing): listing live Souls' capabilities before HTTP opens is a read. It changes no
// world state or log, lists the first Soul with a body (then more within the budget), and a warmed ledger answers the
// same capabilities as a cold one for the same state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@sim/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

test('prepareForServing warms within its budget, changes nothing, and lists what a cold ledger lists',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'walker'})));}
 for(let i=0;i<4;i++)f.host.tickOnce();
 const before={seq:f.host.seq,hash:f.host.engine.stateHash(),tick:f.host.engine.world.tick};
 const warm=new EdgeLedger(f.host,f.db);
 assert.deepEqual({...warm.prepareForServing(),ms:0},{souls:1,failed:0,ms:0},'the first Soul with a body, even with no budget');
 assert.deepEqual({...warm.prepareForServing(60_000),ms:0},{souls:2,failed:0,ms:0},'then more while within the budget');
 assert.deepEqual({seq:f.host.seq,hash:f.host.engine.stateHash(),tick:f.host.engine.world.tick},before,'a read: no event, no state change');
 const cold=new EdgeLedger(f.host,f.db);
 for(const r of rows){const soul={soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner};
  assert.deepEqual(JSON.stringify(warm.capabilities(soul)),JSON.stringify(cold.capabilities(soul)),r.name);}
});
