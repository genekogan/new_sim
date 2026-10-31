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

// Entry 33: a standing torch and a wall torch lit and put out by hand (entry 22's hand-lit fire), and a neon sign switched
// on and off by hand at its switch box; plain words; the change only at contact; the sign's words only for a nearby Soul.
const out=process.env.SOUL_ACTIONS_OUT;
test('torches and a neon sign by hand: words, contact, refusal, interruption, persistence, bounded words, +0 distant bytes', {timeout:300000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Torch test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 // 100 distant of each, all lit; the signs carry words that must never reach this Soul
 const defs=['standing-torch@1','wall-torch@1','neon-sign@1'];
 const distant=defs.flatMap((d,k)=>Array.from({length:100},(_,i)=>({op:'place',def:'core/'+d,name:`distant-${d.split('@')[0]}-${i}`,p:[120+k*60+i%10*5,120+Math.floor(i/10)*5],state:d.startsWith('neon')?{on:true,text:`Far sign ${i}`}:{on:true}})));
 for(let i=0;i<distant.length;i+=100){const res=god.act({ops:distant.slice(i,i+100)});assert.equal(res.accepted,true,JSON.stringify(res).slice(0,900));}await tick(45);const far=await here();
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-absent.json`,JSON.stringify(absent,null,1));writeFileSync(`${out}/here-far.json`,JSON.stringify(far,null,1));}
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant object offers (named things stay generic walk targets, as before)');
 assert.ok(!JSON.stringify(far).includes('Far sign')&&!JSON.stringify(edge.capabilities(soul)).includes('Far sign'),'no distant words anywhere');
 assert.equal(JSON.stringify(far).length,JSON.stringify(absent).length,'+0 bytes for 300 distant lit fixtures');
 // authoring: the words are bounded (32 characters)
 const tooLong=god.act({ops:[{op:'place',def:'core/neon-sign@1',name:'long',p:[60,60],state:{text:'x'.repeat(33)}}]});assert.equal(tooLong.accepted,false,'33 characters refused');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 const nearOps={ops:[{op:'place',def:'core/standing-torch@1',name:'torch',p:[ax+1.6,az+1.2]},{op:'place',def:'core/garden-wall@1',name:'back-wall',shape:{path:[[ax-3.6,az+1.9],[ax-0.4,az+1.9]]},params:{height:2.2,thickness:0.35}},{op:'place',def:'core/wall-torch@1',name:'wall-torch',p:[ax-1.8,az+1.6],r:Math.PI},
  {op:'place',def:'core/neon-sign@1',name:'neon',p:[ax+0.4,az+3.0],r:Math.PI,state:{text:'Night\u0007 Garden\nopen\nlate'}},{op:'place',def:'core/neon-sign@1',name:'neon-6m',p:[ax-6.2,az+0.5],state:{on:true,text:'Six metres'}}]};const placed=god.act(nearOps);assert.equal(placed.accepted,true,JSON.stringify(placed).slice(0,900));
 await tick(45);
 const near=await here();if(out)writeFileSync(`${out}/here-near.json`,JSON.stringify(near,null,1));const state=n=>god.model.get(n).state,id=n=>god.model.get(n).id;
 const rowOf=n=>near.objects.find(o=>o.id===id(n)&&(o.state||o.words));
 assert.deepEqual(rowOf('torch')?.state,{on:false},'torch shows only its on fact');assert.equal(rowOf('torch')?.words,undefined);
 const sign=rowOf('neon');assert.deepEqual(sign?.state,{on:false},'sign shows its on fact');
 assert.deepEqual(sign?.words,{text:'Night Garden / open',by:"the world's maker",untrusted:true},'bounded, cleaned, attributed, untrusted words');
 assert.ok(JSON.stringify(sign.words).length<=120,'words ≤ 120 B');
 assert.equal(near.objects.find(o=>o.id===id('neon-6m'))?.words,undefined,'no words at 6 m');assert.ok(!JSON.stringify(near).includes('Six metres'),'the 6 m sign says nothing here');
 assert.ok(!JSON.stringify(edge.capabilities(soul)).includes('Night Garden'),'words never in offers');
 // the 6 m sign goes (two signs would make "switch off the neon sign" pick the lit one, which is right but not this test)
 assert.equal(god.act({ops:[{op:'remove',id:id('neon-6m')}]}).accepted,true);await tick(80);
 const contact=(n,a)=>isContactActuator(god.model.resolvedDef(n.startsWith('core/')?n:god.model.get(n).def),{name:a});
 const act=async(words,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:words})}));const b=await r.json();if(accepted!==null)assert.equal(b.accepted,accepted,words+' '+JSON.stringify(b).slice(0,300));return b;};
 const finish=async(r,name,want,limit=600)=>{let contact=false,early=false,hand=null,turnAtReach=null;for(let n=0;n<limit;n++){const m=body().human?.handActuator;if(m){if(!contact){const b=body(),want=Math.atan2(m.at[2]-b.pose.p[2],m.at[0]-b.pose.p[0]);turnAtReach=+(Math.abs(((want-b.pose.yaw+Math.PI*3)%(Math.PI*2))-Math.PI)*180/Math.PI).toFixed(1);}contact=true;hand=m.at;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.6&&state(name).on===want)early=true;}const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {contact,early,hand,turnAtReach,phase:edge.receipt(soul.soulId,r.receipt.id).phase};};
 // putting out an unlit torch, switching off a dark sign: refused (by capability id, so the words cannot pick another)
 for(const [n,a] of [['torch','put-out'],['wall-torch','put-out'],['neon','switch-off']]){const r=await act(`object:${id(n)}:${a}`,false);assert.equal(r.code,'object.state',JSON.stringify(r).slice(0,300));}
 // two torches in reach: "light the torch" asks which one (both offered), rather than guessing
 {const r=await act('light the torch',false);assert.equal(r.code,'place.ambiguous');assert.deepEqual(r.did_you_mean.map(c=>c.id).sort(),[`object:${id('torch')}:light`,`object:${id('wall-torch')}:light`].sort());}
 // interruption before contact: nothing changes
 const cut=await act('light the standing torch');for(let n=0;n<400&&!body().human?.handActuator;n++)await tick(1);await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);assert.equal(state('torch').on,false,'interrupted before contact: the torch stays out');
 const results={};
 for(const [name,words,want,cap] of [['torch','light the standing torch',true,'light'],['wall-torch','light the wall torch',true,'light'],['neon','switch on the neon sign',true,'switch-on'],['neon','switch off the neon sign',false,'switch-off'],['torch','put out the standing torch',false,'put-out'],['wall-torch','put out the wall torch',false,'put-out'],['neon','turn on the neon sign',true,'switch-on'],['torch','light the standing torch',true,'light']]){
  const r=await act(words);assert.match(r.receipt.capability,new RegExp(`object:${id(name)}:${cap}$`),words+' resolved to '+r.receipt.capability);
  assert.notEqual(state(name).on,want,'admission changes nothing remotely');const x=await finish(r,name,want);
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.ok(x.contact,'actual hand contact ran');assert.equal(x.early,false,'nothing changes before contact');assert.equal(state(name).on,want);
  const p=body().pose.p;x.stand=[+p[0].toFixed(2),+p[2].toFixed(2)];x.handHeight=+x.hand[1].toFixed(3);x.standFromHand=+Math.hypot(p[0]-x.hand[0],p[2]-x.hand[2]).toFixed(2);results[`${Object.keys(results).length+1}:${words}`]=x;
  assert.equal(body().human?.handActuator,undefined);
 }
 for(const x of Object.values(results))assert.ok(x.handHeight>=1.15&&x.handHeight<=1.6,'hand at a natural standing height: '+x.handHeight);
 // take 4: the body already faces the hand point when the reach starts (it turned on arrival), so the reach is never added
 // to a body turn — the wall torch approached along its wall used to leave ~40° for the reach to turn through
 for(const [k,x] of Object.entries(results))assert.ok(x.turnAtReach!==null&&x.turnAtReach<=4,k+' faces the hand point before reaching: '+x.turnAtReach+'°');
 // the wall torch is reached from in front, never from beside it against the wall (stand points clear of the wall)
 for(const k of ['2:light the wall torch','6:put out the wall torch']){const x=results[k];assert.ok(x.stand[1]<x.hand[2]-0.3,k+' stands in front of the wall torch: '+JSON.stringify(x.stand));assert.ok(f.host.engine.clearanceAtV1(x.stand[0],x.stand[1])>=0.28,k+' clear of the wall');}
 for(const [n,a,b] of [['torch','light','put-out'],['wall-torch','light','put-out'],['neon','switch-on','switch-off']])assert.ok(contact(n,a)&&contact(n,b),n+' is a hand contact');
 const lit=await here();assert.deepEqual(lit.objects.find(o=>o.id===id('neon')&&o.state)?.state,{on:true});
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('torch').state.on,true);assert.equal(restored.get('wall-torch').state.on,false);assert.equal(restored.get('neon').state.on,true);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 for(const ref of ['core/candle@1','core/campfire@1'])assert.ok(!contact(ref,'light')&&!contact(ref,'put-out'),ref+' keeps its remote toggle');
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100Each:JSON.stringify(far).length,nearby:JSON.stringify(near).length,nearbyMinusAbsent:JSON.stringify(near).length-JSON.stringify(absent).length,wordsField:JSON.stringify(sign.words).length},
  rows:{torch:rowOf('torch'),neon:sign},results,
  checks:['plain words resolve to the hand offers','"light the torch" with two torches in reach asks which (both offered)','putting out an unlit torch and switching off a dark sign refused','interruption before contact keeps the torch out','standing torch, wall torch and neon sign via the same hand contact, on/off/on','hand height 1.15–1.6 m at every contact','the wall torch reached from in front, clear of its wall','the body faces the hand point (≤ 4°) when every reach starts','nothing changes before contact','snapshot persistence','100 distant of each (300, all lit, signs with words): +0 bytes, no offers, no words','33-character text refused at authoring; control characters removed; a third line dropped','words only within the nearby rule (none at 6 m), attributed and untrusted, never in offers','frozen v1 candle/campfire unchanged','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
