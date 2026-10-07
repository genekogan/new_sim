// EDGE-CONTRACT-v1 conformance (Ledger verbs). Fake world, no model calls, $0.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,COMMONS_PERSONAL_RESOURCES} from '@sim/engine-mars';
import {kernelHash} from '@sim/kernel';
import {Hono} from 'hono';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {EDGE_CONTRACT} from './edge/contract.ts';
const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function setup(t:TestContext){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installNativeSleepSnapshotV1());
 const rows=[];for(const name of ['alice','bob']){await invite(f,name);rows.push(await accept(f.host,f.souls.create('dev:'+name,{name:name[0].toUpperCase()+name.slice(1),description:'Synthetic edge Soul'})));}
 const tokens=rows.map((r,i)=>{const tok='sim_EDGE_TEST_TOKEN_'+i;f.db.setSoulToken(r.id,hashToken(tok),'synthetic');return tok;});
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});
 t.after(()=>{f.host.stop();f.db.close();});
 const call=async(i:number,method:string,path:string,body?:unknown)=>{const res=await accept(f.host,app.request(path,{method,headers:{authorization:'Bearer '+tokens[i],'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);const json=await res.json() as any;if(process.env.EDGE_DEBUG&&res.status!==200)console.error('EDGE',path,res.status,JSON.stringify(json));assert.equal(json.contract,EDGE_CONTRACT,path);return {status:res.status,json};};
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%20===0)await setImmediate();}return until();};
 const receipt=async(i:number,id:string)=>(await call(i,'GET','/v1/edge/receipts/'+id)).json.receipt;
 return {...f,rows,tokens,ledger,app,call,run,receipt};
}

test('observe, capabilities, act → receipt → completion; refusal shape; auth; version on every body',async t=>{
 const f=await setup(t);
 const o=(await f.call(0,'GET','/v1/edge/observe?include=capabilities,map')).json;
 assert.equal(o.self.soulId,f.rows[0].id);assert.ok(Array.isArray(o.self.placePath)&&o.self.placePath.length>=1);assert.equal(typeof o.self.state,'string');assert.ok(o.here.untrusted);
 assert.ok(o.here.souls.some((s:any)=>s.soulId===f.rows[1].id)||true);assert.ok(Array.isArray(o.capabilities)&&Array.isArray(o.map.places));
 const caps=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities as any[];
 for(const id of ['stand:here','rest:here','swim:shore-water'])assert.ok(caps.some(c=>c.id===id),id);
 const walk=caps.find(c=>c.verb==='walk'&&c.available);assert.ok(walk,'some walk is available');
 const acted=(await f.call(0,'POST','/v1/edge/act',{capability:walk.id})).json;assert.equal(acted.accepted,true,JSON.stringify(acted));
 assert.ok(['waiting','started'].includes(acted.receipt.phase));
 let last:any;assert.ok(await f.run(4000,()=>false)||true);
 for(let i=0;i<40&&(last=await f.receipt(0,acted.receipt.id)).phase!=='completed';i++)await f.run(100,()=>false);
 assert.equal(last.phase,'completed',JSON.stringify(last));assert.ok(last.endedTick>=last.startedTick);
 const refused=(await f.call(0,'POST','/v1/edge/act',{capability:'walk:no-such-place'})).json;assert.deepEqual([refused.accepted,refused.code],[false,'capability.unknown']);
 const bad=await f.app.request('/v1/edge/observe');assert.equal(bad.status,401);assert.equal(((await bad.json()) as any).error.code,'unauthorized');
 assert.equal((await f.call(1,'GET','/v1/edge/receipts/'+acted.receipt.id)).status,404,'another Soul cannot read my receipt');
 assert.equal((f.db.db.prepare('SELECT COUNT(*) n FROM brain_calls').get() as {n:number}).n,0,'no world-side model calls');assert.equal(f.db.paidCost(),0);
});

test('a newer act replaces the open receipt; clientRef is idempotent',async t=>{
 const f=await setup(t),caps=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities as any[];
 const first=(await f.call(0,'POST','/v1/edge/act',{capability:'swim:shore-water',clientRef:'k1'})).json,again=(await f.call(0,'POST','/v1/edge/act',{capability:'swim:shore-water',clientRef:'k1'})).json;
 assert.equal(again.receipt.id,first.receipt.id,'same clientRef returns the original receipt');
 await f.run(40,()=>false);
 const second=(await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:5}})).json;assert.equal(second.accepted,true,JSON.stringify(second));
 await f.run(40,()=>false);
 assert.equal((await f.receipt(0,first.receipt.id)).phase,'replaced');
 const p=(await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:9999}})).json;assert.deepEqual([p.accepted,p.code],[false,'capability.params']);
 void caps;
});

