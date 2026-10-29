import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {idempotency,IDEMPOTENCY_TTL_MS} from './edge/events/idempotency.ts';
import {mountOperationLookup} from './edge/events/operations.ts';
import {EdgeError,type EdgeDeps} from './edge/contract.ts';
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
