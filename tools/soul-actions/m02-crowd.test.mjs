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

// M02: the batch's features together, in a crowded scene, against the same layout built from frozen v1 (inert) defs.
const out=process.env.SOUL_ACTIONS_OUT;
const V1={lamp:'core/floor-lamp@1',door:'core/door@1',board:'core/chalkboard@1',notice:'core/notice-board@1',tap:'core/shower@1',shower:'core/shower@1',sprinkler:'core/planter-box@1','bed-a':'core/planter-box@1','bed-b':'core/planter-box@1',piano:'core/piano@1'};
const V2={lamp:'core/floor-lamp@2',door:'core/door@2',board:'core/whiteboard@1',notice:'core/notice-board@2',tap:'core/garden-tap@1',shower:'core/beach-shower@1',sprinkler:'core/garden-sprinkler@1','bed-a':'core/garden-planter@1','bed-b':'core/garden-planter@1',piano:'core/piano@1'};
const LAYOUT={lamp:[1.2,1],door:[-1.4,1.6],board:[0,2.6],notice:[2.4,2.4],tap:[-2.4,-0.6],shower:[2.6,-1],sprinkler:[-0.6,-2.2],'bed-a':[0.8,-3],'bed-b':[-1.8,-3.2],piano:[3.2,0.8]};
async function scene(defs){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Crowd test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const ordinary=()=>edge.capabilities(soul).filter(c=>['stand:here','wave:here','rest:here','sit-ground:here'].includes(c.id)).map(c=>c.id).sort();
 const absent=await here(),ord0=ordinary();
 const far=Object.entries(defs).flatMap(([k,def],j)=>Array.from({length:100},(_,i)=>({op:'place',def,name:`far-${k}-${i}`,p:[150+j*25+i%10*2,150+Math.floor(i/10)*2],...(k==='board'&&def.includes('whiteboard')?{state:{text:'far note '+i,textBy:'s_x'}}:{})})));
 for(let i=0;i<far.length;i+=100){const r=god.act({ops:far.slice(i,i+100)});assert.equal(r.accepted,true,JSON.stringify(r).slice(0,300));}await tick(45);const distant=await here();
 const b=f.host.engine.world.entities[soul.entityId],[x,z]=[b.pose.p[0],b.pose.p[2]];
 assert.equal(god.act({ops:Object.entries(defs).map(([k,def])=>({op:'place',def,name:k,p:[x+LAYOUT[k][0],z+LAYOUT[k][1]],...(k==='board'&&def.includes('whiteboard')?{state:{text:'Picnic at noon',textBy:'s_x'}}:{})}))}).accepted,true);await tick(45);
 const near=await here(),caps=edge.capabilities(soul),t0=performance.now();for(let i=0;i<20;i++)await here();const hereMs=(performance.now()-t0)/20;
 const report={absent:JSON.stringify(absent).length,distant1000:JSON.stringify(distant).length,crowded:JSON.stringify(near).length,objects:near.objects.map(o=>o.kind+(o.state?JSON.stringify(o.state):'')),doHere:near.doHereCoverage,doHereIds:near.doHere.map(c=>c.id.replace(/e_[0-9a-f]+/,'#')),ordinaryBefore:ord0,ordinaryAfter:ordinary(),capsTotal:caps.length,herePerRequestMs:+hereMs.toFixed(2),
  leaks:/far note|far-board|Picnic/.test(JSON.stringify(distant))||/Picnic/.test(JSON.stringify(near)),violations:f.host.engine.runtime.violations.length};
 comms.close();f.host.stop();f.db.close();return report;
}
test('M02 crowded scene: v1 layout vs the batch features, 1,000 distant copies each', {timeout:240000}, async()=>{
 const v1=await scene(V1),v2=await scene(V2);
 assert.equal(v2.leaks,false,'no board words in anyone\'s here frame, near or far');
 assert.equal(v2.distant1000,v2.absent,'1,000 distant interactive things add nothing');
 assert.deepEqual(v2.ordinaryAfter,v2.ordinaryBefore,'ordinary offers still offered');
 assert.equal(v2.violations,0);
 const report={v1,v2,delta:{crowdedBytes:v2.crowded-v1.crowded,distantBytes:v2.distant1000-v2.absent,v1DistantBytes:v1.distant1000-v1.absent}};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/crowd.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));
});