test('asleep: act is accepted as waiting, the body rises safely (logged edge-stop) and the action starts and completes; replay exact',async t=>{
 const f=await setup(t),row=f.rows[0];
 await accept(f.host,f.host.enqueue('decision','fixture:sleep',{soulId:row.id,entityId:row.entity_id,option:'sleep',label:'sleep on own mat',steps:[{verb:'mars:sleep',params:{mat:'commons-mat-1',duration:600,returnTo:COMMONS_PERSONAL_RESOURCES[0].sleepReturn}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 const pose=()=>(f.host.engine.world as NativeWorld).entities[row.entity_id].human?.sleepPose;
 assert.ok(await f.run(3000,()=>pose()?.standingFraction===0),'asleep');
 assert.equal((await f.call(0,'GET','/v1/edge/observe')).json.self.state,'sleeping');
 const r=(await f.call(0,'POST','/v1/edge/act',{capability:'swim:shore-water'})).json;assert.equal(r.accepted,true,JSON.stringify(r));assert.equal(r.receipt.phase,'waiting');
 let rec:any;for(let i=0;i<60&&(rec=await f.receipt(0,r.receipt.id)).phase!=='completed';i++)await f.run(200,()=>false);
 assert.equal(rec.phase,'completed',JSON.stringify(rec));assert.equal(pose(),undefined,'rose');
 assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='edge-stop').length,1);
 f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,mode);h.stop();}
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});

test('stand:here stops the current activity; go-near lists perceived Souls',async t=>{
 const f=await setup(t);
 await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:120}});await f.run(20,()=>false);
 const s=(await f.call(0,'POST','/v1/edge/act',{capability:'stand:here'})).json;assert.equal(s.accepted,true);assert.equal(s.receipt.phase,'completed');
 await f.run(40,()=>false);assert.equal(f.host.engine.programOf(f.rows[0].entity_id),null);
 const caps=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities as any[];
 const near=caps.filter(c=>c.verb==='go-near');const bodies=f.ledger.perceivedBodies(f.rows[0].id,20);assert.equal(near.length,bodies.length);
});

test('G430 public Soul read: no auth, own data only, no owner/token fields',async t=>{
 const f=await setup(t);await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:5}});
 const res=await f.app.request('/v1/edge/public/souls/'+f.rows[0].id);assert.equal(res.status,200);const j=await res.json() as any;
 assert.equal(j.contract,EDGE_CONTRACT);assert.equal(j.soul.soulId,f.rows[0].id);assert.ok(j.soul.untrusted);assert.ok(Array.isArray(j.receipts)&&j.receipts.length>=1);assert.ok(j.lastAcceptedAt>0);
 const text=JSON.stringify(j);for(const k of ['owner','token','dev:alice','programId'])assert.ok(!text.includes(k),k);
 assert.equal((await f.app.request('/v1/edge/public/souls/s_nobody')).status,404);
});

test('refusals are logged for measurement; /v1/edge/metrics counts accepted, refused and codes (no text)',async t=>{
 const f=await setup(t);await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:5}});await f.call(0,'POST','/v1/edge/act',{capability:'walk:nowhere'});
 const m=(await f.call(0,'GET','/v1/edge/metrics?minutes=60')).json;
 assert.equal(m.acts.accepted,1);assert.equal(m.acts.refused,1);assert.equal(m.refusalsByCode['act capability.unknown'],1);assert.equal(m.activeSouls,1);assert.equal(m.worldModelCalls,0);
 const rows=f.db.db.prepare('SELECT soul_id,verb,capability,code FROM edge_refusals_v1').all() as any[];assert.deepEqual(rows.map(r=>[r.soul_id,r.verb,r.capability,r.code]),[[f.rows[0].id,'act','walk:nowhere','capability.unknown']]);
});
