import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,realpathSync,writeFileSync,mkdirSync,chmodSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('actual CLI loop keeps both owner steps, avoids observe/fullcaps per wake and reports unknown billing',async t=>{
 const folder=mkdtempSync(join(realpathSync(tmpdir()),'eden-live-synthetic-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));const bin=join(folder,'bin');mkdirSync(bin);
 const fake=join(bin,'claude');writeFileSync(fake,`#!${process.execPath}\nlet b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){b=b.slice(i+1);console.log(JSON.stringify({type:'result',result:JSON.stringify({do:[{act:'walk:eden-tea-house'},{say:'Hello from the Tea house.'},{act:'sit:here',for:'3m'}],owner:'Tour complete. All zones mapped.'}),usage:{input_tokens:100,output_tokens:30,cache_read_input_tokens:0,cache_creation_input_tokens:0}}));}});\n`);chmodSync(fake,0o700);
 const paths=[],acts=[],greetings=[],receipts=new Map(),streams=new Set();let place='field',seq=0;
 const places=[{id:'field',name:'Commons',kind:'outdoor',walkable:true,centre:[0,0]},{id:'eden-tea-house',name:'Tea house',kind:'outdoor',walkable:true,centre:[10,0]}];
 const frame=()=>({tick:seq,clock:'12:00',me:{place,placePath:[place],pos:[0,0],posture:'standing',activity:{kind:'idle'}},near:[],objects:[],doHere:[{id:'sit:here',label:'Sit',verb:'sit'}],exits:[{to:'eden-tea-house',name:'Tea house',walk:'walk:eden-tea-house',eta:'1s'}]});
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://synthetic').pathname.replace(/^\/w\/eden/,'');paths.push(path);const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  if(path==='/v1/me')return json({souls:[{id:'s_probe',name:'Probe',description:'Synthetic fixture only'}]});
  if(path==='/v1/edge/schema')return json({events:{kinds:{'receipt.terminal':{}}},plan:{}});
  if(path==='/v1/edge/boot')return json({apiContract:'eden-edge/1.1',staticEtag:'fixture1',static:{places},clock:{absoluteWorldMinutes:720},here:frame()});
  if(path==='/v1/edge/here')return json({here:frame()});
  if(path==='/v1/edge/say'){greetings.push(place);return json({said:{heardBy:0}});}
  if(path==='/v1/edge/calendar')return json({items:[]});
  if(path.startsWith('/v1/edge/receipts/'))return json({receipt:receipts.get(path.split('/').at(-1))??{}});
  if(path==='/v1/edge/events'){res.writeHead(200,{'content-type':'text/event-stream'});streams.add(res);res.write('event: hello\ndata: {}\n\n');req.on('close',()=>streams.delete(res));return;}
  if(path==='/v1/edge/act'){
   let body='';for await(const b of req)body+=b;const action=JSON.parse(body);acts.push(action);const receipt={id:'r'+acts.length,capability:action.capability,phase:'started'};receipts.set(receipt.id,receipt);json({accepted:true,receipt});
   setTimeout(()=>{if(receipt.capability.startsWith('walk:'))place='eden-tea-house';Object.assign(receipt,{phase:'completed',endedTick:++seq,endedAt:{place}});const e={id:'c_'+seq,raw:'receipt',kind:'receipt.terminal',salience:1,data:{receipt}};for(const stream of streams)stream.write('event: message\nid: c_'+seq+'\ndata: '+JSON.stringify(e)+'\n\n');},100);return;
  }
  if(path==='/v1/edge/wait')return setTimeout(()=>json({cursor:'c_'+seq,events:[]}),30);
  res.statusCode=404;json({error:{code:'not-found'}});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of streams)s.end();await new Promise(r=>server.close(r));});
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:`http://127.0.0.1:${server.address().port}/w/eden`,soul:'s_probe',identity:'synthetic-owner',token:'synthetic-only'}));
 const entry=process.env.EDEN_CLIENT_ENTRY??resolve('tools/edge-skill/eden-agent.mjs');
 async function command(arg){const p=spawn(process.execPath,[entry,arg],{cwd:folder,stdio:['ignore','pipe','pipe']});let text='';p.stdout.on('data',d=>text+=d);p.stderr.on('data',d=>text+=d);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{p.kill();reject(Error('bounded '+arg+' deadline'));},3000);p.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error(text));else resolve(JSON.parse(text));});});}
 assert.ok((await command('version')).skillVersion);assert.equal((await command('status')).soul,'s_probe');
 writeFileSync(join(folder,'OWNER-REQUESTS.jsonl'),JSON.stringify({id:'req-probe',t:new Date().toISOString(),text:'Walk to the Tea house and sit there 3 minutes.'})+'\n');
 const child=spawn(process.execPath,[process.env.EDEN_CLIENT_ENTRY??resolve('tools/edge-skill/eden-agent.mjs'),'live','--engine','claude','--run-seconds','6'],{cwd:folder,env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);t.after(()=>child.kill());
 const exit=await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>{child.kill();reject(Error('synthetic CLI deadline '+output));},12000);child.on('exit',code=>{clearTimeout(deadline);resolve(code);});});
 assert.equal(exit,0,output);assert.deepEqual(acts.map(a=>a.capability),['walk:eden-tea-house','sit:here']);assert.equal(acts[1].params.seconds,180);assert.deepEqual(greetings,['eden-tea-house']);
 assert.equal(paths.filter(p=>p==='/v1/edge/observe').length,0);assert.equal(paths.filter(p=>p==='/v1/edge/capabilities').length,0);
 const costs=readFileSync(join(folder,'cost-log.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(costs.length,1,'next body step costs zero fake-model calls');assert.equal(costs[0].usd,null);
 const liveLog=readFileSync(join(folder,'live-log.jsonl'),'utf8').trim().split('\n').map(JSON.parse);const wakes=liveLog.filter(x=>x.wakeStart);assert.equal(wakes.length,1);const fetches=liveLog.filter(x=>x.fetch);assert.ok(fetches.every(x=>Number.isInteger(x.fetch.bytes)&&x.fetch.bytes>=0));const start=liveLog.findIndex(x=>x.wakeStart),end=liveLog.findIndex(x=>x.wakeEnd);const wakeBytes=liveLog.slice(start,end+1).reduce((n,x)=>n+(x.fetch?.bytes??0),0),allBytes=fetches.reduce((n,x)=>n+x.fetch.bytes,0),bootBytes=fetches.filter(x=>x.fetch.path.includes('/boot')).reduce((n,x)=>n+x.fetch.bytes,0);t.diagnostic(JSON.stringify({synthetic:true,modelWakes:wakes.length,fetchResponses:fetches.length,allBytes,bootBytes,wakeBytes,backgroundAndSetupBytes:allBytes-bootBytes-wakeBytes,fullCapabilities:0,observe:0}));
 const state=JSON.parse(readFileSync(join(folder,'.client-queue.json'),'utf8'));assert.ok(state.steps.every(s=>s.status==='completed'));
 const final=readFileSync(join(folder,'OWNER-REPLIES.jsonl'),'utf8').trim().split('\n').map(JSON.parse).at(-1);assert.equal(final.queueComplete,true);assert.equal(final.receipt,'r2');assert.match(final.answer,/Finished 3 ordered steps/);assert.ok(final.initialAnswer);
 const replies=readFileSync(join(folder,'OWNER-REPLIES.jsonl'),'utf8');assert.ok(!replies.includes('All zones mapped'));assert.match(replies,/Retained 3 ordered steps/);
});
