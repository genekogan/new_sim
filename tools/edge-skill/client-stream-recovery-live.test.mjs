import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,chmodSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

async function recovery(t,{fault='stall-after-hello',failFirst=false}={}){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-stream-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'bin'));
 const fake=join(root,'bin','claude');writeFileSync(fake,`#!${process.execPath}\nlet b='';process.stdin.on('data',d=>{b+=d;let cut;while((cut=b.indexOf('\\n'))>=0){b=b.slice(cut+1);console.log(JSON.stringify({type:'result',result:JSON.stringify({do:[]}),usage:{input_tokens:10,output_tokens:2}}));}});`);chmodSync(fake,0o700);
 const streams=new Set(),waits=[];let faultAt,successAt,posts=0;
 const frame={tick:1,clock:'12:00',me:{place:'field',placePath:['Commons'],pos:[0,0],posture:'standing',activity:{kind:'idle'}},near:[],objects:[],doHere:[],exits:[]};
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture'),path=url.pathname,json=(x,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(x));};
  if(req.method==='POST')posts++;
  if(path==='/v1/me')return json({souls:[{id:'s_probe',name:'Probe'}]});
  if(path==='/v1/edge/schema')return json({events:{kinds:{}}});
  if(path==='/v1/edge/boot')return json({worldId:'fixture-recovery-world',apiContract:'eden-edge/1.1',staticEtag:'v1',static:{places:[{id:'field',name:'Commons',walkable:true}]},here:frame});
  if(path==='/v1/edge/here')return json({here:frame});
  if(path==='/v1/edge/conversations')return json({conversations:[]});
  if(path==='/v1/edge/events'){
   streams.add(res);req.on('close',()=>streams.delete(res));res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();faultAt??=Date.now();
   if(fault==='stall-after-hello')res.write('event: hello\ndata: {}\n\n');
   return;
  }
  if(path==='/v1/edge/wait'){
   const seconds=Number(url.searchParams.get('timeout')),recovering=faultAt&&Date.now()-faultAt>=(fault==='no-hello'?5000:35000)-100;waits.push({seconds,at:Date.now(),after:url.searchParams.get('after'),recovering});
   if(failFirst&&recovering&&waits.filter(x=>x.recovering).length===1)return json({error:{code:'synthetic-transient'}},503);
   const timer=setTimeout(()=>{json({events:[],cursor:'c_0'});if(recovering){successAt??=Date.now();writeFileSync(join(root,'STOP'),'fixture complete');for(const s of streams)s.end();}},seconds*1000);res.on('close',()=>clearTimeout(timer));return;
  }
  return json({error:{code:'not-found'}},404);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of streams)s.end();server.closeAllConnections();await new Promise(r=>server.close(r));});
 writeFileSync(join(root,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_probe',identity:'synthetic-owner',token:'synthetic-token',cursor:'c_0'}));
 const child=spawn(process.execPath,[resolve('tools/edge-skill/eden-agent.mjs'),'live','--engine','claude','--run-seconds','65'],{cwd:root,env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);t.after(()=>child.kill());
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('finite fixture deadline '+output));},75000);child.on('exit',code=>{clearTimeout(timer);resolve(code)});});
 const rows=readFileSync(join(root,'live-log.jsonl'),'utf8').trim().split('\n').map(JSON.parse),fallback=rows.find(x=>x.stream?.reason===(fault==='no-hello'?'hello-timeout':'frame-timeout'));
 const recoveryWaits=waits.filter(x=>fallback&&x.at>=Date.parse(fallback.t)-20);const measured={fault,waits,recoveryWaits,successMs:successAt-faultAt,fallbackMs:fallback?Date.parse(fallback.t)-faultAt:null,posts,code};console.log('recovery-first-trace '+JSON.stringify(measured));
 assert.equal(code,0,output);assert.ok(fallback,'actual default watchdog emits fallback');assert.equal(posts,0,'idle synthetic mind issues no body/public mutations');assert.ok(!rows.some(x=>x.actSubmit));assert.equal(recoveryWaits[0].seconds,2,'first recovery wait must be2s, not ordinary idle20s');assert.ok(measured.successMs<=40000,'first successful automatic wait must arrive within40s');
 if(failFirst)assert.equal(recoveryWaits[1].seconds,2,'failed HTTP wait must retain recovery bound until successful200');
 assert.equal(JSON.parse(readFileSync(join(root,'.eden-agent.json'),'utf8')).cursor,'c_0','normal successful wait reconciles actual returned cursor');
}
test('actual default frame watchdog recovers a no-event idle stream through bounded automatic wait',async t=>recovery(t));
test('hello timeout retains bounded recovery across a failed wait response',async t=>recovery(t,{fault:'no-hello',failFirst:true}));
