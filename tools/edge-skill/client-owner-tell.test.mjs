import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

for(const [status,phase,answer,inProgress] of [
 ['running','started','I have started the nap.',true],
 ['waiting','waiting','The walk is waiting; it has not started.',true],
 ['blocked','failed','The world refused this action.',false],
 ['completed','completed','The nap is complete.',false],
 ['superseded','cancelled','That earlier nap was started.',false],
])test(`tell wait returns the available ${status} answer without confusing an answer with physical completion`,async t=>{
 const root=mkdtempSync(join(tmpdir(),'eden-owner-tell-')); // synthetic fixture retained for inspection
 const receipt={id:'r_fixture',capability:'nap:here',phase};
 const server=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({receipt}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 writeFileSync(join(root,'.eden-agent.json'),JSON.stringify({world:`http://127.0.0.1:${server.address().port}/w/fixture`,soul:'s_fixture',agent:'synthetic-token',mode:'edge'}));
 writeFileSync(join(root,'.soul-live.lock'),JSON.stringify({pid:process.pid}));
 let request=null;
 const poll=setInterval(()=>{const file=join(root,'OWNER-REQUESTS.jsonl');if(request||!existsSync(file))return;request=JSON.parse(readFileSync(file,'utf8').trim());
  const queue={id:request.id,source:'owner',steps:[{id:'step_fixture',status,act:'nap:here'}]};
  writeFileSync(join(root,'.client-queue.json'),JSON.stringify(status==='superseded'?{id:'newer-owner-request',steps:[{status:'running'}]}:queue));
  if(status==='superseded')queue.steps[0].status='running'; // reply retains an old snapshot; current queue owns the truth
  writeFileSync(join(root,'OWNER-REPLIES.jsonl'),JSON.stringify({id:request.id,t:new Date().toISOString(),text:request.text,answer,answerSource:'execution-verdict',results:[answer],receipt:receipt.id,queue,latencySeconds:0,...(status==='completed'?{queueComplete:true,initialAnswer:{text:'I have started the nap.'}}:{})})+'\n');
 },10);t.after(()=>clearInterval(poll));
 const child=spawn(process.execPath,[resolve('tools/edge-skill/eden-agent.mjs'),'tell','Take a three-minute nap.','--wait','3'],{cwd:root,stdio:['ignore','pipe','pipe']});
 let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
 const code=await new Promise(resolve=>{const timeout=setTimeout(()=>child.kill('SIGTERM'),8000);child.once('exit',code=>{clearTimeout(timeout);resolve(code);});});
 assert.equal(code,0,error);const result=JSON.parse(output);assert.equal(result.id,request.id);assert.equal(result.answer,answer);assert.equal(result.inProgress,inProgress);assert.equal(result.completed,status==='completed');assert.equal(result.receipt.id,'r_fixture');assert.equal(result.receipt.phase,phase);assert.equal(result.outcome,undefined);assert.deepEqual(result.did,[answer]);
});
