import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEventReader} from './sse.mjs';
const stream=chunks=>new Response(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(new TextEncoder().encode(chunk));c.close();}}));
test('split frames, heartbeat and cursor-only delivery preserve event identity and connection',async()=>{
 let opens=0;const read=createEventReader({open:async()=>{opens++;return stream([': hello\r','\n\r\nevent: hello\ndata: {}\n\nevent: conversation.turn\nid: c_1\ndata: {"id":"c_1","text":"hé','llo"}\n\nevent: cursor\ndata: {"cursor":"c_2"}\n\n']);}});
 assert.deepEqual(await read({after:'c_0'}),{cursor:'c_1',events:[{id:'c_1',text:'héllo'}]});assert.deepEqual(await read({after:'c_1'}),{cursor:'c_2',events:[]});assert.equal(opens,1);
});
test('uncommitted cursor causes reconnect from old durable position',async()=>{
 const positions=[];const read=createEventReader({open:async after=>{positions.push(after);return stream(['id: c_1\nevent: speech.to-me\ndata: {"id":"c_1"}\n\n']);}});
 await read({after:'c_0'});await read({after:'c_0'});assert.deepEqual(positions,['c_0','c_0']);
});
test('gap is explicit and stream closure is retryable rather than data loss',async()=>{
 const read=createEventReader({open:async()=>stream(['event: gap\ndata: {"oldest":"c_50"}\n\n'])});assert.deepEqual(await read({after:'c_0'}),{cursor:'c_50',events:[],gap:true});await assert.rejects(read({after:'c_50'}),e=>e.transient===true);
});
