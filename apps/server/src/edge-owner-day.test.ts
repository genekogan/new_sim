// OWNER-DAY: GET /v1/souls/:id/day is the owner's "Today" timeline: its Soul's acts, the world's refusals with the
// world's reason and where the body stood, and its own speech. Another owner gets 403; no other Soul's rows leak.
import test from 'node:test';import assert from 'node:assert/strict';
import type {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {buildApp} from './http.ts';
import {describeAttempt, describeCapability, ownerDay, plain, plainReason} from './edge/owner-day.ts';
import type {Hub} from './hub.ts';

const born=async(f:ReturnType<typeof fixture>,owner:string,name:string)=>{await invite(f,owner);return accept(f.host,f.souls.create('dev:'+owner,{name,description:'scripted day test'}));};
const settle=async(f:ReturnType<typeof fixture>)=>{for(let i=0;i<6;i++){f.host.tickOnce();f.host.drainInputs();await new Promise(r=>setImmediate(r));}};

test('OWNER DAY: the owner reads acts, refusals (with the world\'s reason) and speech; another owner gets 403',async t=>{
 const f=fixture(':memory:');f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const a=await born(f,'a','Owner A'),b=await born(f,'b','Owner B');await settle(f);
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});
 const {config}=await import('./config.ts');
 const cfg={worldId:f.host.worldId,worldKey:'eden',worldPath:'/w/eden',brainMode:'fake',inviteRequired:true,build:'test'};
 const app:Hono=buildApp({cfg:{...config,...cfg} as never,db:f.db,host:f.host,auth:f.auth,brain:f.brain,souls:f.souls,edge,hub:{refreshMe(){},clients:new Map(),joinMessages:[],upgradeHandlers:[]} as unknown as Hub});
 const soulA={soulId:a.id,entityId:a.entity_id,name:a.name,owner:a.owner},soulB={soulId:b.id,entityId:b.entity_id,name:b.name,owner:b.owner};
 const did=await accept(f.host,edge.act(soulA,{capability:'stand:here'}));assert.equal(did.accepted,true,JSON.stringify(did));
 const no=await accept(f.host,edge.act(soulA,{capability:'fly:moon'}));assert.equal(no.accepted,false,JSON.stringify(no));
 await accept(f.host,edge.act(soulB,{capability:'fly:mars'}));
 f.db.db.prepare('INSERT INTO edge_comms_speech (world_id,id,soul_id,tick,at,channel,text,heard_by) VALUES (?,?,?,?,?,?,?,?)').run(f.host.worldId,'sp1',a.id,1,Date.now(),'{"kind":"earshot"}','good morning, fountain','[]');
 f.db.db.prepare('INSERT INTO edge_comms_speech (world_id,id,soul_id,tick,at,channel,text,heard_by) VALUES (?,?,?,?,?,?,?,?)').run(f.host.worldId,'sp2',b.id,1,Date.now(),'{"kind":"earshot"}','B private-ish line','[]');
 const get=(owner:string,id:string)=>accept(f.host,Promise.resolve(app.request(`/v1/souls/${id}/day`,{headers:{host:'127.0.0.1:5733',authorization:`Bearer dev:${owner}`}})));
 const r=await get('a',a.id);assert.equal(r.status,200,await r.clone().text());
 const body=await r.json() as {entries:{kind:string;text:string;reason?:string;where:unknown}[]};
 const kinds=body.entries.map(e=>e.kind);
 assert.ok(kinds.includes('did'),JSON.stringify(body.entries));
 const refused=body.entries.find(e=>e.kind==='refused');assert.ok(refused,'the refusal is on the timeline');
 assert.equal(refused!.reason,(no as {reason:string}).reason,'the world\'s own reason, verbatim');assert.ok(refused!.where,'where the body stood');
 assert.ok(body.entries.some(e=>e.kind==='said'&&e.text==='good morning, fountain'));
 assert.ok(!JSON.stringify(body).includes('B private-ish line')&&!JSON.stringify(body).includes('mars'),'no other Soul\'s rows');
 const denied=await get('b',a.id);assert.equal(denied.status,403,await denied.clone().text());
 const anon=await accept(f.host,Promise.resolve(app.request(`/v1/souls/${a.id}/day`,{headers:{host:'127.0.0.1:5733'}})));assert.ok(anon.status===401||anon.status===403,String(anon.status));
});

