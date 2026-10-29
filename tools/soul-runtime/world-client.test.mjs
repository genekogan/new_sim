import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorldClient,isTransientRead} from './world-client.mjs';
const mock=(fn)=>createWorldClient({world:'http://127.0.0.1:1234/world',token:'synthetic-fixture-only',fetchImpl:fn});
test('native flat validation messages survive transport and invalid completion reports never POST',async()=>{
 let writes=0;const client=mock(async()=>{writes++;return Response.json({ok:false,code:'invalid',message:'result must be one line of 1–140 characters'},{status:400})});
 for(const args of [{id:'m',outcome:'completed',text:'Returned'},{id:'m',outcome:'done',text:'x'.repeat(141)}])await assert.rejects(client.write('result',args,'op-validation'),e=>e.status===400&&e.uncertain===false&&/result/.test(e.message));
 assert.equal(writes,0);
 await assert.rejects(client.write('result',{id:'m',outcome:'done',text:'Returned'},'op-native'),e=>e.message==='result must be one line of 1–140 characters'&&e.uncertain===false);
 assert.equal(writes,1,'native refusal is not retried');
});
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
test('lost inbox responses reconcile matching native effects with GET only and preserve actual outcomes',async()=>{
 for(const [command,args,message] of [
  ['ack',{id:'msg_1',reply:' Got it '},{id:'msg_1',state:'acknowledged',reply:'Got it',outcome:'failed',result:'Could not arrive',resultAt:14}],
  ['ack',{id:'msg_1'},{id:'msg_1',state:'acknowledged'}],
  ['result',{id:'msg_1',text:' Could not arrive ',outcome:'failed'},{id:'msg_1',state:'acknowledged',reply:'Got it',outcome:'failed',result:'Could not arrive',resultAt:14}],
 ]){
  const calls=[];const client=mock(async(url,opts)=>{calls.push({url,method:opts.method});if(opts.method==='POST')throw Error('response lost');return Response.json({message});});
  await assert.rejects(client.write(command,args,'op-1'),e=>e.uncertain);
  const known=await client.reconcile({command,args},'op-1');assert.equal(known.state,'recorded');assert.equal(known.evidence,'observed-native-state');assert.deepEqual(known.response.inbox.latest,message);assert.match(known.response.reconciliation.note,/does not prove/);
  assert.deepEqual(calls.map(c=>c.method),['POST','GET']);assert.match(calls[1].url,/\/inbox\/msg_1$/);
 }
});
test('native inbox absence, unacknowledged, mismatched or server-only result stays unknown',async()=>{
 const args={id:'msg_1',text:'Arrived',outcome:'done'};
 for(const message of [null,{id:'msg_other',state:'acknowledged',result:'Arrived',outcome:'done',resultAt:1},{id:'msg_1',state:'delivered'},{id:'msg_1',state:'acknowledged',result:'Arrived',outcome:'done',resultAt:1,resultBy:'server'},{id:'msg_1',state:'acknowledged',result:'Arrived',outcome:'failed',resultAt:1},{id:'msg_1',state:'acknowledged',result:'Other result',outcome:'done',resultAt:1}]){
  const client=mock(async()=>Response.json({message}));assert.equal((await client.reconcile({command:'result',args},'op-1')).state,'unknown');
 }
 const mismatch=mock(async()=>Response.json({message:{id:'msg_1',state:'acknowledged',reply:'Different reply'}}));assert.equal((await mismatch.reconcile({command:'ack',args:{id:'msg_1',reply:'Got it'}},'op-1')).state,'unknown');
 const absent=mock(async()=>Response.json({error:{code:'not-found'}},{status:404}));assert.equal((await absent.reconcile({command:'ack',args:{id:'msg_1'}},'op-1')).state,'unknown');
 const denied=mock(async()=>Response.json({error:{code:'unauthorized'}},{status:401}));await assert.rejects(denied.reconcile({command:'ack',args:{id:'msg_1'}},'op-1'),e=>e.status===401);
 const invalid=mock(async()=>Response.json({message:{id:'msg_1',state:'acknowledged',reply:'Got it'}}));assert.equal((await invalid.reconcile({command:'ack',args:{id:'msg_1',reply:{}}},'op-1')).state,'unknown');
});
test('reminder recovery matches canonical request and stable ref across later native states without POST replay',async()=>{
 const args={text:'  Remember   the appointment  ',at:{clock:'real',time:'2027-01-01T09:00:00-05:00'}};
 for(const state of ['active','due','delivered','cancelled']){
  const reminder={id:'rm_1',clientRef:'op-remind',text:'Remember the appointment',at:{clock:'real',time:'2027-01-01T14:00:00.000Z'},state};
  let writes=0;const client=mock(async(url,opts)=>{if(opts.method==='POST'){writes++;throw Error('lost');}assert.match(url,/\/reminders\/by-client-ref\/op-remind$/);return Response.json({reminder});});
  await assert.rejects(client.write('remind',args,'op-remind'),e=>e.uncertain);const known=await client.reconcile({command:'remind',args},'op-remind');assert.equal(known.evidence,'observed-native-state');assert.deepEqual(known.response.reminder,reminder);assert.equal(writes,1);
 }
 const worldArgs={text:'note',at:{clock:'world',worldDayIndex:4,time:'09:00'}},native={clientRef:'op-world',text:'note',at:worldArgs.at};
 const same=mock(async()=>Response.json({reminder:native}));assert.equal((await same.reconcile({command:'remind',args:worldArgs},'op-world')).state,'recorded');
 for(const reminder of [{...native,clientRef:'other'},{...native,text:'other'},{...native,at:{...native.at,worldDayIndex:5}}]){
  const client=mock(async()=>Response.json({reminder}));assert.equal((await client.reconcile({command:'remind',args:worldArgs},'op-world')).state,'unknown');
 }
 const absent=mock(async()=>Response.json({error:{code:'not-found'}},{status:404}));assert.equal((await absent.reconcile({command:'remind',args:worldArgs},'op-world')).state,'unknown');
 const rolledDate=mock(async()=>Response.json({reminder:{...native,at:{clock:'real',time:'2027-03-02T09:00:00.000Z'}}}));assert.equal((await rolledDate.reconcile({command:'remind',args:{text:'note',at:{clock:'real',time:'2027-02-30T09:00:00Z'}}},'op-world')).state,'unknown','invalid dates must not match a JS-normalized later day');
});
