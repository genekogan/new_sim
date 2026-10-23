#!/usr/bin/env node
// Bounded CPU-only qualification, run on Modal/Linux, never on the shared Mac.
// Build web first; node tools/test-harness/eyes-cpu.mjs <outDir>. Fresh fake world; no credentials or paid models.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, openSync, readdirSync, readFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EyesWorker} from '../../apps/server/src/edge/eyes/worker.ts';

if (process.platform !== 'linux') throw new Error('CPU Eyes benchmark runs only in a remote Linux container');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(process.argv[2]||'/out/eyes-cpu');
mkdirSync(out,{recursive:true});mkdirSync(join(out,'empty-assets'),{recursive:true});
const port=5946,origin=`http://127.0.0.1:${port}`,base=origin+'/w/eyes-cpu';
const log=openSync(join(out,'world.log'),'w'),start=performance.now();
const server=spawn(process.execPath,['apps/server/src/main.ts'],{cwd:root,stdio:['ignore',log,log],env:{PATH:process.env.PATH,HOME:process.env.HOME,
  PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH,
  WORLD_KEY:'eyes-cpu',WORLD_ID:'eyes-cpu-1',WORLD_PATH:'/w/eyes-cpu',ENABLE_WORLD_ENGINE:'1',ENGINE:'mars',PORT:String(port),HOST:'127.0.0.1',PUBLIC_URL:origin,
  DEV_AUTH:'1',AUTH_PROVIDER:'none',BRAIN_MODE:'fake',BRAIN_BUDGET_USD_PER_DAY:'0',MIND_DRIVER:'edge',INVITE_REQUIRED:'0',SOUL_LIFECYCLE:'1',SEED_NATIVES:'0',
  DATA_DIR:join(out,'data'),MARS_WEB_DIR:join(out,'empty-assets'),WEB_DIR:join(root,'apps/web/dist'),GENESIS_FILE:join(root,'worlds/templates/hello-hamlet.json'),EDGE_EYES:'off'}});
// every process under this one except the world server's subtree = the Eyes worker and its Chromium
function procs(){const all=new Map();for(const d of readdirSync('/proc')){if(!/^\d+$/.test(d))continue;try{const st=readFileSync(`/proc/${d}/stat`,'utf8'),f=st.slice(st.lastIndexOf(')')+2).split(' ');
  all.set(Number(d),{ppid:Number(f[1]),ticks:Number(f[11])+Number(f[12]),nice:Number(f[16]),comm:st.slice(st.indexOf('(')+1,st.lastIndexOf(')'))});}catch{}}return all;}
function under(all,root,skip){const out=[];for(const [pid] of all){let p=pid,ok=false;while(p&&all.has(p)){if(p===skip)break;if(all.get(p).ppid===root){ok=p!==skip;break;}p=all.get(p).ppid;}if(ok)out.push(pid);}return out;}
async function idleCpu(ms,serverPid){const hz=100,a=procs(),pids=under(a,process.pid,serverPid),t0=performance.now();
  const t0s=new Map(pids.map(p=>[p,threads(p)])),sum=(m,ids)=>ids.reduce((n,id)=>n+(m.get(id)?.ticks??0),0),s0=sum(a,pids),w0=sum(a,under(a,process.pid,-1).filter(p=>!pids.includes(p)));
  await sleep(ms);const b=procs(),secs=(performance.now()-t0)/1000;
  return {seconds:Math.round(secs),workerProcesses:pids.length,workerCpuPercentOfOneCore:+((sum(b,pids)-s0)/hz/secs*100).toFixed(2),
    worldServerCpuPercentOfOneCore:+((sum(b,under(b,process.pid,-1).filter(p=>!pids.includes(p)))-w0)/hz/secs*100).toFixed(2),
    nice:[...new Set(pids.map(p=>a.get(p)?.nice))],names:[...new Set(pids.map(p=>a.get(p)?.comm))].slice(0,8),barPercent:2,
    // where the idle CPU goes: per process (node / chrome --type=...) and the busiest threads
    byProcess:pids.map(p=>({pid:p,type:kind(p),threads:t0s.get(p)?.size??0,pct:+(((b.get(p)?.ticks??0)-(a.get(p)?.ticks??0))/hz/secs*100).toFixed(2)})).sort((x,y)=>y.pct-x.pct),
    topThreads:pids.flatMap(p=>[...(t0s.get(p)??new Map())].map(([tid,t])=>({type:kind(p),thread:t.comm,pct:+(((threads(p).get(tid)?.ticks??t.ticks)-t.ticks)/hz/secs*100).toFixed(2)}))).sort((x,y)=>y.pct-x.pct).slice(0,12)};}