test('OWNER DAY: capability ids read as plain words',()=>{
 const names:Record<string,string>={place_bakery:'the bakery','ride-eden-balloon':'the balloon'};const n=(id:string)=>names[id]??null;
 assert.equal(describeCapability('walk:place_bakery',n),'walked to the bakery');
 assert.equal(describeCapability('rest:here',n),'rested');
 assert.equal(describeCapability('object:ride-eden-balloon:join',n),'joined the balloon');
 assert.equal(describeCapability('swim:shore-water',n),'swam in shore water');
 assert.equal(describeCapability('stretch:here',n),'did a stretch');
 assert.equal(describeCapability('jog:field',n),'jogged to field');
 assert.equal(describeCapability('yoga:here',n),'did yoga');
 assert.equal(describeCapability('yoga-class:here',n),'joined the yoga class');
 assert.equal(describeAttempt('sit:here',n),'tried to sit down');
 assert.equal(describeAttempt('fly:moon',n),'tried to fly to moon');
});

// OWNER-DAY follow-up (stranger-owner walk on the eden-2026 fixture Soul Bo): an act cut short is marked, engine codes
// read as plain words (energy included), and god-built place ids read as place labels.
test('OWNER DAY: god-built place ids read as place labels, not raw ids',()=>{
 const none=()=>null;
 assert.equal(plain('commons-kitchen-table-3'),'commons kitchen table');
 assert.equal(plain('trees-south-park-canopy'),'south park trees');
 assert.equal(plain('g-place-commons-kitchen'),'commons kitchen');
 assert.equal(plain('commons-pavilion/pavilion'),'commons pavilion');
 assert.equal(plain('trees-old-3-2'),'old trees');
 assert.equal(plain('The Bakery'),'The Bakery','a real name is kept as is');
 assert.equal(describeCapability('walk:commons-kitchen-table-3',none),'walked to commons kitchen table');
 assert.equal(describeCapability('jog:g-trees-south-park-canopy',none),'jogged to south park trees');
});
test('OWNER DAY: refusal reasons are plain words, never engine codes',()=>{
 assert.equal(plainReason('pose.not-still','Sit on the ground is supported, but the world blocks it right now (pose.not-still).'),'still moving: stand still first');
 assert.equal(plainReason('sit.not-still',''),'still moving: stand still first');
 assert.equal(plainReason('needs.energy','Bo is exhausted.'),'too tired: rest first');
 assert.equal(plainReason('walk.blocked','Bo is too tired to walk that far.'),'too tired: rest first');
 assert.equal(plainReason('ride.unavailable','No matching ride is offered here; nothing else was chosen.'),'No matching ride is offered here; nothing else was chosen.','a plain engine sentence is kept');
 assert.equal(plainReason('zz.odd','Swim is supported, but the world blocks it right now (zz.odd).'),'the world blocks it right now.');
 assert.equal(plainReason('zz.odd',null),'the world said no');
 for(const r of [plainReason('pose.not-still','x (pose.not-still)'),plainReason('zz.odd','y (zz.odd)')])assert.ok(!/\([a-z]+\.[a-z.-]+\)/.test(r),r);
});
test('OWNER DAY: an act cut short by the Soul\'s next act is marked, not shown as finished',()=>{
 const rows:Record<string,{phase:string;capability:string;endedAt:unknown}>={r1:{phase:'replaced',capability:'stargaze:here',endedAt:{pos:[9,-1.3],place:'g-commons-deck'}},r2:{phase:'completed',capability:'stretch:here',endedAt:{pos:[9,-1.3],place:'g-commons-deck'}}};
 const sql={prepare:(q:string)=>({all:()=>/edge_receipts_v1/.test(q)?[{receipt_id:'r1'},{receipt_id:'r2'}]:[],get:(_w:string,id:string)=>/created_at FROM/.test(q)?{created_at:id==='r1'?1000:2000}:undefined})};
 const L={host:{worldId:'w',nameOf:(id:string)=>id},places:{byId:new Map([['g-commons-deck',{name:'commons-deck'}]])},receipt:(_s:string,id:string)=>rows[id]};
 const day=ownerDay(L as never,{db:sql} as never,'s1',0);
 assert.deepEqual(day.map(e=>[e.kind,e.text,e.cut??false,e.place]),[['did','watched the stars (cut short)',true,'commons deck'],['did','did a stretch',false,'commons deck']]);
});
