import test from 'node:test';
import assert from 'node:assert/strict';
import {intentNativeFixture} from '../test/intent-native-fixture.ts';
import {readIntentArrivalsV1} from './intent-arrivals.ts';
import {setImmediate} from 'node:timers/promises';
test('private arrival remains unavailable and empty by default; existing native walk output and history stay unchanged',async t=>{
  const f=intentNativeFixture(t);t.after(()=>{f.brain.quiesce();f.host.stop();});const scope=f.service.ownerScope({userId:'dev:alice',expiresAt:Number.MAX_SAFE_INTEGER},'s_A');
  assert.throws(()=>readIntentArrivalsV1(f.service,scope),/feature unavailable/);assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM intent_arrivals_v1').get()!.n,0);
  const queued=f.host.enqueue('decision','soul:s_A',{soulId:'s_A',entityId:'h_A',option:'legacy-walk',label:'legacy native walk',steps:[{verb:'walk_to',params:{to:[15,-9],standoff:0}}],reevalTicks:1e9,trigger:'fixture',fallback:false});f.host.drainInputs();await queued;
  for(let i=0;i<200&&f.host.engine.programOf('h_A');i++){f.host.tickOnce();if(i%10===0)await setImmediate();}
  const action=[...f.host.engine.runtime.records.values()].find(r=>r.verb==='walk_to');assert.equal(action?.status,'completed');assert.equal(action?.outputs?.arrivalEndpoint,undefined);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-arrival-v1').length,0);assert.equal(f.db.paidCost(),0);
});
