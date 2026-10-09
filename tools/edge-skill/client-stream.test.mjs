import test from 'node:test';
import assert from 'node:assert/strict';
import {readClientStream} from './client-stream.mjs';
const frame=text=>new TextEncoder().encode(text);
function response(blocks){return async()=>new Response(new ReadableStream({start(c){for(const b of blocks)c.enqueue(frame(b));},cancel(){}}),{status:200});}
test('no hello and byte trickles cannot silently disable fallback',async()=>{
 const r=await readClientStream('http://synthetic/',{fetcher:response([': partial']),helloMs:20,frameMs:40});assert.equal(r.reason,'hello-timeout');assert.equal(r.hello,false);
});
test('hello then missing frames falls back; comments count as completed heartbeat frames',async()=>{
 const seen=[];const r=await readClientStream('http://synthetic/',{fetcher:response(['event: hello\ndata: {}\n\n',': heartbeat\n\n']),onFrame:x=>seen.push(x),helloMs:20,frameMs:40});
 assert.equal(r.reason,'frame-timeout');assert.equal(r.hello,true);assert.equal(seen.length,2);
});
test('external abort cleans the pending reader and deadline',async()=>{
 const controller=new AbortController();const pending=readClientStream('http://synthetic/',{fetcher:response([]),signal:controller.signal,helloMs:1000});controller.abort();const r=await pending;assert.equal(r.reason,'aborted');
});
