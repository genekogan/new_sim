#!/usr/bin/env node
// Coordinator must release the quiet slot before running. Uses only this disposable fixture.
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,openSync,closeSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadavg,freemem} from 'node:os';
import {freeMemGb} from '../playtest/lib/platform.mjs';
import {createHash} from 'node:crypto';
import { artwork } from './fixture-artwork.mjs';
import {createServer} from 'node:net';
import {chromeLease} from '../god-skill/lib/chrome-lease.mjs';
import {genesis,cases,edits} from './fixture.mjs';
import {bindCases} from './bindings.mjs';
import {sourceReceipt} from './source-receipt.mjs';
import {createFixtureSessions} from './fixture-session.mjs';
import {runPhotographerQualification} from './photographer-runner.mjs';
import {runLifecycleRemainder} from './lifecycle-remainder.mjs';
import {runUiLifecycleProof} from './ui-lifecycle-runner.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),launchedAt=Date.now();
const photographer=process.env.CONTEXT_PHOTOGRAPHER==='1';
const uiRemainderOnly=process.env.CONTEXT_UI_REMAINDER_ONLY==='1';
const remainder=process.env.CONTEXT_REMAINDER==='1'||uiRemainderOnly;
const uiProof=process.env.CONTEXT_UI_PROOF==='1'||remainder;
const treatment=process.env.CONTEXT_VIEW_QUALIFY==='1'||photographer||uiProof;
const out=resolve(process.argv[2]??'.lane/context-baseline'),port=5980,base=`http://127.0.0.1:${port}/w/context-baseline`;
if(!process.env.WEB_DIR)throw Error('WEB_DIR must select the verified baseline artifact');
mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'genesis.json'),JSON.stringify(genesis));
const report={sourceReceipt:sourceReceipt(root,process.env.WEB_DIR),source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),fixtureSha:createHash('sha256').update(JSON.stringify({genesis,cases,edits})).digest('hex'),cases,edits,results:[],samples:[],notes:['warm means a second disposable-browser capture with OS caches; existing renderer has no shared cache','No inference. No original or live world data.','Candidate result time includes queue wait and may reuse work already requested by a commit; context-job trace records actual per-job cost.']};
const save=()=>writeFileSync(resolve(out,uiProof?'ui-lifecycle.json':photographer?'photographer.json':treatment?'candidate.json':'baseline.json'),JSON.stringify(report,null,2));
let child,release,monitor,token,claimed=false,phase='startup';
const deadline=process.env.CONTEXT_DEADLINE?Date.parse(process.env.CONTEXT_DEADLINE)-5000:launchedAt+(uiRemainderOnly?150000:uiProof?295000:photographer?235000:treatment?175000:600000);
const hardStop=new AbortController(),hardTimer=setTimeout(()=>hardStop.abort(new Error('absolute measurement deadline')),Math.max(1,deadline-Date.now()));
const boundedFetch=(url,options={})=>globalThis.fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,hardStop.signal]):hardStop.signal});
const setPhase=value=>{phase=value;(report.phases??=[]).push({phase,at:Date.now()});save();};
const slot='<team>/lanes/MEASURE.slot',claim=`${new Date().toISOString()} context-views ${treatment?'candidate':'baseline'} pid=${process.pid} until${new Date(deadline).toISOString()}`;
report.workDeadline=new Date(deadline).toISOString();report.cleanupDeadline=new Date(deadline+5000).toISOString();report.startedAt=new Date().toISOString();report.runnerPid=process.pid;report.ambient={load:loadavg(),freeMb:freemem()/1048576,reclaimableGb:freeMemGb()};
const request=async(path,body,auth=token)=>{if(Date.now()>=deadline)throw Error('measurement deadline');const r=await boundedFetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(auth?{authorization:`Bearer ${auth}`}:{ }),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(Math.max(1,Math.min(65000,deadline-Date.now())))});if(!r.ok)throw Error(`${path} HTTP ${r.status}: ${(await r.text()).slice(0,400)}`);return r;};

