// Bind the actual private HTTP caller to fake dependencies; no identity files,
// network, native world or model. This exercises the one composed conflict.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {delegatedOwnerPath} from './client-account.mjs';
import {assertLiveDispatch} from './client-dispatch-authority.mjs';
const source=readFileSync(new URL('./eden-agent.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function call(path,');
const stop=source.indexOf('/** EVENTS-v1:',start);
assert.ok(start>0&&stop>start);
const actualCaller=source.slice(start,stop).trim();
function fixture(live,paused,verdict={accepted:false,code:'canonical-refusal'}){
 let loads=0;const sent=[];
 const call=runInNewContext('('+actualCaller+')',{
  IN_LIVE:live,leaseHeld:()=>paused,assertLiveDispatch,delegatedOwnerPath,
  load:()=>{loads++;return {world:'http://synthetic/w/eden',accountAuth:true,soul:'s_selected',token:'sim_s_selected_synthetic'};},
  need:(state,key)=>state[key],AbortSignal,Buffer,telemetry:null,
  fetch:async(url,options)=>{sent.push({url,options});return {status:200,text:async()=>JSON.stringify(verdict),headers:new Headers()};},
 });
 return {call,sent,loads:()=>loads};
}
test('attended manual account profile still uses selected scoped grant; canonical false remains false',async()=>{
 const f=fixture(false,true);const result=await f.call('/v1/souls/s_selected/profile',{as:'owner',method:'PATCH',body:{name:'Current Name'}});
 assert.equal(f.sent[0].url,'http://synthetic/w/eden/v1/agent/profile');
 assert.equal(f.sent[0].options.headers.authorization,'Bearer sim_s_selected_synthetic');
 assert.equal(f.sent[0].options.method,'PATCH');assert.equal(result.data.accepted,false);
});
test('autonomous mutating account transport stops before credential state or request after takeover',async()=>{
 const f=fixture(true,true);await assert.rejects(f.call('/v1/souls/s_selected/profile',{as:'owner',method:'PATCH',body:{name:'Unsent'}}),e=>e.code==='local.attended'&&e.requestNotSent===true);
 assert.equal(f.loads(),0);assert.equal(f.sent.length,0);
});
test('canonical owner read remains available during takeover and unknown verdict is not accepted',async()=>{
 const f=fixture(true,true,{code:'unknown'});const result=await f.call('/v1/me',{as:'owner'});
 assert.equal(f.sent[0].url,'http://synthetic/w/eden/v1/agent/account-me');assert.equal(result.data.accepted,undefined);
});
test('unpaused auth mutation retains remap; another Soul owner route is never delegated',async()=>{
 const f=fixture(true,false,{accepted:true});const result=await f.call('/v1/souls/s_selected/profile',{as:'owner',method:'PATCH',body:{description:'Synthetic'}});
 assert.equal(result.data.accepted,true);assert.equal(f.sent[0].url,'http://synthetic/w/eden/v1/agent/profile');
 await assert.rejects(f.call('/v1/souls/s_foreign/profile',{as:'owner',method:'PATCH',body:{name:'No'}}),/browser account approval/);assert.equal(f.sent.length,1);
});
