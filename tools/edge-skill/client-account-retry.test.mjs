import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

// 1.9.3 (lane PB): a world restarting behind the proxy answers 502/503 (or nothing) for a few seconds. The approval start
// and poll retry those until their deadline instead of failing; a refused approval prints the server's reason.
test('approval start and wait retry 5xx until an answer, and a refusal carries its reason',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'account-cli-retry-')),id='ap_'+'c'.repeat(32),seen=[];let startFails=1,pollFails=2;
 const reason={code:'arrival-unavailable',message:'Approved, but the Soul could not arrive: no clear ground near the arrival point.'};
 const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;seen.push(req.url);res.setHeader('content-type','application/json');let data;
  if(req.url==='/w/eden/v1/config')data={accountAuthRequired:true,accountApproval:{contract:'account-soul-approval/1'},authReady:true,worldId:'world-one'};
  else if(req.url==='/w/eden/v1/agent/approval/start'){if(startFails-->0){res.statusCode=503;data={code:'restarting'};}else data={approval:{id,worldId:'world-one',status:'pending',name:'Ana',soulId:null}};}
  else if(req.url==='/w/eden/v1/agent/approval/poll'){if(pollFails-->0){res.statusCode=502;res.setHeader('content-type','text/html');res.end('<html>Bad gateway</html>');return;}data={id,worldId:'world-one',status:'refused',name:'Ana',soulId:'s_x',reason};}
  else{res.statusCode=404;data={code:'unexpected-route'};}res.end(JSON.stringify(data));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const cli=resolve('tools/edge-skill/eden-agent.mjs');
 const run=async(...args)=>{const child=spawn(process.execPath,[cli,...args],{cwd:folder,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const code=await new Promise(r=>child.once('exit',r));assert.equal(code,0,stderr);return JSON.parse(stdout);};
 try{
  await run('register','http://127.0.0.1:'+server.address().port+'/w/eden');
  const asked=await run('create-soul','Ana');assert.equal(asked.status,'pending');assert.equal(asked.approvalId,id);
  assert.equal(seen.filter(u=>u.endsWith('/approval/start')).length,2,'one 503, then the same request again');
  const done=await run('approval','wait');
  assert.equal(seen.filter(u=>u.endsWith('/approval/poll')).length,3,'two 502s, then the answer');
  assert.equal(done.status,'refused');assert.equal(done.reason,reason.message);assert.equal(done.reasonCode,'arrival-unavailable');
 }finally{await new Promise(r=>server.close(r));rmSync(folder,{recursive:true,force:true});}
});
