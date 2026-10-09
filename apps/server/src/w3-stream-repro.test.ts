// W3 current-source delivery qualification. No native world or model; only
// the existing SQLite event fixture and a real loopback HTTP socket.
import assert from 'node:assert/strict';
import test from 'node:test';
import {eventsFixture} from './edge/events/testing.ts';
import {HEARTBEAT_MS} from './edge/events/index.ts';

test('W3 real HTTP: immediate hello and 15s heartbeat with pad 0/1; own receipts agree with wait', {timeout: 45000}, async () => {
 const f=eventsFixture(['ReleaseProbe'],{events:{heartbeatMs:HEARTBEAT_MS}});
 const controllers:AbortController[]=[];
 try {
  const host=await f.listen(), results=[];
  for(const pad of [0,1]){
   const ac=new AbortController();controllers.push(ac);
   const start=performance.now(), res=await fetch(`http://${host}/v1/edge/events?pad=${pad}&minSalience=0`,{headers:{authorization:`Bearer ${f.id('ReleaseProbe')}`},signal:ac.signal});
   assert.equal(res.status,200);assert.match(res.headers.get('content-type')??'',/text\/event-stream/);
   assert.equal(res.headers.get('cache-control'),'no-cache, no-transform');assert.equal(res.headers.get('x-accel-buffering'),'no');
   const reader=res.body!.getReader(), decoder=new TextDecoder();let buf='',hello=false,heartbeat=false,started=false,terminal=false,receiptId='';const events:string[]=[],times:Record<string,number>={};
   const timer=setTimeout(()=>ac.abort(),18000);
   try {
    while(!hello||!terminal||!heartbeat){
     const chunk=await reader.read();assert.equal(chunk.done,false);buf+=decoder.decode(chunk.value,{stream:true});
     let end:number;
     while((end=buf.indexOf('\n\n'))>=0){
      const block=buf.slice(0,end);buf=buf.slice(end+2);const elapsed=performance.now()-start;
      if(block.startsWith(': keepalive')){heartbeat=true;times.heartbeat=elapsed;continue;}
      const kind=/^event: (.+)$/m.exec(block)?.[1], data=/^data: (.+)$/m.exec(block)?.[1];if(!kind||!data)continue;
      const body=JSON.parse(data);events.push(kind);if(!times[kind])times[kind]=elapsed;
      if(kind==='hello'){
       hello=true;assert.ok(elapsed<5000,`hello at ${elapsed}ms`);assert.equal(body.heartbeatSeconds,15);
       const soul={soulId:f.id('ReleaseProbe'),entityId:`h_${f.id('ReleaseProbe')}`,name:'ReleaseProbe',owner:'dev:ReleaseProbe'};const act=await f.actor.act(soul,{capability:'wave:here'});assert.ok('receipt' in act);receiptId=act.receipt.id;f.actor.set(receiptId,'completed');
      }
      if(kind==='receipt.started')started=true;
      if(kind==='receipt.terminal'){terminal=true;assert.equal(body.data.receipt.id,receiptId);assert.equal(body.data.receipt.phase,'completed');assert.ok(elapsed<10000);}
     }
    }
    assert.ok(started&&terminal);assert.ok(heartbeat);assert.ok(times.heartbeat>=14000&&times.heartbeat<18000);
    const wait=await f.get('ReleaseProbe','/v1/edge/wait?after=c_0&timeout=1');
    assert.ok(wait.body.events.some((e:any)=>e.kind==='receipt'&&e.receipt?.id===receiptId&&e.receipt.phase==='completed'),'wait contains the same own terminal receipt');
    results.push({pad,events,times});
   }finally{clearTimeout(timer);ac.abort();await reader.cancel().catch(()=>{});}
  }
  console.log('W3_PRIVATE_HTTP_PROOF '+JSON.stringify(results));
 }finally{for(const ac of controllers)ac.abort();f.destroy();}
});
