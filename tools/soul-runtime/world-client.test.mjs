import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorldClient,isTransientRead} from './world-client.mjs';
const mock=(fn)=>createWorldClient({world:'http://127.0.0.1:1234/world',token:'synthetic-fixture-only',fetchImpl:fn});
test('raw world page returns conversation turns immediately without a body receipt filter',async()=>{
 const client=mock(async(url,opts)=>{assert.match(url,/after=c_7/);assert.equal(opts.redirect,'error');return Response.json({cursor:'c_8',events:[{id:'c_8',kind:'conversation.turn'}]})});
 const page=await client.worldPage({after:'c_7'});assert.equal(page.events[0].kind,'conversation.turn');assert.equal(page.cursor,'c_8');
});
test('owner delivery normalizes immutable content and does not acknowledge it',async()=>{
 const calls=[];const client=mock(async(url,opts)=>{calls.push({url,method:opts.method});return Response.json({backlog:[{id:'m1',text:'Come here',sentAt:12,state:'pending',internal:'omit'}]})});
 assert.deepEqual(await client.ownerPage({after:null}),{cursor:'m1',events:[{id:'m1',kind:'owner.message',text:'Come here',sentAt:12}]});assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
});
test('write uses stable key and clientRef but never retries a dropped response',async()=>{
 let calls=0;const client=mock(async(url,opts)=>{calls++;assert.equal(opts.headers['idempotency-key'],'op-1');assert.equal(JSON.parse(opts.body).clientRef,'op-1');throw Error('lost response')});
 await assert.rejects(client.write('act',{capability:'sit:chair'},'op-1'),e=>e.uncertain&&!e.transient);assert.equal(calls,1);
});
test('read retries can be classified separately from terminal auth and supersession',async()=>{
 const unavailable=mock(async()=>{throw Error('offline')});await assert.rejects(unavailable.worldPage({after:null}),isTransientRead);
 for(const status of [401,403,409]){const denied=mock(async()=>Response.json({error:{code:'terminal'}},{status}));await assert.rejects(denied.ownerPage({after:null}),e=>e.status===status&&!e.transient);}
});
test('credential stays out of URLs and serialization; arbitrary methods and remote HTTP refused',async()=>{
 const client=mock(async()=>Response.json({}));assert.equal(JSON.stringify(client).includes('synthetic'),false);await assert.rejects(client.read('http://evil',{}),/Unsupported/);await assert.rejects(client.write('pair',{},'x'),/Unsupported/);
 assert.throws(()=>createWorldClient({world:'http://example.com',token:'fixture'}),/HTTPS/);assert.throws(()=>createWorldClient({world:'https://user:pass@example.com',token:'fixture'}),/credentials/);
});
