import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {intentNativeFixture} from './intent-native-fixture.ts';
import {setImmediate} from 'node:timers/promises';
export async function drivePurpose<T>(f:ReturnType<typeof intentNativeFixture>,p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){f.host.drainInputs();await setImmediate();}assert.ok(done);return p;}
export async function purposePerceiveFixture(t:TestContext,enabled=true){
 const f=intentNativeFixture(t,':memory:',true,true);t.after(()=>{f.brain.quiesce();f.host.stop();});
 await drivePurpose<unknown>(f,f.host.enableIntentPurposeEvidenceV1());
 const scope=f.service.ownerScope({userId:'dev:alice',expiresAt:Number.MAX_SAFE_INTEGER},'s_A');
 for(let i=0;i<30;i++){
  const r=await drivePurpose(f,f.service.publisher.receive(scope,{contract:'soul-intent/2',op:'upsert',requestId:'private-perceive-'+i,words:'PRIVATE_PERCEIVE_'+i+' '+('Remember an unfinished personal purpose. '.repeat(35)),strict:i<2,importance:.5}));assert.ok(r.reservation.created);
  await drivePurpose(f,f.service.publisher.publish(scope,r.reservation,{summary:'Retain this while considering opportunities.',agenda:[{card:'rest',target:null}],trigger:{kind:'none'}}));
 }
 if(enabled)await drivePurpose<unknown>(f,f.host.enableIntentPurposeRecallV1());
 const soul=f.db.soul('s_A')!,credential=f.souls.pairExchange(f.souls.pairCode(soul,'http://127.0.0.1:4958',f.db.user('dev:alice')!).code,'synthetic private perception fixture').token;
 return {...f,soul,credential};
}
