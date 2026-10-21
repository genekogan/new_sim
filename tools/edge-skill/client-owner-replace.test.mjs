// 1.9.7 (SOULSIM-H F5): "go to the horse", then 15 s later "actually sit on the bench". The agent acked the second message
// and ran `act sit:<bench> && wait 30`; the CLI refused the act locally (local.in-progress: the horse walk was still under way)
// and the wait burned 30 s while Pip kept walking away. A message the agent acked after the walk began is the owner's
// replacement: a plain act now goes to the world. Without such an ack the journey guard still holds.
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
const json=(res,x)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));};
async function mounted(t,seen){const dir=mkdtempSync(join(tmpdir(),'owner-replace-'));
 const server=createServer((req,res)=>{const u=new URL(req.url,'http://fixture');let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  if(u.pathname.startsWith('/v1/edge/receipts/'))return json(res,{receipt:{id:'r_walk',capability:'walk:wild-horse-4',phase:'started'}});
  if(u.pathname==='/v1/edge/act'){seen.push({act:JSON.parse(body).capability});return json(res,{accepted:true,receipt:{id:'r_sit',capability:'sit:e_bench',phase:'started',channel:'body'},channel:'body'});}
  if(u.pathname.endsWith('/ack')){seen.push({ack:u.pathname});return json(res,{inbox:{connected:true,latest:{id:'msg_bench',state:'acknowledged'}}});}
  json(res,{});});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_pip',token:'sim_fixture',mode:'edge',lastReceipt:'r_walk',lastActAt:new Date(Date.now()-15_000).toISOString()}));
 const run=async args=>{const child=spawn(process.execPath,[resolve(process.env.R006_CLI_SOURCE??'tools/edge-skill/eden-agent.mjs'),...args],{cwd:dir,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),8000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const code=await new Promise(r=>child.once('exit',r));clearTimeout(timer);assert.equal(code,0,err);return JSON.parse(out);};
 return {run,state:()=>JSON.parse(readFileSync(join(dir,'.eden-agent.json'),'utf8'))};}
test('a walk under way still refuses an act the owner did not ask for (no ack since the walk began)',async t=>{
 const seen=[],m=await mounted(t,seen);const d=await m.run(['act','sit:e_bench']);
 assert.equal(d.accepted,false);assert.equal(d.code,'local.in-progress');assert.match(d.hint,/ack their message, then act it/);
 assert.deepEqual(seen,[],'nothing reached the world');
});
test('after acking the owner\'s new message, a plain act replaces the walk at once',async t=>{
 const seen=[],m=await mounted(t,seen);await m.run(['ack','msg_bench','Got it: dropping the horse, sitting on the bench']);
 assert.ok(m.state().lastOwnerAckAt,'the ack is remembered');
 const d=await m.run(['act','sit:e_bench']);
 assert.equal(d.accepted,true,JSON.stringify(d));assert.deepEqual(seen.filter(x=>x.act).map(x=>x.act),['sit:e_bench']);
 assert.equal(m.state().lastReceipt,'r_sit');
 // the sit is now the newest act: a further unacked act during it is guarded again only for journeys (a sit is not one)
 assert.ok(Date.parse(m.state().lastActAt)>=Date.parse(m.state().lastOwnerAckAt));
});
