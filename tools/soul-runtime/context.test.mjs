import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedFacts} from './context.mjs';
test('delivery budget leaves whole facts untruncated and always makes progress on one large fact',()=>{
 const facts=Array.from({length:100},(_,i)=>({event:{id:'e'+i,text:'x'.repeat(1000)}}));const selected=boundedFacts(facts,{bytes:3000});assert.equal(selected.length,2);assert.deepEqual(selected,facts.slice(0,2));assert.equal(facts.length,100);
 assert.equal(boundedFacts(facts,{bytes:10}).length,1);assert.equal(boundedFacts(facts,{limit:1}).length,1);
});
test('identity references stay within 8KiB while successive whole-fact pages make eventual progress',()=>{
 const source='界'.repeat(100),facts=Array.from({length:100},(_,i)=>({source,event:{id:'\ud800'.repeat(197)+String(i).padStart(3,'0'),text:'Fact '+i}}));
 let remaining=[...facts],seen=[],pages=0;
 while(remaining.length){
  const page=boundedFacts(remaining);assert.ok(page.length>0&&page.length<100);assert.deepEqual(page,remaining.slice(0,page.length));assert.ok(Buffer.byteLength(JSON.stringify(page.map(f=>({source:f.source,id:f.event.id}))))<=8192);
  seen.push(...page);remaining=remaining.slice(page.length);pages++;
 }
 assert.ok(pages>1);assert.deepEqual(seen,facts);
 const large={source,event:{id:'界'.repeat(200),text:'x'.repeat(64000)}};assert.deepEqual(boundedFacts([large,...facts],{bytes:10}),[large]);
});
