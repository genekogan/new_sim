import test from 'node:test';
import assert from 'node:assert/strict';
import {copyText,manualCopyHint} from './clipboard.ts';

test('copy feedback distinguishes successful writes, denial and a missing clipboard API',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 try{
  const written:string[]=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async(text:string)=>{written.push(text);}}}});
  assert.equal(await copyText('exact prompt'),true);assert.deepEqual(written,['exact prompt']);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{throw Error('denied');}}}});
  assert.equal(await copyText('denied'),false);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
  assert.equal(await copyText('unavailable'),false);
  assert.match(manualCopyHint,/⌘C/);assert.match(manualCopyHint,/Ctrl\+C/);
 }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else Reflect.deleteProperty(globalThis,'navigator');}
});
