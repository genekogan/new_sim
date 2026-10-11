import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,chmodSync,readFileSync,existsSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

async function scenario(t,{providerHoldMs=0}={}){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-poll-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'bin'));
 const sdk=join(root,'bin','claude');writeFileSync(sdk,`#!${process.execPath}\nlet b='',n=0;process.stdin.on('data',d=>{b+=d;let cut;while((cut=b.indexOf('\\n'))>=0){b=b.slice(cut+1);n++;const result=n===1?{do:[{act:'read:field',params:{seconds:360},protected:true}],owner:'A new reading was requested.'}:n===2?{do:[{act:'walk:tea'}],owner:'Replace the read.'}:{do:[],owner:'The read was protected at the beginning of this question.'};const delay=n===3?${providerHoldMs}:0;setTimeout(()=>console.log(JSON.stringify({type:'result',result:JSON.stringify(result),usage:{input_tokens:10,output_tokens:2}})),delay);}});`);chmodSync(sdk,0o700);
 const waits=[],reads=[],acts=[];let readAt=null,completedAt=null,ownerAt=null,questionAt=null;const timers=[];
 const request=(id,text)=>appendFileSync(join(root,'OWNER-REQUESTS.jsonl'),JSON.stringify({id,t:new Date().toISOString(),text,force:false})+'\n');
 request('owner-read','Start a NEW protected reading at the library.');
 const frame=()=>({tick:1,clock:'12:00',me:{soulId:'s_probe',name:'Probe',place:'field',placePath:['Library'],pos:[0,0],posture:'sitting',activity:{kind:readAt&&!completedAt?'read':'idle'}},near:[],objects:[],doHere:[{id:'read:field',verb:'read',params:{seconds:{max:600}}}],exits:[{walk:'walk:tea',name:'Tea house'}]});
 const server=createServer((req,res)=>{
  const u=new URL(req.url,'http://fixture'),p=u.pathname,json=(v,status=200)=>{const bytes=JSON.stringify(v);res.writeHead(status,{'content-type':'application/json'});res.end(bytes);return Buffer.byteLength(bytes);};
  if(p==='/v1/me')return json({souls:[{id:'s_probe',name:'Probe'}]});
  if(p==='/v1/edge/schema')return json({events:{kinds:{}}});
  if(p==='/v1/edge/conversations')return json({conversations:[]});
  if(p==='/v1/edge/boot')return json({worldId:'fixture-poll-world',apiContract:'eden-edge/1.1',staticEtag:'v1',static:{places:[{id:'field',name:'Library',walkable:true},{id:'tea',name:'Tea house',walkable:true}]},here:frame()});
  if(p==='/v1/edge/here')return json({here:frame()});
  if(p==='/v1/edge/events')return json({error:{code:'fixture-no-sse'}},404);
  if(p==='/v1/edge/wait'){
   const row={at:Date.now(),seconds:Number(u.searchParams.get('timeout')),bytes:0,aborted:false};waits.push(row);
   const timer=setTimeout(()=>{row.bytes=json({events:[],cursor:'c_0'});},row.seconds*1000);res.on('close',()=>{clearTimeout(timer);if(!row.bytes)row.aborted=true;});return;
  }
  if(p==='/v1/edge/act'){
   let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{const body=JSON.parse(raw);acts.push({at:Date.now(),body});if(body.capability!=='read:field')return json({accepted:false,code:'fixture.unexpected-act'});
    readAt=Date.now();const terminalDelay=providerHoldMs?15000:25000;
    timers.push(setTimeout(()=>completedAt=Date.now(),terminalDelay),setTimeout(()=>{ownerAt=Date.now();request('owner-replace','Go to the Tea house now.');},4000),setTimeout(()=>{questionAt=Date.now();request('owner-question','How is the reading going?');},8000));
    return json({accepted:true,receipt:{id:'r_read',capability:'read:field',phase:'started'}});
   });return;
  }
  if(p==='/v1/edge/receipts/r_read'){
   const phase=completedAt?'completed':'started';reads.push({at:Date.now(),phase});return json({receipt:{id:'r_read',soulId:'s_probe',capability:'read:field',phase,endedTick:completedAt?1:null,...(completedAt?{endedAt:{place:'field',pos:[0,0]},outcome:{summary:'Scripted fixture reading completed.',learned:[],produced:[],met:[],untrusted:false}}:{})}});
  }
  return json({error:{code:'not-found'}},404);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));});
 writeFileSync(join(root,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_probe',identity:'synthetic-owner',token:'synthetic-token',cursor:'c_0'}));
 const cli=process.env.EDEN_POLL_ORIGINAL_CLI??resolve('tools/edge-skill/eden-agent.mjs');
 const child=spawn(process.execPath,[cli,'live','--engine','claude','--run-seconds','45'],{cwd:root,env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);t.after(()=>child.kill());
 const rows=()=>existsSync(join(root,'live-log.jsonl'))?readFileSync(join(root,'live-log.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 let stopped=false;const stopper=setInterval(()=>{if(!stopped&&rows().some(r=>r.queueComplete?.id==='owner-read')){stopped=true;writeFileSync(join(root,'STOP'),'fixture completion');child.kill('SIGINT');}},100);t.after(()=>clearInterval(stopper));
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('bounded polling fixture deadline '+output));},55000);child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
 const log=rows(),terminal=log.find(r=>r.terminalReceive?.receiptId==='r_read'),replace=log.find(r=>r.owner?.id==='owner-replace'),question=log.find(r=>r.owner?.id==='owner-question'),stableWaits=waits.filter(w=>w.at+w.seconds*1000>=readAt+10000&&w.at<(completedAt??Infinity));
 const measured={scriptedFakeSDK:true,providerHoldMs,code,acts:acts.map(a=>a.body.capability),waits,reads,ownerNoticeToReplyMs:replace?Date.parse(replace.t)-ownerAt:null,questionNoticeToReplyMs:question?Date.parse(question.t)-questionAt:null,terminalObservationMs:terminal?Date.parse(terminal.t)-completedAt:null,providerHeldNotUniversalLatencyProof:providerHoldMs>0};t.diagnostic(JSON.stringify(measured));
 assert.equal(code,0,output);assert.deepEqual(acts.map(a=>a.body.capability),['read:field'],'nonforce replacement preserves protected work; no stand/new body mutation');assert.ok(replace,'owner request interrupted long wait');assert.ok((replace.owner.results??[]).some(s=>/protected/i.test(s)),'canonical local refusal is reported');assert.ok(question,'independent owner question survives protection');assert.ok(terminal&&log.some(r=>r.queueComplete?.id==='owner-read'),'lost terminal event reconciles canonical receipt and factual completion');
 if(!providerHoldMs){assert.ok(measured.ownerNoticeToReplyMs<=10000,'normal owner notice/reply is bounded independently of stable wait');assert.ok(measured.terminalObservationMs<=10000,'missed event backup wakes queue promptly');assert.ok(stableWaits.length&&stableWaits.every(w=>w.seconds===20),'stable protected read does not make redundant two-second empty waits');}
 else{assert.ok(measured.ownerNoticeToReplyMs>=providerHoldMs,'provider-held response delay is disclosed, not a blanket10s promise');assert.ok(measured.terminalObservationMs>10000,'provider-held terminal gap is recorded, not hidden as a10s PASS');}
 return measured;
}
test('actual CLI stable protected wait reduces redundant HTTP polls while owner replan/question and lost terminal stay prompt',async t=>scenario(t));
test('provider-held turn retains one queue writer; canonical backup survives without asynchronous body dispatch',async t=>scenario(t,{providerHoldMs:25000}));
