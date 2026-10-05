import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory} from '@sim/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {scheduleRetainedCommonsShoreInstallation} from './retained-shore-install.ts';
import {setImmediate} from 'node:timers/promises';
const factory=await retainedCommonsShoreFactory();
test('passive shore installation keeps HTTP/clock and existing rest live, commits once after natural quiet',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic quiet-boundary owner'}));
  await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());f.brain.quiesce();
  await accept(f.host,f.host.enqueue('decision','soul:'+row.id,{soulId:row.id,entityId:row.entity_id,option:'finite-rest',label:'ordinary finite native rest',steps:[{verb:'rest',params:{seconds:2}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  const original=f.host.engine.programOf(row.entity_id),bodies=structuredClone(f.host.engine.world.entities),tick=f.host.engine.world.tick;
  const install=scheduleRetainedCommonsShoreInstallation(f.host);t.after(()=>{install.close();f.host.stop();f.db.close();});
  assert.deepEqual(install.status(),{phase:'waiting',reason:'retained-shore.not-quiet-commons'});assert.equal(f.host.engine.programOf(row.entity_id),original);assert.equal((await f.app.request('/healthz')).status,200);
  for(let i=0;i<200&&install.status().phase!=='installed';i++){f.host.tickOnce();await setImmediate();}
  await accept(f.host,install.settled());assert.equal(install.status().phase,'installed');assert.ok(f.host.engine.world.tick>tick);assert.deepEqual(f.host.engine.world.entities,bodies);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='rules'&&e.payload.retainedCommonsShore).length,1);assert.equal(f.db.paidCost(),0);
});
