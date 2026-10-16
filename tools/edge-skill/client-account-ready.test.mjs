import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

test('approval wait confirms an already accepted exact Soul grant and does not restart approval',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'approval-ready-')),requests=[];
 let mode='ready';
 const server=createServer(async(req,res)=>{
  requests.push({path:req.url,auth:req.headers.authorization});
  res.setHeader('content-type','application/json');
  if(req.url==='/w/eden/v1/agent/me'){
   if(mode==='revoked'){res.statusCode=401;res.end(JSON.stringify({code:'unauthorized'}));}
   else res.end(JSON.stringify({soul:{id:mode==='mismatch'?'s_other':'s_selected',name:'Selected Soul'}}));
  }else if(req.url==='/w/eden/v1/agent/approval/poll')res.end(JSON.stringify({id:'ap_'+'a'.repeat(32),worldId:'world-one',status:'creating',name:'New Soul',soulId:'s_new'}));
  else{res.statusCode=500;res.end(JSON.stringify({code:'unexpected-route'}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const world='http://127.0.0.1:'+server.address().port+'/w/eden';
 const state={world,worldId:'world-one',accountAuth:true,soul:'s_selected',token:'sim_s_selected_synthetic'};
 const save=patch=>writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({...state,...patch}),{mode:0o600});
 const cli=resolve('tools/edge-skill/eden-agent.mjs');
 const run=async(action)=>{
  const child=spawn(process.execPath,[cli,'approval',action],{cwd:folder,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const code=await new Promise(r=>child.once('exit',r));return {code,stdout,stderr};
 };
 try{
  save({});
  for(const action of ['wait','status']){
   const result=await run(action);assert.equal(result.code,0,result.stderr);
   const ready=JSON.parse(result.stdout);assert.equal(ready.status,'ready');assert.equal(ready.paired,true);
   assert.deepEqual(ready.soul,{id:'s_selected',name:'Selected Soul'});assert.equal(result.stdout.includes('synthetic'),false);
  }
  assert.ok(requests.every(r=>r.path==='/w/eden/v1/agent/me'&&r.auth==='Bearer sim_s_selected_synthetic'));
  mode='revoked';const revoked=await run('wait');assert.equal(revoked.code,1);assert.match(revoked.stderr,/HTTP 401/);
  mode='mismatch';const mismatch=await run('wait');assert.equal(mismatch.code,1);assert.match(mismatch.stderr,/Selected Soul grant differs/);
  const before=requests.length;const cancel=await run('cancel');assert.equal(cancel.code,1);assert.match(cancel.stderr,/No pendingApproval yet/);assert.equal(requests.length,before);
  save({token:undefined});const noGrant=await run('wait');assert.equal(noGrant.code,1);assert.match(noGrant.stderr,/No pendingApproval yet/);assert.equal(requests.length,before);
  save({pendingApproval:{world,worldId:'world-one',approvalId:'ap_'+'a'.repeat(32),input:{pollSecret:'synthetic-poll-secret'}}});
  const pending=await run('status');assert.equal(pending.code,0,pending.stderr);assert.equal(JSON.parse(pending.stdout).status,'creating');assert.equal(requests.at(-1).path,'/w/eden/v1/agent/approval/poll');
 }finally{await new Promise(r=>server.close(r));rmSync(folder,{recursive:true,force:true});}
});
