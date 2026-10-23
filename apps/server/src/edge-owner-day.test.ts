// OWNER-DAY: GET /v1/souls/:id/day is the owner's "Today" timeline: its Soul's acts, the world's refusals with the
// world's reason and where the body stood, and its own speech. Another owner gets 403; no other Soul's rows leak.
import test from 'node:test';import assert from 'node:assert/strict';
import type {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {buildApp} from './http.ts';
import {describeCapability} from './edge/owner-day.ts';
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
 assert.equal(describeCapability('swim:shore-water',n),'swam shore water');
});
