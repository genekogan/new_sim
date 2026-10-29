import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';

const out=process.env.SOUL_ACTIONS_OUT;
test('switchable floor lamp and carryable lantern: ordinary Soul actions, refusal, persistence and bounded discovery', {timeout:60000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Light test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 assert.equal(god.act({ops:[{op:'place',def:'core/floor-lamp@1',name:'old-floor-lamp',p:[-3,0]}]}).accepted,true);await tick(45);
 const absent=await here();const baselineOrdinary=edge.capabilities(soul).filter(c=>['stand:here','wave:here','rest:here'].includes(c.id)).map(c=>({id:c.id,available:c.available}));
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/floor-lamp@2',name:`distant-${i}`,p:[100+i%10*2,100+Math.floor(i/10)*2]}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);
 const irrelevant=await here();assert.ok(!JSON.stringify(irrelevant).includes('distant-'),'100 distant lamps add no feature-specific here context');
 assert.ok(!edge.capabilities(soul).some(c=>c.object===god.model.get('old-floor-lamp').id),'v2 registration does not add actions to v1');const farIds=new Set(distant.map(d=>god.model.get(d.name).id));assert.deepEqual(edge.capabilities(soul).filter(c=>farIds.has(c.object)),[],'no distant lamp actuator capabilities');assert.deepEqual(edge.capabilities(soul).filter(c=>['stand:here','wave:here','rest:here'].includes(c.id)).map(c=>({id:c.id,available:c.available})),baselineOrdinary,'ordinary capabilities unchanged');
 const body=f.host.engine.world.entities[soul.entityId];const at=[body.pose.p[0],body.pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/floor-lamp@2',name:'reading-light',p:[at[0]+1,at[1]]},{op:'place',def:'core/lantern@2',name:'small-lantern',p:[at[0],at[1]+1]},{op:'place',def:'core/bowl@1',name:'bowl',p:[at[0]-1,at[1]]}]}).accepted,true);await tick(45);
 const act=async(id,verb,accepted=true)=>{const p=app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:`object:${id}:${verb}`})});const r=await accept(f.host,p);const b=await r.json();assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const save=name=>{if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/${name}.json`,JSON.stringify(god.model.snapshot()));}};
 save('lights-on');const receipts=[];
 for(const id of ['reading-light','small-lantern']){
  receipts.push(await act(id,'switch-off'));await tick(90);assert.equal(god.model.get(id).state.on,false);
  assert.equal(edge.receipt(soul.soulId,receipts.at(-1).receipt.id).phase,'completed');
  await act(id,'switch-off',false);
 }
 save('lights-off');
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);
 assert.equal(restored.get('reading-light').state.on,false);assert.equal(restored.get('small-lantern').state.on,false);
 await act('bowl','switch-on',false);
 for(const id of ['reading-light','small-lantern']){await act(id,'switch-on');await tick(90);assert.equal(god.model.get(id).state.on,true);}
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 assert.equal(god.model.resolvedDef('core/floor-lamp@1').actions.length,0,'frozen v1 unchanged');
 assert.equal(god.model.resolvedDef('core/lantern@2').components.carryable.mass,1,'carry opt-in preserved');
 const report={status:'pass',checks:['two object families through same declarative actuator','HTTP Soul action receipts completed','duplicate off refused','unsupported bowl refused','snapshot reload retains off','100 distant lights absent from discovery','v1 preserved','native engine violations zero'],hereBytes:{absent:JSON.stringify(absent).length,distant:JSON.stringify(irrelevant).length},receipts,limitation:'Deterministic native fake-brain test; no claim of model-level instruction-following acceptance.'};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