function kind(p){try{const c=readFileSync(`/proc/${p}/cmdline`,'utf8').split(/[\0 ]+/).filter(Boolean);const t=c.find(x=>x.startsWith('--type='));return t?t.slice(7):c[0].split('/').pop();}catch{return '?';}}
function threads(p){const m=new Map();try{for(const t of readdirSync(`/proc/${p}/task`)){try{const st=readFileSync(`/proc/${p}/task/${t}/stat`,'utf8'),f=st.slice(st.lastIndexOf(')')+2).split(' ');m.set(t,{ticks:Number(f[11])+Number(f[12]),comm:st.slice(st.indexOf('(')+1,st.lastIndexOf(')'))});}catch{}}}catch{}return m;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=180000){const end=Date.now()+ms;while(Date.now()<end){try{const result=await fn();if(result)return result;}catch{}await sleep(250);}throw new Error('CPU benchmark timed out');}
let worker;
const report={startedAt:new Date().toISOString(),platform:process.platform,node:process.version,fixture:'hello-hamlet (procedural cottage, pond and knoll; not a full Mars/Arium load)',samples:[]};
try {
  await until(async()=>(await fetch(base+'/healthz')).ok);
  report.worldBootMs=Math.round(performance.now()-start);
  const off=await (await fetch(base+'/v1/edge/view/status')).json();assert.equal(off.eyes.state,'off');
  worker=new EyesWorker({viewerUrl:base+'/'+(process.env.EYES_CPU_QUERY?'?'+process.env.EYES_CPU_QUERY:''),env:{EDGE_EYES_GPU:'swiftshader',EDGE_EYES_CPUS:process.env.EDGE_EYES_CPUS??'',EDGE_EYES_CHROME_ARGS:process.env.EDGE_EYES_CHROME_ARGS??''},timeoutMs:90000});
  await until(()=>worker.status().state==='ready',300000);
  report.workerReadyMs=Math.round(performance.now()-start)-report.worldBootMs;
  report.renderer=worker.status().renderer;assert.match(report.renderer,/swiftshader/i);
  for(const [mode,w,h] of [['eyes',512,320],['eyes',320,180],['map',256,256]]){
    const samples=[];
    for(let i=0;i<8;i++){
      const job={mode,w,h,quality:.7,pose:{p:[0,1.62,0],yaw:i*Math.PI/12,pitch:-.14,vfov:2*Math.atan(h/w)},self:'',show:[],...(mode==='map'?{span:12}:{})};
      const frame=await worker.render(job);assert.ok(frame.jpeg.length>1000);assert.ok(frame.frameTick>=0);
      samples.push(Math.round(frame.ms));if(i===0)writeFileSync(join(out,`${mode}-${w}x${h}.jpg`),frame.jpeg);
    }
    const sorted=[...samples].sort((a,b)=>a-b),p50=sorted[4],p95=sorted[7];
    report.samples.push({mode,w,h,n:samples.length,ms:samples,p50,p95,estimatedFramesPerMinuteAtP95:Math.floor(60000/p95),withinWorldBudget:p95*12<60000});
  }
  // lane soul-eyes-on: the worker's idle CPU (bar <= 2% of one core over 60 s) and its nice level, from /proc
  report.idle=await idleCpu(60_000,server.pid);report.query=process.env.EYES_CPU_QUERY||null;report.cpus=process.env.EDGE_EYES_CPUS||null;report.chromeArgs=process.env.EDGE_EYES_CHROME_ARGS||null;
  // render on demand: the first views after the idle minute wake a sleeping page (bar: p95 <= 5 s)
  const after=[];for(let i=0;i<3;i++){const t=performance.now();await worker.render({mode:'eyes',w:512,h:320,quality:.7,pose:{p:[0,1.62,0],yaw:i,pitch:-.14,vfov:1},self:'',show:[]});after.push(Math.round(performance.now()-t));if(i<2)await new Promise(r=>setTimeout(r,5000));}
  report.afterIdleMs=after;
  report.status=worker.status();assert.ok(report.samples.every(s=>s.withinWorldBudget),'fixture must sustain the 12/minute budget');
  report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{worker?.close();server.kill('SIGTERM');await until(()=>server.exitCode!==null||server.signalCode!==null,10000).catch(()=>server.kill('SIGKILL'));report.finishedAt=new Date().toISOString();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
