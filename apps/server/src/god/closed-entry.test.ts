import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {readFileSync,writeFileSync} from 'node:fs';
import {fixture,factory,invite,accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {inPoly} from '../edge/ledger/places.ts';
import {GodMode} from './god.ts';
import {GroundHost} from './ground-host.ts';
import {installEngineBridge} from './engine-bridge.ts';

test('single-room building entry never substitutes the exterior when its only room is blocked',async t=>{
 const w=fixture(':memory:',factory,{durableClockV1:true});w.brain.quiesce();
 const god=new GodMode(w.db,{worldId:w.host.worldId,ownerId:'owner',tick:()=>w.host.engine.world.tick,emit(){}});
 new GroundHost(w.db,w.host,god);const edge=new EdgeLedger(w.host,w.db);
 const bridge=installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
 t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
 const tick=async(n=3)=>{for(let i=0;i<n;i++){w.host.tickOnce();await setImmediate();w.host.drainInputs();}};
 const patch=JSON.parse(readFileSync(new URL('../../../../worlds/patches/unified-affordances-20261027/hello-hamlet.json',import.meta.url),'utf8'));
 const def=patch.ops.find((o:any)=>o.op==='define'),place=patch.ops.find((o:any)=>o.name==='lab-reading-room');
 assert.equal(god.act({ops:[def,{...place,name:'reading-house',about:{title:'Closed Reading Room',aliases:['reading room']}}]}).accepted,true);await tick();
 await invite(w,'reader');const row:any=await accept(w.host,w.souls.create('dev:reader',{name:'Reader',description:'entry probe'}));
 const soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 await accept(w.host,w.host.enqueue('edge-relocate','test:entry',{...soul,to:[0,0],why:'start outside closed room'}));await tick();bridge.perceive.sync(true);edge.map();
 const before=structuredClone(w.host.engine.world.entities[soul.entityId].pose),proof:any[]=[];
 for(const capability of ['walk:reading-house/hall','enter the closed reading room','go inside the reading room','walk:reading-house','walk:g-reading-house']){
  const result:any=await accept(w.host,edge.act(soul,{capability}));proof.push({capability,result});
  if(process.env.ENTRY_PROOF)writeFileSync(process.env.ENTRY_PROOF,JSON.stringify(proof,null,2));
  assert.equal(result.accepted,false,JSON.stringify({capability,result}));assert.match(result.code,/^route\./);await tick();assert.deepEqual(w.host.engine.world.entities[soul.entityId].pose,before,'refusal does not move the body');
 }
 assert.equal(god.act({ops:[{op:'set',id:'reading-house',state:{doors:{'front-door':'open'}}}]}).accepted,true);await tick();bridge.perceive.sync(true);edge.map();
 const {caps,plans}=edge.coreA.binds(soul),root=caps.find(c=>c.id==='walk:reading-house');assert.equal(root?.available,true);
 const open:any=await accept(w.host,edge.act(soul,{capability:'enter the reading room'}));assert.equal(open.accepted,true,JSON.stringify(open));
 let receipt:any;for(let i=0;i<1800;i++){await tick(1);receipt=edge.receipt(soul.soulId,open.receipt.id);if(['completed','failed'].includes(receipt?.phase))break;}
 assert.equal(receipt.phase,'completed',JSON.stringify(receipt));const room=edge.places.byId.get('g-reading-house.hall')!,pose=w.host.engine.world.entities[soul.entityId].pose;
 assert.ok(inPoly(pose.p[0],pose.p[2],room.polygon),'open entry actually ends inside the room');
 proof.push({openRoot:root,openPlan:plans.get('walk:reading-house'),receipt,pose:structuredClone(pose)});if(process.env.ENTRY_PROOF)writeFileSync(process.env.ENTRY_PROOF,JSON.stringify(proof,null,2));
});
