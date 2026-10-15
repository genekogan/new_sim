#!/usr/bin/env node
// Bounded CPU-only qualification, run on Modal/Linux, never on the shared Mac.
// Build web first; node tools/test-harness/eyes-cpu.mjs <outDir>. Fresh fake world; no credentials or paid models.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, openSync} from 'node:fs';
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
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=180000){const end=Date.now()+ms;while(Date.now()<end){try{const result=await fn();if(result)return result;}catch{}await sleep(250);}throw new Error('CPU benchmark timed out');}
let worker;
const report={startedAt:new Date().toISOString(),platform:process.platform,node:process.version,fixture:'hello-hamlet (procedural cottage, pond and knoll; not a full Mars/Arium load)',samples:[]};
try {
  await until(async()=>(await fetch(base+'/healthz')).ok);
  report.worldBootMs=Math.round(performance.now()-start);
  const off=await (await fetch(base+'/v1/edge/view/status')).json();assert.equal(off.eyes.state,'off');
  worker=new EyesWorker({viewerUrl:base+'/',env:{EDGE_EYES_GPU:'swiftshader'},timeoutMs:90000});
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
  report.status=worker.status();assert.ok(report.samples.every(s=>s.withinWorldBudget),'fixture must sustain the 12/minute budget');
  report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{worker?.close();server.kill('SIGTERM');await until(()=>server.exitCode!==null||server.signalCode!==null,10000).catch(()=>server.kill('SIGKILL'));report.finishedAt=new Date().toISOString();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
