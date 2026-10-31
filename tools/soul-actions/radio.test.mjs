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

// Entry 37: a radio turned on and off at its power knob and tuned at its tuning knob, by hand; on/station change only at contact.
const out=process.env.SOUL_ACTIONS_OUT;
const STATIONS=['quiet piano','dance band','evening talk'];
test('radio: power and tuning knobs by hand, station cycle, refusal, interruption, persistence, bounded perception', {timeout:180000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Radio test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 // 100 distant radios, all playing, stations mixed: nothing of them reaches this Soul
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/radio@2',name:`distant-radio-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2],state:{on:true,station:STATIONS[i%3]}}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);const far=await here();
 assert.equal(JSON.stringify(far).length,JSON.stringify(absent).length,'distant radios add 0 bytes');assert.ok(!/radio/.test(JSON.stringify(far)),'no distant radio in here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant radio offers');
 // the frozen v1 tabletop radio is unchanged (no hand contact, no station)
 const v1=god.model.library.get?.('core/radio@1')??god.model.resolvedDef('core/radio@1');
 assert.ok(v1&&!v1.tags.includes('hand-operated')&&!v1.state.station,'core/radio@1 unchanged');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 // the radio faces the Soul (front +z turned by r = π towards -z); a tap beside it for the shared hand contact
 assert.equal(god.act({ops:[{op:'place',def:'core/radio@2',name:'radio',p:[ax+0.3,az-1.6],r:0},{op:'place',def:'core/garden-tap@1',name:'tap',p:[ax-1.8,az+1.4]}]}).accepted,true);await tick(45);
 const state=n=>god.model.get(n).state,id=n=>god.model.get(n).id;
 const knob=tint=>{const e=god.model.get('radio'),def=god.model.resolvedDef(e.def),wp=god.model.worldPose(e),s=def.make.args.shapes.find(x=>x.tint===tint),c=Math.cos(wp.yaw),sn=Math.sin(wp.yaw),[x,y,z]=s.at;return [wp.x+x*c+z*sn,wp.y+y,wp.z-x*sn+z*c];};
 const near=await here(),row0=near.objects.find(o=>o.id===id('radio'));
 assert.deepEqual(row0?.state,{on:false},'an off radio shows only that it is off');
 const act=async(cap,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:cap})}));const b=await r.json();assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const finish=async(r,name,field,want,limit=600)=>{let motion=null,early=false,root=null;for(let n=0;n<limit;n++){const m=body().human?.handActuator;if(m){motion=m;root=[...body().pose.p];if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.6&&state(name)[field]===want)early=true;}const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {motion,early,root,phase:edge.receipt(soul.soulId,r.receipt.id).phase};};
 await act('object:radio:switch-off',false);
 await act('object:radio:change-station',false);
 // interruption before contact: nothing changes
 await act('object:radio:switch-on');for(let n=0;n<300&&!body().human?.handActuator;n++)await tick(1);await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);
 assert.equal(state('radio').on,false,'interrupted before contact: radio stays off');
 const results=[];
 const run=async(cap,name,field,want,tint)=>{
  const before=state(name)[field],r=await act(cap);assert.equal(state(name)[field],before,'admission changes nothing remotely');
  const x=await finish(r,name,field,want);
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.ok(x.motion,'actual hand contact ran');assert.equal(x.early,false,'no change before contact');
  assert.equal(state(name)[field],want);
  if(tint){const k=knob(tint),d=Math.hypot(...x.motion.at.map((v,i)=>v-k[i]));assert.ok(d<0.01,`the hand goes to the ${tint} knob (${d.toFixed(3)} m)`);}
  assert.equal(body().human?.handActuator,undefined);
  results.push({cap,want,knob:tint??null,hold:x.motion.hold??0,handAt:x.motion.at.map(v=>+v.toFixed(3)),root:x.root.map(v=>+v.toFixed(3))});return x;
 };
 await run('object:radio:switch-on','radio','on',true,'valve');
 const onRow=(await here()).objects.find(o=>o.id===id('radio'));assert.deepEqual(onRow?.state,{on:true,station:'quiet piano'},'on: the station in a few words');
 await run('object:tap:switch-on','tap','on',true,null);
 // plain words the way a Soul says them resolve to the tuning knob of this radio
 const words={};for(const w of ['change the station','change the radio station','tune the radio','change station on the radio','turn off the radio']){const r=await (await app.request('/v1/edge/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:w,params:{}})})).json();words[w]=r.resolve?.would?.capability??r.resolve?.code??JSON.stringify(r).slice(0,200);}
 for(const w of ['change the station','change the radio station','tune the radio','change station on the radio'])assert.equal(words[w],`object:${id('radio')}:change-station`,`"${w}": ${words[w]}`);
 assert.equal(words['turn off the radio'],`object:${id('radio')}:switch-off`);
 const tuned=[];
 for(const want of ['dance band','evening talk','quiet piano','dance band']){const x=await run('object:radio:change-station','radio','station',want,'tuner');tuned.push(x);assert.equal(x.motion.hold,0.9,'the hand holds the tuning knob while it turns');}
 const nearOn=await here(),onRow2=nearOn.objects.find(o=>o.id===id('radio'));assert.deepEqual(onRow2?.state,{on:true,station:'dance band'});
 // power and tuning are worked from one place: no shuffle between the knobs
 const roots=results.filter(r=>r.knob).map(r=>r.root),spread=Math.max(...roots.map(p=>Math.hypot(p[0]-roots[0][0],p[2]-roots[0][2])));
 assert.ok(spread<0.06,`one stand point for both knobs (${spread.toFixed(3)} m) ${JSON.stringify(results)}`);
 await run('object:radio:switch-off','radio','on',false,'valve');
 const offRow=(await here()).objects.find(o=>o.id===id('radio'));assert.deepEqual(offRow?.state,{on:false});
 await act('object:radio:change-station',false);
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);
 assert.equal(restored.get('radio').state.on,false);assert.equal(restored.get('radio').state.station,'dance band');assert.equal(restored.get('tap').state.on,true);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',plainWords:words,hereBytes:{absent:JSON.stringify(absent).length,distant100Radios:JSON.stringify(far).length,nearbyOff:JSON.stringify(near).length,nearbyOn:JSON.stringify(nearOn).length},rows:{off:row0,on:onRow2},standSpread:+spread.toFixed(3),results,
  checks:['off radio: switch-off and change-station refused','interruption before contact keeps it off','power knob for on/off, tuning knob for the station (hand target within 1 cm)','tuning hand holds 0.9 s','station cycles quiet piano > dance band > evening talk > quiet piano','one stand point for both knobs','no change before contact','radio and tap via the same hand contact','nearby: {on:false} / {on:true, station}','snapshot persistence (on, station)','core/radio@1 unchanged','100 distant radios (all on, mixed stations): no offers, +0 here bytes','zero native violations']};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));
});
