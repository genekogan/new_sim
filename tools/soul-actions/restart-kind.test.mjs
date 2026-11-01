import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {setImmediate} from 'node:timers/promises';import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,factory} from '../../apps/server/test/native-owner-fixture.ts';import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';import {GodMode} from '../../apps/server/src/god/god.ts';import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
test('persistent built-object kinds restore their actuators on the second boot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'soul-actions-kind-'));
 try{for(let boot=0;boot<2;boot++){
  const f=fixture(join(dir,'world.db'),factory,{durableClockV1:true});f.brain.quiesce();const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const comms=mountEdgeRoutes(new Hono(),{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>{throw Error('not used');}});const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
  try{if(!boot)assert.equal(god.act({ops:[{op:'place',def:'core/floor-lamp@2',name:'light',p:[3,0]},{op:'place',def:'core/lantern@2',name:'lantern',p:[3,2]}]}).accepted,true);
   for(let i=0;i<60;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}
   for(const kind of ['floor-lamp-v2','lantern-v2'])assert.deepEqual(Object.keys(comms.objects.kindOf(kind)?.actions??{}).sort(),['switch-off','switch-on'],`boot ${boot}: ${kind} remains switchable`);
  }finally{comms.close();f.host.stop();f.db.close();}
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
