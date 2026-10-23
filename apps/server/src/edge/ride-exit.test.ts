// RIDE-EXIT (Gene's live review 2026-10-23, findings 4-6): a Soul whose balloon has landed stood "riding" in the basket for
// minutes and every request failed actor.busy. Deterministic: force the landing while the engine's carrier step still holds
// the body (the door stays taken), then check the request during landing, `leave`, the set-down within 30 s and the receipt.
import test from 'node:test';import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@sim/engine-mars';
import {Hono} from 'hono';import {fixture,invite,accept} from '../../test/native-owner-fixture.ts';
import {LivingWorld} from '../living.ts';import {hashToken} from '../auth.ts';import {EdgeLedger} from './ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './routes.ts';
const common=await retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
async function setup(t:{after(fn:()=>void):void}){
 const f=fixture(':memory:',common,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));await invite(f,'rider');
 const row=await accept<{id:string;entity_id:string}>(f.host,f.souls.create('dev:rider',{name:'Rider',description:'ride-exit fixture'}));
 await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:15}));
 const token='sim_RIDE_EXIT_TEST_TOKEN',ledger=new EdgeLedger(f.host,f.db),app=new Hono();f.db.setSoulToken(row.id,hashToken(token),'synthetic');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'')),ledger});t.after(()=>{comms.close();f.host.stop();f.db.close();});
 comms.objects.create({id:'ride-test',kind:'ride',name:'Balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 const post=async(path:string,body:unknown)=>{const r=await accept(f.host,Promise.resolve(app.request(path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})));return await r.json() as {accepted:boolean;code?:string;reason?:string;result?:Record<string,unknown>;receipt?:{id:string;phase:string}};};
 const caps=async()=>{const r=await accept(f.host,Promise.resolve(app.request('/v1/edge/capabilities',{headers:{authorization:'Bearer '+token}})));return (await r.json() as {capabilities:{id:string;label:string;available:boolean;blocked?:{code:string;reason:string}}[]}).capabilities;};
 const ent=()=>(f.host.engine.world.entities as Record<string,any>),balloon=()=>ent()['eden-balloon'].carrier,tick=(n:number,until?:()=>boolean)=>{for(let i=0;i<n&&!until?.();i++)f.host.tickOnce();};
 return {f,row,ledger,comms,post,caps,ent,balloon,tick,actor:row.entity_id};
}
test('a landed balloon rider held by a stalled step-out is refused as stepping out, keeps leave, and is set down within 30 s',{timeout:120000},async t=>{
 const q=await setup(t);
 const offer=(await q.caps()).find(c=>c.id==='object:ride-test:join')!;assert.match(offer.label,/lifts off by itself ~15 s after you are seated, flies .* and lands where it started/,offer.label);
 const join=await q.post('/v1/edge/act',{capability:'object:ride-test:join',clientRef:'join'});assert.equal(join.accepted,true,JSON.stringify(join));
 q.tick(3000,()=>q.ledger.aboard(q.actor)?.riderPhase==='seated');assert.equal(q.ledger.aboard(q.actor)?.riderPhase,'seated');
 q.balloon().departAtTick=q.f.host.engine.world.tick;q.tick(200,()=>q.balloon().phase==='aloft');assert.equal(q.balloon().phase,'aloft');
 q.balloon().elapsed=1e9;q.tick(200,()=>q.balloon().phase==='landed');assert.equal(q.balloon().phase,'landed');
 // The stall: someone else holds the basket door, so the engine's step-out cannot take it (live: posture riding for 7+ minutes).
 q.balloon().doorBy='someone-at-the-door';const landedTick=q.f.host.engine.world.tick;
 q.tick(40);assert.equal(q.ledger.aboard(q.actor)?.riderPhase,'leaving','the carrier step still holds the body');
 const during=await q.post('/v1/edge/act',{capability:'stand:here',clientRef:'during'});
 assert.equal(during.accepted,false);assert.equal(during.code,'ride.landing');assert.match(during.reason!,/^Stepping out of the balloon, ~\d+ s/);
 const leave=(await q.caps()).find(c=>c.id==='object:ride-test:leave');assert.ok(leave?.available,'leave stays offered while the body is in the basket: '+JSON.stringify(leave));
 const left=await q.post('/v1/edge/act',{capability:'object:ride-test:leave',clientRef:'leave'});assert.equal(left.accepted,true,JSON.stringify(left));
 q.tick(600,()=>!q.ledger.aboard(q.actor));
 const seconds=(q.f.host.engine.world.tick-landedTick)/20;assert.equal(q.ledger.aboard(q.actor),null,'set down');assert.ok(seconds<=30,`on the ground ${seconds} s after landing`);
 const h=q.ent()[q.actor].human;assert.equal(h.carrier,undefined);assert.equal(h.activity,'idle');assert.equal(q.f.host.engine.programOf(q.actor),null);
 assert.ok(Math.abs(q.ent()[q.actor].pose.p[1]-q.balloon().home[1])<1e-6,'standing at ground level');
 q.tick(60);const after=await q.post('/v1/edge/act',{capability:'stand:here',clientRef:'after'});assert.equal(after.accepted,true,JSON.stringify(after));
 const events=q.f.db.db.prepare("SELECT body FROM edge_comms_stream WHERE soul_id=? ORDER BY seq").all(q.row.id) as {body:string}[];
 assert.ok(events.some(e=>/out of the balloon, standing on the ground/.test(e.body)),'owner-readable end of the ride: '+events.map(e=>e.body.slice(0,80)).join(' | '));
});
