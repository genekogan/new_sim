import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paidJson} from './paid.ts';
test('success without a valid provider usage receipt retains the admitted bound',async()=>{
 const original=globalThis.fetch;const settled:number[]=[];
 try{for(const usage of [undefined,{input_tokens:-1},{input_tokens:'3'},{input_tokens:1,output_tokens:NaN}]){
  globalThis.fetch=async()=>new Response(JSON.stringify({usage}),{status:200});
  await assert.rejects(paidJson('anthropic',{model:'claude-haiku-4-5-20251001',max_tokens:10},{},()=>({settle:n=>settled.push(n)})),/receipt/);
 }assert.equal(settled.length,0);
 globalThis.fetch=async()=>new Response(JSON.stringify({usage:{input_tokens:10,output_tokens:2,cache_creation_input_tokens:4,cache_read_input_tokens:10}}),{status:200});
 await paidJson('anthropic',{model:'claude-haiku-4-5-20251001',max_tokens:10},{},()=>({settle:n=>settled.push(n)}));assert.deepEqual(settled,[26/1e6]);
 }finally{globalThis.fetch=original;}
});
