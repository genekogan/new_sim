import test from 'node:test';
import assert from 'node:assert/strict';
import {commonsProvisionsFactory,COMMONS_PERSONAL_RESOURCES} from '@sim/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
import {setImmediate} from 'node:timers/promises';
import {WorldHost} from './world.ts';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {kernelHash} from '@sim/kernel';
const factory=await commonsProvisionsFactory();
test('eight human owners retain bodies/history and get usable personal meal/sleep cards; ordinary owner intent eats finite stock and replay matches',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['People may eat, sleep, rest and meet.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();
  const rows=[];for(let i=0;i<8;i++){const owner='friend'+i;await invite(f,owner);const r=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:'+owner,'content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Friend '+i,description:'Synthetic invited owner provisions fixture'})});assert.equal(r.status,202);const {lifecycle}=await r.json() as any;for(let j=0;j<4;j++){f.host.drainInputs();await setImmediate();}rows.push(f.db.soul(lifecycle.soulId)!);}
  const originalBodies=JSON.stringify(rows.map(r=>f.host.engine.world.entities[r.entity_id])),oldPrefix=JSON.stringify(f.db.events(f.host.worldId));
  await accept(f.host,f.host.installCommonsProvisionsV1());assert.equal(JSON.stringify(rows.map(r=>f.host.engine.world.entities[r.entity_id])),originalBodies);assert.equal(JSON.stringify(f.db.events(f.host.worldId).slice(0,JSON.parse(oldPrefix).length)),oldPrefix);
  const minted=await installCommonsProvisionCards(f.host,f.brain);assert.equal(minted.filter(v=>v.ok).length,32);assert.equal(f.db.paidCost(),0);
  for(const [i,row] of rows.entries()){assert.ok(f.host.kernel.decks[row.id].cards.includes('eat prepared meal '+row.id.slice(2)));assert.ok(f.host.kernel.decks[row.id].cards.includes('sleep on ground mat '+row.id.slice(2)));assert.ok(f.host.engine.world.regions[COMMONS_PERSONAL_RESOURCES[i].mat]);assert.equal(f.souls.controlReady(row),true);}
  const first=rows[0],card='eat prepared meal '+first.id.slice(2);const startHunger=f.host.minds.get(first.id)!.life!.needs.hunger;
  const response=await accept(f.host,f.request('/v1/souls/'+first.id+'/intent',{intent:{agenda:[{card,target:null}],note:'Eat the prepared food.'}},'friend0'));assert.equal(response.status,200);
  let consumed=false;for(let i=0;i<3000;i++){f.host.tickOnce();if(i%10===0)await setImmediate();if((f.host.engine.world as NativeWorld).entities[COMMONS_PERSONAL_RESOURCES[0].bowl].contents?.fraction===0&&!f.host.minds.get(first.id)!.pending){consumed=true;break;}}
  assert.ok(consumed);assert.ok(f.host.minds.get(first.id)!.life!.needs.hunger<startHunger);assert.equal(COMMONS_PERSONAL_RESOURCES.filter(r=>(f.host.engine.world as NativeWorld).entities[r.bowl].contents?.fraction===1).length,7);assert.deepEqual(f.host.engine.runtime.violations,[]);
  f.brain.quiesce();f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)},life=JSON.stringify([...f.host.minds.values()].map(m=>m.life));
  let h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'snapshot');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();assert.equal(f.db.paidCost(),0);
});
