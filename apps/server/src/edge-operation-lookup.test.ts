import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {idempotency,IDEMPOTENCY_TTL_MS} from './edge/events/idempotency.ts';
import {mountOperationLookup} from './edge/events/operations.ts';
import {EdgeError,type EdgeDeps} from './edge/contract.ts';
import {AgentInbox} from './inbox.ts';
import {mountAgentInbox} from './inbox-routes.ts';
import {ApiError} from './souls.ts';
import {mountPersonalReminders} from './edge/reminders/routes.ts';
import {PersonalReminders} from './edge/reminders/reminders.ts';
import type {CommsRuntime} from './edge/comms/index.ts';
function fixture(t:TestContext){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let now=1000000000;const receipts=new Map<string,unknown>();
 const deps={db:{db},host:{worldId:'w'},souls:{},soul:(c:any)=>{const id=c.req.header('authorization');if(!id)throw new EdgeError(401,'auth','Missing authentication');return {soulId:id};}} as unknown as EdgeDeps;
 const app=new Hono();app.use('/v1/edge/say',idempotency(deps,()=>now));let effects=0;app.post('/v1/edge/say',c=>{effects++;return c.json({said:{id:'speech-1'}});});
 mountOperationLookup(app,deps,(s,k)=>receipts.get(s+':'+k),()=>now);
 const lookup=async(key='operation-1',soul='alice',route='POST /v1/edge/say')=>app.request('/v1/edge/operations/'+key+'?route='+encodeURIComponent(route),{headers:soul?{authorization:soul}:{}});
 return {app,lookup,receipts,effects:()=>effects,advance:(ms:number)=>{now+=ms;}};
}
test('lookup retrieves accepted response without re-executing a public effect',async t=>{
 const f=fixture(t);await f.app.request('/v1/edge/say',{method:'POST',headers:{authorization:'alice','idempotency-key':'operation-1','content-type':'application/json'},body:'{"text":"hello"}'});
 const got=await (await f.lookup()).json();assert.equal(got.state,'recorded');assert.deepEqual(got.response,{said:{id:'speech-1'}});assert.equal(f.effects(),1);
 assert.equal((await f.lookup()).headers.get('cache-control'),'no-store');
 assert.equal((await (await f.lookup('operation-1','bob')).json()).state,'unknown');
});
test('authentication and route boundaries are enforced',async t=>{
 const f=fixture(t);assert.equal((await f.lookup('x','')).status,401);assert.equal((await f.lookup('x','alice','POST /v1/agent/pair')).status,400);
});
test('durable action receipt recovers accepted act even without HTTP cache row',async t=>{
 const f=fixture(t);f.receipts.set('alice:op-act',{id:'r1',phase:'completed'});
 const got=await (await f.lookup('op-act','alice','POST /v1/edge/act')).json();assert.equal(got.evidence,'action-receipt');assert.equal(got.response.receipt.id,'r1');
 assert.equal((await (await f.lookup('op-act','bob','POST /v1/edge/act')).json()).state,'unknown');
});
test('expired or absent cache returns unknown, never permission to replay',async t=>{
 const f=fixture(t);await f.app.request('/v1/edge/say',{method:'POST',headers:{authorization:'alice','idempotency-key':'operation-1'},body:'{}'});f.advance(IDEMPOTENCY_TTL_MS+1);
 const got=await (await f.lookup()).json();assert.equal(got.state,'unknown');assert.match(got.note,/may still have executed/);assert.equal(f.effects(),1);
});
test('native inbox readback finds older finished messages and enforces world, Soul and owner scopes without delivery',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let owner='owner-alice';
 const app=new Hono();app.onError((e,c)=>e instanceof ApiError?c.json({error:{code:e.code}},e.status as 400):c.json({error:{code:'internal'}},500));
 const d={db:{db},worldId:'world-a',souls:{limits:{allow:()=>({ok:true})},soulFromToken:(token:string)=>token==='sim_alice'?{id:'alice',owner}:token==='sim_bob'?{id:'bob',owner:'owner-bob'}:null,controlRefusal:()=>({code:'unauthorized',message:'paired credential required'})},requireUser:async()=>{throw Error('human route unused');},ownerSoul:async()=>{throw Error('owner route unused');},now:()=>1000};
 const inbox=mountAgentInbox(app,d as unknown as Parameters<typeof mountAgentInbox>[1]);
 const scope={scope:'soul:alice',owner:'owner-alice'},first=inbox.send(scope,'first').latest!,second=inbox.send(scope,'second').latest!;
 const get=(id:string,token='sim_alice')=>app.request('/v1/edge/inbox/'+id,{headers:token?{authorization:'Bearer '+token}:{}});
 const waiting=await get(first.id);assert.equal(waiting.status,200);assert.equal((await waiting.json()).message.state,'sent');assert.equal(inbox.messageById(scope,first.id)?.deliveredAt,undefined);
 const ack=await app.request('/v1/edge/inbox/'+first.id+'/ack',{method:'POST',headers:{authorization:'Bearer sim_alice','content-type':'application/json','idempotency-key':'op-ack'},body:JSON.stringify({reply:'Working'})});assert.equal(ack.status,200);
 await app.request('/v1/edge/inbox/'+first.id+'/result',{method:'POST',headers:{authorization:'Bearer sim_alice','content-type':'application/json'},body:JSON.stringify({outcome:'failed',text:'Could not arrive'})});
 assert.equal(inbox.view(scope).latest?.id,second.id,'listen/current view has advanced beyond the finished message');
 const read=await get(first.id),message=(await read.json()).message;assert.equal(read.headers.get('cache-control'),'no-store');assert.equal(message.reply,'Working');assert.equal(message.result,'Could not arrive');assert.equal(message.outcome,'failed');assert.equal(message.resultBy,undefined);
 assert.equal((await get(first.id,'sim_bob')).status,404);assert.equal((await get(first.id,'')).status,401);assert.equal((await get(first.id,'human')).status,401);
 owner='new-owner';assert.equal((await get(first.id)).status,404);owner='owner-alice';
 const other=new AgentInbox(d.db as unknown as AgentInbox['db'],'world-b',()=>1000);assert.equal(other.messageById(scope,first.id),null);
 assert.equal(inbox.messageById(scope,second.id)?.state,'sent','readback never consumes the backlog');
});
test('native reminder readback retains exact request after delivery/cancel and is private, world-scoped and read-only',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const now=Date.parse('2026-10-29T12:00:00Z');
 const deps={db:{db},host:{worldId:'world-a',engine:{world:{tick:0}},living:null,paused:true,clockRate:1},souls:{},soul:(c:any)=>{const id=c.req.header('authorization');if(!['alice','bob'].includes(id))throw new EdgeError(401,'auth','paired credential required');return {soulId:id};}} as unknown as EdgeDeps;
 const app=new Hono(),streams={deliver:()=>({id:'c_1'})},runtime=mountPersonalReminders(app,deps,{streams} as unknown as CommsRuntime,{now:()=>now,intervalMs:0});t.after(()=>runtime.close());
 const request={clientRef:'stable-ref',text:'  A   private reminder  ',at:{clock:'real',time:'2026-10-29T09:00:00-04:00'}};
 const created=await app.request('/v1/edge/reminders',{method:'POST',headers:{authorization:'alice','content-type':'application/json'},body:JSON.stringify(request)});assert.equal(created.status,200);const reminder=(await created.json()).reminder;
 runtime.service.cancel('alice',reminder.id);
 const get=(key='stable-ref',soul='alice')=>app.request('/v1/edge/reminders/by-client-ref/'+key,{headers:soul?{authorization:soul}:{}});
 const read=await get(),got=(await read.json()).reminder;assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.equal(got.state,'cancelled');assert.equal(got.id,reminder.id);assert.equal(got.text,'A private reminder');assert.equal(got.at.time,'2026-10-29T13:00:00.000Z');
 assert.equal((await get('stable-ref','bob')).status,404);assert.equal((await get('stable-ref','')).status,401);assert.equal((await get('absent')).status,404);assert.equal((await get('invalid!')).status,400);
 db.prepare("UPDATE edge_personal_reminders_v1 SET state='delivered',event_cursor='c_8',delivered_at=?").run(now);
 assert.equal((await (await get()).json()).reminder.state,'delivered');
 const other=new PersonalReminders(db,'world-b',streams as unknown as CommsRuntime['streams'],()=>({} as never));assert.throws(()=>other.byClientRef('alice','stable-ref'),(e:any)=>e.status===404);
 assert.equal(runtime.service.list('alice','all').total,1,'readback never creates/replays a reminder');
});
