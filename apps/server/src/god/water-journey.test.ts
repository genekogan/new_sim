// The owner's west-lake swim starts on the actual Eden jetty. The water outline
// is not the wetted bank: a guessed shore used to finish >6m from a usable entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {fixture,factory,invite,accept} from '../../test/native-owner-fixture.ts';
import {GodMode} from './god.ts';
import {GroundHost,installGroundCapabilities} from './ground-host.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */
test('Eden west-lake jetty to swimming and back uses a real bank and finishes both legs', {timeout:180000}, async t=>{
 const genesis=JSON.parse(readFileSync(new URL('../../../../worlds/templates/eden-2026.json',import.meta.url),'utf8'));
 const w=fixture(':memory:',factory,{durableClockV1:true});w.brain.quiesce();
 const god=new GodMode(w.db,{genesis,worldId:w.host.worldId,ownerId:'owner',tick:()=>w.host.engine.world.tick,emit(){}});
 new GroundHost(w.db,w.host,god);const edge=new EdgeLedger(w.host,w.db);
 installGroundCapabilities(edge as never,god,w.host);installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
 t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
 const tick=async(n:number)=>{for(let i=0;i<n;i++){w.host.tickOnce();if(i%20===0){await setImmediate();w.host.drainInputs();}}};
 await tick(4);await invite(w,'swimmer');const row:any=await accept(w.host,w.souls.create('dev:swimmer',{name:'Swimmer',description:'takes a lake swim'}));await tick(4);
 const s={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner},E=w.host.engine as any;
 await accept(w.host,w.host.enqueue('edge-relocate','test:jetty',{soulId:row.id,entityId:row.entity_id,to:[-122,26],why:'start at actual west-lake jetty'}));await tick(4);
 const start=[...E.world.entities[row.entity_id].pose.p];
 const a:any=await accept(w.host,edge.act(s,{capability:'swim:land-west-lake'}));assert.equal(a.accepted,true,JSON.stringify(a));
 let receipt:any;
 for(let i=0;i<20000;i++){receipt=edge.receipt(row.id,a.receipt.id);if(receipt&&['completed','failed','cancelled'].includes(receipt.phase))break;await tick(1);}
 assert.equal(receipt?.phase,'completed',JSON.stringify(receipt));
 assert.equal(E.world.entities[row.entity_id].human.activity,'tread','actually swimming at completion');
 const swimAt=[...E.world.entities[row.entity_id].pose.p];assert.ok(Math.hypot(swimAt[0]-start[0],swimAt[2]-start[2])>5,'left the jetty');
 await accept(w.host,w.host.enqueue('decision','test:return',{soulId:row.id,entityId:row.entity_id,option:'return',label:'return to jetty',steps:[{verb:'mars:ground_travel',params:{x:-122,z:26,level:0}}],reevalTicks:1e9,fallback:false,trigger:'test:return'}));
 let back=false;
 for(let i=0;i<20000;i++){await tick(1);const b=E.world.entities[row.entity_id];if(Math.hypot(b.pose.p[0]+122,b.pose.p[2]-26)<.6&&b.human.activity==='idle'){back=true;break;}}
 assert.ok(back,`returned to dry jetty: ${JSON.stringify(E.world.entities[row.entity_id])}`);
 assert.deepEqual(E.runtime.violations,[]);
});
