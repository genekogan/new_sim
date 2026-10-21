// 1.9.8 (SOULSIM-E CLI-1, real Soul agent on eden-2026): the agent asked for "Wren" and waited; the human said "call it Sorrel",
// so it ran `approval cancel; create-soul "Sorrel"` and a new wait. The OLD Wren wait then saw "cancelled" and wiped the folder's
// pending request, which by then was Sorrel's: the Sorrel wait died "No pendingApproval yet", the agent asked again, and the Soul
// the human had approved was left with no folder. A wait whose request is no longer the folder's pending one ends at once and
// changes nothing.
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {randomBytes} from 'node:crypto';

test('a stale approval wait never clears the newer request made after a cancel (no orphan Soul)',async()=>{
 const root=mkdtempSync(join(tmpdir(),'approval-superseded-')),A='ap_'+'a'.repeat(32),approvals=new Map([[A,{id:A,worldId:'w',name:'Wren',status:'pending',soulId:null}]]);
 let newerStarted,startedNewer=new Promise(r=>newerStarted=r),cancelledAt=0;
 const server=createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const body=text?JSON.parse(text):{};res.setHeader('content-type','application/json');
  if(req.url.endsWith('/approval/start')){const id='ap_'+'b'.repeat(32),dto={id,worldId:'w',name:body.name,status:'pending',soulId:null};approvals.set(id,dto);newerStarted();return res.end(JSON.stringify({approval:dto}));}
  const dto=approvals.get(body.approvalId);if(!dto){res.statusCode=404;return res.end(JSON.stringify({message:'unknown approval'}));}
  if(req.url.endsWith('/approval/cancel')){dto.status='cancelled';cancelledAt=Date.now();return res.end(JSON.stringify({approval:dto}));}
  // the old wait's poll that sees "cancelled" lands after the new request exists: the exact order the real agent hit
  if(req.url.endsWith('/approval/poll')){if(dto.status==='cancelled')await startedNewer;return res.end(JSON.stringify(dto));}
  res.statusCode=500;res.end(JSON.stringify({message:'unexpected route'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const world='http://127.0.0.1:'+server.address().port+'/w/eden';
 writeFileSync(join(root,'.eden-agent.json'),JSON.stringify({world,worldId:'w',accountAuth:true,pendingApproval:{world,worldId:'w',approvalId:A,input:{name:'Wren',agentLabel:'Fixture',idempotencyKey:'wren-idempotency-01',pollSecret:randomBytes(32).toString('base64url')}}}),{mode:0o600});
 const cli=process.env.ACCOUNT_CLI_BASELINE??resolve('tools/edge-skill/eden-agent.mjs');
 const spawnCli=(...args)=>{const p=spawn(process.execPath,[cli,...args],{cwd:root,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);return new Promise(r=>p.once('exit',code=>r({code,stdout,stderr,at:Date.now()})));};
 const run=async(...args)=>{const r=await spawnCli(...args);assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout);};
 const pendingNow=()=>JSON.parse(readFileSync(join(root,'.eden-agent.json'),'utf8')).pendingApproval;
 try{
  const oldWait=spawnCli('approval','wait');await new Promise(r=>setTimeout(r,500));
  assert.equal((await run('approval','cancel')).status,'cancelled');
  const sorrel=await run('create-soul','Sorrel');assert.equal(sorrel.status,'pending');const B=pendingNow().approvalId;assert.notEqual(B,A);
  const w=await oldWait;assert.equal(w.code,0,w.stderr);const out=JSON.parse(w.stdout);
  assert.equal(pendingNow()?.approvalId,B,'the newer Sorrel request is still this folder\'s pending one');
  assert.equal(out.status,'superseded','the old wait says its request was replaced');assert.equal(out.newer?.name,'Sorrel');
  assert.ok(w.at-cancelledAt<8000,'the old wait ends within a poll or two, not at its 15-minute deadline');
  const status=await run('approval','status');assert.equal(status.status,'pending');assert.equal(status.name??status.approval?.name??'Sorrel','Sorrel');
 }finally{await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
