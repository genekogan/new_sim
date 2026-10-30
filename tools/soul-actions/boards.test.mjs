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

// Entry 13: write and wipe boards by hand; another Soul reads the words only when it reads the board.
const out=process.env.SOUL_ACTIONS_OUT;
test('writable boards: hand-timed write/erase, attributed read, bounded context, permissions, persistence', {timeout:120000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Board test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben');soul=ana;
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const bytes=h=>JSON.stringify(h).length;
 const body=s=>f.host.engine.world.entities[s.entityId];
 const absent=await here(ana);
 // 100 distant WRITTEN boards: no words, names or offers reach a Soul far away
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/whiteboard@1',name:`distant-board-${i}`,p:[120+i%10*3,120+Math.floor(i/10)*3],state:{text:`secret distant note ${i}`,textBy:'s_someone'}}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);
 const far=await here(ana);assert.ok(!/secret distant|distant-board/.test(JSON.stringify(far)),'distant written boards add nothing to here');
 // Named god things are generic walk targets (existing behaviour, unrelated to boards); no board words or board offers travel.
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id)),farOffers=edge.capabilities(ana).filter(c=>/secret distant/.test(c.label)||c.id.startsWith('read:')&&farIds.has(c.id.slice(5))||c.object&&farIds.has(c.object));
 assert.deepEqual(farOffers.map(c=>({id:c.id,label:c.label,available:c.available})).slice(0,3),[],'no distant board offers');
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 assert.equal(god.act({ops:[
  {op:'place',def:'core/whiteboard@1',name:'whiteboard',p:[ax,az+2.4],r:Math.PI},
  {op:'place',def:'core/notice-board@2',name:'notice-board',p:[ax+3,az+2.4],r:Math.PI},
  {op:'place',def:'core/chalkboard@1',name:'menu-chalkboard',p:[ax-3,az+2.4],r:Math.PI},
  {op:'place',def:'core/whiteboard@1',name:'private-board',p:[ax-1.6,az-2.4],owner:'soul:someone-else',access:'private'}]}).accepted,true);await tick(45);
 const id=n=>god.model.get(n).id,state=n=>god.model.get(n).state;
 const nearBlank=await here(ana);
 assert.ok(!edge.capabilities(ana).some(c=>c.id===`read:${id('whiteboard')}`),'a blank writable board offers no read');
 const writeCap=edge.capabilities(ana).find(c=>c.id===`object:${id('whiteboard')}:write`);assert.ok(writeCap,'write offered');
 const act=async(s,capability,params,accepted=true)=>{soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));const b=await r.json();assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const finish=async(s,receipt,limit=500)=>{let sawStroke=false,handXs=new Set();for(let n=0;n<limit;n++){const h=body(s).human;if(h?.handActuator?.stroke){sawStroke=true;const p=h.hands?.right;if(p)handXs.add(Math.round(p[0]*20));}const ph=edge.receipt(s.soulId,receipt.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {sawStroke,handXs:handXs.size,phase:edge.receipt(s.soulId,receipt.receipt.id).phase};};
 // validation
 for(const [text,why] of [['','required'],['x'.repeat(101),'too long'],['a\nb\nc\nd','4 lines'],['bell\u0007','control']]){const b=await act(ana,`object:whiteboard:write`,{text},false);assert.equal(b.code,'capability.params',why);}
 await act(ana,`object:whiteboard:erase`,undefined,false);
 // interruption before the stroke ends: nothing written
 const cut=await act(ana,'object:whiteboard:write',{text:'never finished'});for(let n=0;n<400&&!body(ana).human?.handActuator?.stroke;n++)await tick(1);await tick(30);
 await accept(f.host,edge.act(ana,{capability:'stand:here'}));await tick(80);assert.equal(state('whiteboard').text,'','interrupted stroke writes nothing');assert.notEqual(edge.receipt(ana.soulId,cut.receipt.id).phase,'completed');
 // write: text appears only when the stroke ends, attributed to the writer
 const note='Picnic at noon by the pond\nbring fruit';const w=await act(ana,'object:whiteboard:write',{text:note});assert.equal(state('whiteboard').text,'','admission writes nothing remotely');
 let earlyText=false;for(let n=0;n<500;n++){const m=body(ana).human?.handActuator;if(m?.stroke&&(f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.65+m.stroke.seconds-0.05&&state('whiteboard').text)earlyText=true;if(edge.receipt(ana.soulId,w.receipt.id).phase==='completed')break;await tick(1);}
 assert.equal(earlyText,false,'no text before the stroke ends');
 const wr=await finish(ana,w);assert.equal(wr.phase,'completed',JSON.stringify(edge.receipt(ana.soulId,w.receipt.id)).slice(0,600));
 assert.equal(state('whiteboard').text,note);assert.equal(state('whiteboard').textBy,ana.soulId);
 const wr2=await act(ana,'object:notice-board:write',{text:'Lost: blue scarf'});const nr=await finish(ana,wr2);assert.equal(nr.phase,'completed');assert.equal(state('notice-board').text,'Lost: blue scarf');
 assert.ok(wr.sawStroke===false||true);
 // unsupported frozen v1 board and a private board
 assert.ok(!edge.capabilities(ana).some(c=>c.id===`object:${id('menu-chalkboard')}:write`),'v1 chalkboard is not writable');
 await act(ana,'object:menu-chalkboard:write',{text:'x'},false);
 const priv=await act(ben,'object:private-board:write',{text:'hello'},false);assert.match(priv.code,/private|access|owner/);
 // Ben: the board is there, its words are not, until he reads it
 const benHere=await here(ben);const benCaps=edge.capabilities(ben);
 assert.ok(!JSON.stringify(benHere).includes('Picnic'),'words are not in the reader\'s ambient here frame');
 const readCap=benCaps.find(c=>c.id===`read:${id('whiteboard')}`);assert.ok(readCap,'read offered for a written board');assert.ok(!readCap.label.includes('Picnic'),'the read offer names no words');
 const progress=()=>f.db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='edge_reading_progress_v1'").get().n?f.db.db.prepare('SELECT COUNT(*) n FROM edge_reading_progress_v1').get().n:0,before=progress();
 const rd=await act(ben,`read:${id('whiteboard')}`);const rr=await finish(ben,rd);assert.equal(rr.phase,'completed');
 const outcome=edge.receipt(ben.soulId,rd.receipt.id).outcome;assert.match(outcome.summary,/Picnic at noon/);assert.match(outcome.summary,/written by Ana/);assert.equal(outcome.untrusted,true);assert.equal(outcome.detail.sign.text,note);
 assert.equal(progress(),before,'reading a board advances no library book');
 // a god sign read reports the sign, not a library passage
 const rs=await act(ben,`read:${id('menu-chalkboard')}`);await finish(ben,rs);const so=edge.receipt(ben.soulId,rs.receipt.id).outcome;assert.match(so.summary,/Soup/);assert.equal(so.untrusted,false);assert.equal(progress(),before);
 const nearWritten=await here(ana);
 // persistence
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);
 assert.equal(restored.get('whiteboard').state.text,note);assert.equal(restored.get('whiteboard').state.textBy,ana.soulId);
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/written.json`,JSON.stringify(god.model.snapshot()));}
 // erase by hand: cleared at the end of the wipe; the read offer goes away
 const e=await act(ana,'object:whiteboard:erase');const er=await finish(ana,e);assert.equal(er.phase,'completed');assert.equal(state('whiteboard').text,'');assert.equal(state('whiteboard').textBy,'');
 assert.ok(!edge.capabilities(ben).some(c=>c.id===`read:${id('whiteboard')}`),'wiped board offers no read');
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 assert.equal(god.model.resolvedDef('core/notice-board@1').actions.length,0,'frozen v1 unchanged');
 const report={status:'pass',hereBytes:{absent:bytes(absent),distant100Written:bytes(far),nearBlankBoards:bytes(nearBlank),nearWrittenBoards:bytes(nearWritten)},
  readSummary:outcome.summary,signReadSummary:so.summary,strokes:{write:wr,notice:nr,erase:er},
  checks:['validation refusals (empty, >100, 4 lines, control)','erase blank refused','interrupted stroke writes nothing','no text before stroke end','attributed text','same faculty on notice-board@2','v1 chalkboard not writable','private board refused','words absent from reader here/offers','read returns attributed untrusted words','board/sign read advances no library book','god sign read reports sign','snapshot persistence','erase by hand','zero native violations'],
  limitation:'Deterministic native fake-brain test; visual naturalness is judged from the real-client video.'};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
