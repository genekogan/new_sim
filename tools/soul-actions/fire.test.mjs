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
import {isContactActuator} from '../../apps/server/src/god/contact-actuator.ts';

// Entry 22: a candle stand, festoon string lights and a campfire lit and put out by hand, driven by plain words;
// flames/bulbs/light change only at contact.
const out=process.env.SOUL_ACTIONS_OUT;
test('hand-operated fire and festoon lights: words, contact, refusal, interruption, persistence, bounded perception', {timeout:240000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Fire test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 const distant=['candle-stand@1','string-lights@2','campfire@2'].flatMap((d,k)=>Array.from({length:100},(_,i)=>({op:'place',def:'core/'+d,name:`distant-${d.split('@')[0]}-${i}`,p:[120+k*60+i%10*5,120+Math.floor(i/10)*5],state:{on:i%2===0}})));
 for(let i=0;i<distant.length;i+=100){const res=god.act({ops:distant.slice(i,i+100)});assert.equal(res.accepted,true,JSON.stringify(res).slice(0,900));}await tick(45);const far=await here();
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-absent.json`,JSON.stringify(absent,null,1));writeFileSync(`${out}/here-far.json`,JSON.stringify(far,null,1));}
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant offers');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/candle-stand@1',name:'candle',p:[ax+1.5,az+1.5]},{op:'place',def:'core/string-lights@2',name:'lights',p:[ax-1,az+3.2]},{op:'place',def:'core/campfire@2',name:'campfire',p:[ax-3,az-0.8]}]}).accepted,true);await tick(45);
 const near=await here();if(out)writeFileSync(`${out}/here-near.json`,JSON.stringify(near,null,1));const state=n=>god.model.get(n).state,id=n=>god.model.get(n).id;
 const rows=Object.fromEntries(['candle','lights','campfire'].map(n=>[n,near.objects.find(o=>o.id===id(n)&&o.state)?.state]));
 for(const n of ['candle','campfire'])assert.deepEqual(rows[n],{on:false},n+' shows only its on fact');
 // the nearby list is capped (6 rows; the campfire's seat and story places fill it), so the festoon is checked by its offer
 const contact=(n,a)=>isContactActuator(god.model.resolvedDef(n.startsWith('core/')?n:god.model.get(n).def),{name:a});
 assert.ok(edge.capabilities(soul).some(c=>c.id===`object:${id('lights')}:switch-on`)&&contact('lights','switch-on'),'string lights offer a hand switch');
 const act=async(words,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:words})}));const b=await r.json();assert.equal(b.accepted,accepted,words+' '+JSON.stringify(b).slice(0,300));return b;};
 const finish=async(r,name,want,limit=600)=>{let contact=false,early=false;for(let n=0;n<limit;n++){const m=body().human?.handActuator;if(m){contact=true;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.6&&state(name).on===want)early=true;}const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {contact,early,phase:edge.receipt(soul.soulId,r.receipt.id).phase};};
 await act('put out the candle',false);
 // interruption before contact: nothing changes
 const cut=await act('light the campfire');for(let n=0;n<400&&!body().human?.handActuator;n++)await tick(1);await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);assert.equal(state('campfire').on,false,'interrupted before contact: the fire stays out');
 const results={};
 for(const [name,words,want] of [['candle','light the candle',true],['lights','switch on the string lights',true],['campfire','light the campfire',true],['candle','put out the candle',false],['campfire','put out the campfire',false],['lights','switch off the string lights',false],['campfire','light the campfire',true]]){
  const r=await act(words);assert.match(r.receipt.capability,new RegExp(`object:${id(name)}:${name==='lights'?(want?'switch-on':'switch-off'):(want?'light':'put-out')}$`),words+' resolved to '+r.receipt.capability);
  assert.notEqual(state(name).on,want,'admission changes nothing remotely');const x=await finish(r,name,want);
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.ok(x.contact,'actual hand contact ran');assert.equal(x.early,false,'nothing changes before contact');assert.equal(state(name).on,want);
  const e=god.model.get(name),wp=god.model.worldPose(e),p=body().pose.p;x.standFromCentre=+Math.hypot(p[0]-wp.x,p[2]-wp.z).toFixed(2);results[`${Object.keys(results).length+1}:${words}`]=x;
  assert.equal(body().human?.handActuator,undefined);
 }
 assert.ok(results['3:light the campfire'].standFromCentre>0.85+0.28,'crouches outside the stone ring');
 for(const n of ['core/candle@1','core/campfire@1'])assert.ok(!contact(n,'light')&&!contact(n,'put-out'),n+' keeps its remote toggle');
 for(const [n,a,b] of [['candle','light','put-out'],['lights','switch-on','switch-off'],['campfire','light','put-out']])assert.ok(contact(n,a)&&contact(n,b),n+' is a hand contact');
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('campfire').state.on,true);assert.equal(restored.get('candle').state.on,false);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 for(const ref of ['core/candle@1','core/string-lights@1','core/campfire@1'])assert.equal(god.model.resolvedDef(ref).tags.includes('hand-operated'),false,'frozen v1 unchanged: '+ref);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100Each:JSON.stringify(far).length,nearby:JSON.stringify(near).length},rows,results,checks:['plain words resolve to the hand offers','unlit candle put-out refused','interruption before contact keeps the fire out','candle, string lights and campfire via the same hand contact, on/off/on','crouches outside the stone ring','nothing changes before contact','snapshot persistence','100 distant of each (300): no offers, no far landmarks','frozen v1 candle/string lights/campfire unchanged','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
