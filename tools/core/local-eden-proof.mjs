// Bounded launcher integration against an explicit disposable copy, never PM's DB.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {openLocalEden} from './local-eden.mjs';
const [input,dataDir,out]=process.argv.slice(2);
assert.ok(input&&dataDir&&out,'explicit input, copied data directory and new proof path');
const a=await openLocalEden({input,dataDir,worldId:'core-local-mvp-proof',port:4959});
const checks=[],req=async(path,owner,body)=>{
  const r=await fetch(a.cfg.publicUrl+path,{method:body?'POST':'GET',headers:{...(owner?{authorization:'Bearer dev:'+owner}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json()};
};
let ws,failure;
try {
  assert.equal(a.db.liveSouls(a.host.worldId).length,0,'explicit distinct fresh world');
  for(const owner of ['alice','bob']){
    const issued=await req('/v1/admin','admin',{action:'invite',uses:1});assert.equal(issued.status,200);
    assert.equal((await req('/v1/invite',owner,{code:issued.body.code})).status,200);
    const created=await fetch(a.cfg.publicUrl+'/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:'+owner,'Content-Type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:owner,description:'Local launcher synthetic invited human owner'})});assert.equal(created.status,202);
    const received=(await created.json()).lifecycle;
    for(let i=0;i<40&&!a.souls.controlReady(a.db.soul(received.soulId));i++)await new Promise(r=>setTimeout(r,20));
    assert.equal(a.souls.controlReady(a.db.soul(received.soulId)),true);
  }
  const old=a.db.liveSouls(a.host.worldId);assert.equal(old.length,2);const alice=old.find(r=>r.owner==='dev:alice');assert.ok(alice);checks.push('two actual invited ordinary human-owned lifecycle Souls control-ready');
  assert.equal(a.host.engine.world.base.campus,'eden-commons');checks.push('fresh registered native Eden safe commons installed');
  assert.equal((await req('/healthz')).status,200);
  const require=createRequire(resolve(input,'apps/server/package.json')),{WebSocket}=require('ws'),frames=[];
  ws=new WebSocket('ws://127.0.0.1:4959/w/eden/ws');
  ws.on('message',b=>frames.push(JSON.parse(String(b))));
  const {PROTO}=await import(pathToFileURL(resolve(input,'packages/protocol/src/index.ts')).href);
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});ws.send(JSON.stringify({t:'hello',proto:PROTO,token:'dev:alice'}));
  for(let i=0;i<100&&!frames.some(f=>f.t==='welcome');i++)await new Promise(r=>setTimeout(r,10));
  const welcome=frames.find(f=>f.t==='welcome');assert.ok(welcome);assert.deepEqual(welcome.you.souls,[alice.id]);checks.push('actual prefixed WebSocket hello selects only current owned body');
  const route='/v1/souls/'+alice.id+'/intent-v2',body={contract:'soul-intent/2',requestId:'local-bootstrap-fake-refusal',op:'upsert',words:'Explore the garden.'};
  const first=await req(route,'alice',body);assert.ok([200,202].includes(first.status));await a.service.settled();
  const terminal=await req(route+'/requests/'+body.requestId,'alice');assert.equal(terminal.status,200);assert.equal(terminal.body.phase,'refused');assert.equal(terminal.body.code,'not-understood');checks.push('real fake-mode V2 receipt truthfully refuses absent compiler');
  assert.equal((await req(route+'/requests/'+body.requestId)).status,401);assert.equal((await req(route+'/requests/'+body.requestId,'bob')).status,404);checks.push('anonymous and foreign lookup reveal no original request');
  const paired=await req('/v1/souls/'+alice.id+'/pair','alice',{});assert.equal(paired.status,200);
  const exchanged=await req('/v1/agent/pair',null,{code:paired.body.code,agent:'local launcher fixture'});assert.equal(exchanged.status,200);
  const agentRead=()=>fetch(a.cfg.publicUrl+'/v1/agent/me',{headers:{authorization:'Bearer '+exchanged.body.token}});
  let r=await agentRead();assert.equal(r.status,200);assert.equal((await r.json()).soul.id,alice.id);
  assert.equal((await req('/v1/souls/'+alice.id+'/revoke','alice',{})).status,200);r=await agentRead();assert.equal(r.status,401);checks.push('actual REST pairing binds one owned Soul; owner revocation invalidates bearer (not exported)');
  assert.equal(a.db.paidCost(),0);assert.equal(a.brain.intentV2Enabled,true);assert.equal(a.cfg.anthropicKey,undefined);checks.push('zero spend/no model key, V2 retries remain disabled');
}catch(e){failure=e;}
finally {ws?.close();await a.close();writeFileSync(out,JSON.stringify({status:failure?'FAIL':'PASS',checks,failure:failure?String(failure):null,input:resolve(input),dataDir:resolve(dataDir),pins:a.pins,paidUSD:0,closed:true,limits:['Actual launcher/HTTP/WS on disposable distinct fresh world, no browser/realAuth/agent-host/MCP session qualification','No automatic text compiler or invented physical fulfilment; fake V2 refuses','PM original DB/service/4970 untouched']},null,2)+'\n',{flag:'wx'});}
if(failure)throw failure;
console.log(JSON.stringify({status:'PASS',checks:checks.length,out}));