async function sample(){if(!child?.pid)return;const start=performance.now();try{const state=await(await request('/v1/edge/platforms')).json();const queryMs=performance.now()-start;const ps=execFileSync('ps',['-axo','pid=,ppid=,rss=,%cpu='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number));const ids=new Set([child.pid]);for(let k=0;k<6;k++)for(const [pid,ppid]of ps)if(ids.has(ppid))ids.add(pid);report.samples.push({at:Date.now(),phase,tick:state.tick,queryMs,load:loadavg(),freeMb:freemem()/1048576,reclaimableGb:freeMemGb(),cpuPercent:ps.filter(([pid])=>ids.has(pid)).reduce((n,r)=>n+r[3],0),rssMb:ps.filter(([pid])=>ids.has(pid)).reduce((n,r)=>n+r[2]/1024,0)});}catch(e){report.samples.push({error:String(e)});}}
try{
 if(loadavg()[0]>=10||freeMemGb()<6)throw Error('baseline ambient limits: load1<10 and free>=6GiB required');
 const current=readFileSync(slot,'utf8').split('\n').filter(l=>l!==process.env.CONTEXT_RESERVED_CLAIM).join('\n');if(current.split('\n').some(l=>l.trim()&&!l.startsWith('#')))throw Error('MEASURE.slot is held');writeFileSync(slot,current+'\n'+claim+'\n');claimed=true;console.log(JSON.stringify({measurement:claim,out}));await new Promise(r=>setTimeout(r,5000));
 await new Promise((yes,no)=>{const p=createServer();p.once('error',no);p.listen(port,'127.0.0.1',()=>p.close(yes));});
 release=await chromeLease('context-views baseline',{slots:1,waitMs:1000});
 if(photographer||uiProof){
  const withFixtureSession=createFixtureSessions({root,out,port,deadline,signal:hardStop.signal,abort:reason=>hardStop.abort(reason),report,save,setPhase,maxStarts:uiRemainderOnly?24:remainder?46:22,maxDownloads:uiRemainderOnly?12:remainder?23:10});
  if(remainder&&!uiRemainderOnly){const lifecycle=await runLifecycleRemainder({withFixtureSession,report,save});if(!lifecycle.functionalPass)throw Error('lifecycle remainder failed; no automatic retry');}
  const evidence=uiProof?await runUiLifecycleProof({root,withFixtureSession,report,save,out,remainder}):await runPhotographerQualification({withFixtureSession,out,deadline,signal:hardStop.signal,report,save,setPhase,cases});
  if(uiProof){report.functionalPass=evidence.functionalPass&&(!remainder||uiRemainderOnly||report.lifecycleRemainder.functionalPass);report.resourcePass=evidence.resourcePass&&(!remainder||uiRemainderOnly||report.lifecycleRemainder.resourcePass);report.pass=report.functionalPass&&report.resourcePass;save();}
  if(!(uiProof?report.pass:evidence.machinePass))process.exitCode=1;
 }else{
 const fd=openSync(resolve(out,'server.log'),'a');
 child=spawn(process.execPath,['apps/server/src/main.ts'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),WORLD_KEY:'context-baseline',WORLD_ID:'context-baseline-1',WORLD_OWNER_ID:'dev:admin',PUBLIC_URL:`http://127.0.0.1:${port}`,GENESIS_FILE:resolve(out,'genesis.json'),DATA_DIR:resolve(out,'data'),ASSET_DIR:resolve(out,'assets'),ENGINE:'mars',DEV_AUTH:'1',AUTH_PROVIDER:'none',SEED_NATIVES:'0',BRAIN_MODE:'fake',MIND_DRIVER:'edge',INVITE_REQUIRED:'0',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0',ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',EDEN_GOD_NO_NPX:'1'},stdio:['ignore',fd,fd]});closeSync(fd);report.pid=child.pid;save();
 for(let i=0;;i++){if(child.exitCode!==null||i>900)throw Error('fixture boot failed; see server.log');try{if((await boundedFetch(base+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 token=(await(await request('/v1/god/mint',{label:'context-baseline'},'dev:admin')).json()).token;
 const assets=[];for(let version=0;version<2;version++){const png=artwork(version);writeFileSync(resolve(out,`artwork-${version}.png`),png);const r=await boundedFetch(base+'/v1/god/assets?name=baseline-artwork&license=CC0',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'image/png'},body:png});if(!r.ok)throw Error(`image upload ${r.status}`);const data=await r.json();assets.push(data);}
 report.assets=assets;
 const first=assets[0].asset??assets[0];const sha=first.sha??first.hash;
 const act=await(await request('/v1/god/act',{ops:[{op:'set',id:'hall/artwork',state:{media:`/assets/${sha}.png`}}]})).json();if(!act.accepted)throw Error('fixture artwork rejected: '+JSON.stringify(act));
 const snap=await(await request('/v1/world/snapshot')).json();report.bindings=cases.map(c=>({id:c.id,target:c.target,entity:snap.entities.find(e=>e.name===c.target.split('/').at(-1))?.id}));report.seq=snap.seq;
 for(let i=0;i<10;i++)await sample();monitor=setInterval(()=>void sample(),500);
 if(treatment){
  report.bindingCorrection='Candidate-v1 selected the whole hall exterior; candidate-v2 guessed ground, a floor rather than a room. This run discovers the actual published enclosed room slot on the unchanged hall geometry.';
  const listing=await(await request('/v1/world/context',undefined,null)).json();
  report.bindings=bindCases(cases,snap.entities,listing.targets);
  report.publishedRoom=report.bindings.find(b=>b.id==='enclosed-room');
  const get=async(refs,detail=true)=>{const t=performance.now(),r=await request('/v1/world/context/views',{refs,detail,sheet:refs.length>1},null),data=await r.json();report.requests??=[];report.requests.push({at:Date.now(),phase,ms:performance.now()-t,statuses:data.views.map(v=>v.status)});return data;};
  const capture=async(c,mode)=>{setPhase(c.id+':'+mode);const binding=report.bindings.find(b=>b.id===c.id),ref=binding.ref??binding.entity;const t=performance.now();let data=await get([ref]);for(let i=0;i<240&&data.views[0].status==='pending';i++){await new Promise(r=>setTimeout(r,1000));data=await get([ref]);}const v=data.views[0],result={id:c.id,mode,ms:performance.now()-t,...v};if(v.url){const r=await request(v.url,undefined,null),png=Buffer.from(await r.arrayBuffer());writeFileSync(resolve(out,`${c.id}-${mode}.png`),png);result.bytes=png.length;}report.results.push(result);save();return v;};
  for(const c of cases)await capture(c,'automatic');
  // Same five cameras as the frozen baseline, expressed in each owner's local coordinates.
  const origins={landmark:[-24,0,0],'enclosed-room':[0,0,0],'interior-seat':[0,0,-2],lake:[0,0,0],'wall-artwork':[-3,1.7,-4.7]};
  const local=(c,p)=>p.map((n,i)=>n-origins[c.id][i]);
  const cameraOps=cases.map(c=>({op:'set',id:c.target,about:{...snap.entities.find(e=>e.name===c.target.split('/').at(-1)).about,viewpoint:{eye:local(c,c.eye),at:local(c,c.at)},...(c.id==='enclosed-room'?{parts:[{id:'room',title:'Lecture room',anchor:{kind:'entity',ref:'hall',slot:report.publishedRoom.slot},viewpoint:{eye:local(c,c.eye),at:local(c,c.at)}}]}:{})}}));
  const authored=await(await request('/v1/god/act',{ops:cameraOps})).json();if(!authored.accepted)throw Error('authored viewpoints refused');
  for(const c of cases)await capture(c,'fixed');
  setPhase('first-contact-sheet');const refs=report.bindings.map(b=>b.ref??b.entity);let batch=await get(refs);for(let i=0;i<30&&batch.sheet?.status==='pending';i++){await new Promise(r=>setTimeout(r,250));batch=await get(refs);}report.batch=batch;
  if(batch.sheet.url){const r=await request(batch.sheet.url,undefined,null);writeFileSync(resolve(out,'contact-sheet.png'),Buffer.from(await r.arrayBuffer()));}
  setPhase('cached-retrieval');for(let i=0;i<30;i++)await get([refs[0]]);
  const original=batch.views.find(v=>v.ref===report.bindings.find(b=>b.id==='wall-artwork').entity)?.original;if(original){const r=await request(original.url,undefined,null);writeFileSync(resolve(out,'original-from-context.png'),Buffer.from(await r.arrayBuffer()));report.original=original;}
  report.lifecycle=[];report.renameCorrection='set about replaces the block; preserve authored viewpoint/parts while applying only the frozen title/what change, so rename is not confounded with camera removal.';
  for(const edit of edits){
   setPhase('edit:'+edit.id);const before=(await get([refs[edit.id==='asset-replace'?4:0]])).views[0];
   const asset=assets[1].asset??assets[1],ops=edit.id==='rename'?edit.ops.map(op=>({...op,about:{...cameraOps.find(camera=>camera.id===op.id).about,...op.about}})):edit.ops??[{op:'set',id:edit.target,state:{media:`/assets/${asset.sha??asset.hash}.png`}}];
   const accepted=await(await request('/v1/god/act',{ops})).json();if(!accepted.accepted)throw Error('lifecycle refused '+edit.id);
   const oldStatus=before.url?(await boundedFetch(base+before.url)).status:null;
   if(edit.then==='undo'){const undo=await(await request('/v1/god/undo',{})).json();if(!undo.accepted)throw Error('undo refused');}
   const view=await capture(cases[edit.id==='asset-replace'?4:0],edit.id);
   report.lifecycle.push({id:edit.id,oldStatus,beforeKey:before.key,afterKey:view.key,status:view.status,original:view.original});save();
  }
  setPhase('idle');
  report.idleStart=performance.now();await new Promise(r=>setTimeout(r,1000));report.idleMs=performance.now()-report.idleStart;
 }else{
 for(const c of cases)for(const temperature of ['cold','warm']){const t=performance.now();try{const r=await request('/v1/god/look',{eye:c.eye,at:c.at,width:640,height:448,hour:'10:30',weather:'clear'}),png=Buffer.from(await r.arrayBuffer());writeFileSync(resolve(out,`${c.id}-${temperature}.png`),png);report.results.push({id:c.id,temperature,ms:performance.now()-t,bytes:png.length,size:r.headers.get('x-look-size')});}catch(e){report.results.push({id:c.id,temperature,ms:performance.now()-t,error:String(e)});}save();}
 }
}
}catch(e){report.error=String(e);process.exitCode=1;}finally{clearTimeout(hardTimer);clearInterval(monitor);if(child){child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)return r();const t=setTimeout(()=>{child.kill('SIGKILL');r();},3000);child.once('exit',()=>{clearTimeout(t);r();});});}release?.();if(claimed)writeFileSync(slot,readFileSync(slot,'utf8').split('\n').filter(l=>l!==claim).join('\n'));report.endedAt=new Date().toISOString();report.cleanupWithinDeadline=Date.now()<=deadline+5000;save();console.log(JSON.stringify({out,results:report.results,error:report.error}));}
