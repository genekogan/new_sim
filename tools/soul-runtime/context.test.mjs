import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedFacts} from './context.mjs';
test('delivery budget leaves whole facts untruncated and always makes progress on one large fact',()=>{
 const facts=Array.from({length:100},(_,i)=>({event:{id:'e'+i,text:'x'.repeat(1000)}}));const selected=boundedFacts(facts,{bytes:3000});assert.equal(selected.length,2);assert.deepEqual(selected,facts.slice(0,2));assert.equal(facts.length,100);
 assert.equal(boundedFacts(facts,{bytes:10}).length,1);assert.equal(boundedFacts(facts,{limit:1}).length,1);
});
