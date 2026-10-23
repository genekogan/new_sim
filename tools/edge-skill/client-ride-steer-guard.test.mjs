// 1.9.10 (VEHICLE-STEER): "row a boat" then "row to the bakery" a few seconds later. The ride join receipt stays 'started' for
// the whole ride (the Soul is seated), so the CLI's journey guard refused every steer for 120 s as local.in-progress.
// A ride join is exempt from that guard; every other journey (walks, other object uses) is still protected.
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
const json=(res,x)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));};
async function mounted(t,seen,cap){const dir=mkdtempSync(join(tmpdir(),'ride-steer-guard-'));
 const server=createServer((req,res)=>{const u=new URL(req.url,'http://fixture');let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  if(u.pathname.startsWith('/v1/edge/receipts/'))return json(res,{receipt:{id:'r_walk',capability:cap,phase:'started'}});
  if(u.pathname==='/v1/edge/act'){seen.push({act:JSON.parse(body).capability});return json(res,{accepted:true,receipt:{id:'r_sit',capability:'object:ride-eden-punt:steer',phase:'started',channel:'body'},channel:'body'});}
  if(u.pathname.endsWith('/ack')){seen.push({ack:u.pathname});return json(res,{inbox:{connected:true,latest:{id:'msg_bench',state:'acknowledged'}}});}
  json(res,{});});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_pip',token:'sim_fixture',mode:'edge',lastReceipt:'r_walk',lastActAt:new Date(Date.now()-15_000).toISOString()}));
 const run=async args=>{const child=spawn(process.execPath,[resolve(process.env.R006_CLI_SOURCE??'tools/edge-skill/eden-agent.mjs'),...args],{cwd:dir,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),8000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const code=await new Promise(r=>child.once('exit',r));clearTimeout(timer);assert.equal(code,0,err);return JSON.parse(out);};
 return {run,state:()=>JSON.parse(readFileSync(join(dir,'.eden-agent.json'),'utf8'))};}
test('a seated ride join does not block steering it (row to X right after row a boat)',async t=>{
 const seen=[],m=await mounted(t,seen,'object:ride-eden-punt:join');const d=await m.run(['act','object:ride-eden-punt:steer']);
 assert.equal(d.accepted,true,JSON.stringify(d));assert.deepEqual(seen.map(x=>x.act),['object:ride-eden-punt:steer']);
});
test('other journeys, including non-join object uses, are still guarded',async t=>{
 for(const cap of ['walk:place_bakery','object:e_swing:use','object:ride-eden-punt:joinx']){
  const seen=[],m=await mounted(t,seen,cap);const d=await m.run(['act','object:ride-eden-punt:steer']);
  assert.equal(d.accepted,false,cap);assert.equal(d.code,'local.in-progress',cap);assert.deepEqual(seen,[],cap);
 }
});
