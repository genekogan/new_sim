// SOUL3 continuation (ACCEPT3 A7): a newer here-activity supersedes a balloon join that is still walking to the basket;
// the body stops and starts it, and the superseded join never boards it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@sim/engine-mars';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';

const factory=()=>retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
test('balloon join superseded before boarding: the newer here-activity starts, the old join never boards',{timeout:600000},async t=>{
 const f=fixture(':memory:',await factory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),f.host.enableEdgeMotionV1()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben','cy']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'rider'})));}
 const tokens=rows.map((r,i)=>{const tok='sim_RIDE_TEST_TOKEN_'+i;f.db.setSoulToken(r.id,hashToken(tok),'synthetic');return tok;});
 await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Red balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:60}));
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>comms.close());
 comms.objects.create({id:'ride-eden-balloon',kind:'ride',name:'Red balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 const pump=async<T>(p:Promise<T>)=>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<400&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done,'request settled');return p;};
 const call=async(i:number,method:string,path:string,body?:unknown)=>{const res=await pump(app.request(path,{method,headers:{authorization:'Bearer '+tokens[i],'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);return await res.json() as any;};
 const dump=()=>rows.map((r,i)=>`${i}:${r.entity_id} ${ent(i).pose.p.map((v:number)=>v.toFixed(2))} ${ent(i).human.activity} ${JSON.stringify(ent(i).human.carrier??null)} task=${ent(i).human.task} rec=${ent(i).human.task?JSON.stringify((f.host.engine.runtime.records.get(ent(i).human.task) as any)):''}`).join('\n');
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){try{f.host.tickOnce();}catch(e){console.error(dump());throw e;}if(i%20===0){await setImmediate();f.host.drainInputs();}}return until();};
 const W=f.host.engine.world as any,balloon=()=>W.entities['eden-balloon'],ent=(i:number)=>W.entities[rows[i].entity_id];
 const phase=(i:number,id:string)=>ledger.receipt(rows[i].id,id)!;
 // ACCEPT3 A7 replay: the Soul's join is still a walk to the basket when a newer here-activity arrives
 const ja=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(ja.accepted,true,JSON.stringify(ja));
 await run(15,()=>false);assert.equal(ent(0).human.activity,'walk','still walking to the basket');assert.equal(ledger.aboard(rows[0].entity_id),null);
 const rs=await call(0,'POST','/v1/edge/act',{capability:'stretch:here'});assert.equal(rs.accepted,true,'the replacement is admitted, not refused not-still: '+JSON.stringify(rs));
 assert.equal(phase(0,ja.receipt.id).phase,'replaced','the join is superseded');
 let boarded=0,began=-1;for(let k=0;k<1500;k++){await run(1,()=>false);if(ent(0).human.carrier||ledger.aboard(rows[0].entity_id))boarded++;if(began<0&&ent(0).human.activity==='stretch')began=k;}
 assert.equal(boarded,0,'no boarding from the superseded join');
 assert.ok(began>=0&&began<=40,'the stretch physically begins within 2 s: '+began);
 assert.equal(phase(0,rs.receipt.id).phase,'completed',JSON.stringify(phase(0,rs.receipt.id)));
 assert.ok(!Object.values(balloon().carrier.state?.seats??{}).includes(rows[0].entity_id),'never seated');
});
