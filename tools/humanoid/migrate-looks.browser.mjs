#!/usr/bin/env node
// Fresh-world proof of the release-owner migration hook. No live data/credentials.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,openSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromeLease} from '../god-skill/lib/chrome-lease.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=resolve(process.env.BODIES_PROOF_OUT??'<team>/scratch/bodies/migration');
const port=5940,slug='bodies',base=`http://127.0.0.1:${port}/w/${slug}`;
mkdirSync(out,{recursive:true});
const data=resolve(out,'data');rmSync(data,{recursive:true,force:true});
const report={startedAt:new Date().toISOString(),steps:[],shots:[],pageErrors:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,release;
const env={...process.env,PORT:String(port),HOST:'127.0.0.1',WORLD_KEY:slug,WORLD_ID:'bodies-1',WORLD_PATH:'/w/bodies',ENGINE:'mars',MIND_DRIVER:'edge',BRAIN_MODE:'fake',
  DATA_DIR:data,MARS_WEB_DIR:resolve(root,'.lane/mars-web'),PUBLIC_URL:`http://127.0.0.1:${port}`,BIRTH_LOOKS:'0',SEED_NATIVES:'0',SOUL_LIFECYCLE:'1',INVITE_REQUIRED:'0',DEV_AUTH:'1',EDGE_FADING:'0',TAKES_PERSIST:'0',
  ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',TYPESAFE_API_KEY:'',LEGACY_LOOKS_MODE:'',LEGACY_LOOKS_SOCIAL_PRESETS:'0'};
async function boot(mode=''){
  const log=resolve(out,`server-${mode||'before'}.log`),fd=openSync(log,'a');
  server=spawn(process.execPath,[resolve(root,'apps/server/src/main.ts')],{cwd:root,env:{...env,LEGACY_LOOKS_MODE:mode},stdio:['ignore',fd,fd]});
  for(let n=0;n<1200;n++){
    if(server.exitCode!==null)throw Error(`server exited: ${readFileSync(log,'utf8').slice(-1500)}`);
    try{if((await fetch(base+'/healthz')).ok)return;}catch{}
    await wait(100);
  }throw Error('fresh bodies world did not boot');
}
async function halt(){if(!server)return;const child=server;server=null;const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}
async function req(path,body,owner='bodies',method=body===undefined?'GET':'POST'){
  const r=await fetch(base+path,{method,headers:{authorization:`Bearer dev:${owner}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;
}
async function step(name,fn){const value=await fn();report.steps.push({name,ok:true,value});console.log('PASS '+name);return value;}
async function frame(page,name){
  // Select a resident through its visible name, then use real wheel input to frame it.
  const label=page.locator('b').filter({hasText:new RegExp('^'+name+'$')}).first();
  await label.waitFor({state:'visible',timeout:120000});
  await label.click();await wait(700);
  for(let k=0;k<3;k++){
    const box=await label.boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height+45);
    await page.mouse.wheel(0,-360);await wait(600);
  }
  await wait(1500);
}
async function shoot(stage,names){
  const {chromium}=createRequire(resolve(root,'mars/viewer/package.json'))('@playwright/test');
  release=await chromeLease('bodies');
  try{
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
    for(const dpr of [1,2])for(const name of names){
      const page=await browser.newPage({viewport:{width:1000,height:760},deviceScaleFactor:dpr});
      page.on('pageerror',e=>report.pageErrors.push(e.message));
      await page.goto(base+'?dev=1',{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForSelector('canvas',{timeout:120000});await wait(7000);await frame(page,name);
      const renderer=await page.evaluate(()=>{const gl=document.querySelector('canvas')?.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;});
      assert.match(renderer??'',/Apple|Metal/,'real GPU required');
      const path=resolve(out,`${stage}-dpr${dpr}-${name}.png`);await page.screenshot({path,timeout:120000});
      report.shots.push({stage,dpr,name,path,renderer});await page.close();
    }
  }finally{await browser?.close();browser=null;release?.();release=null;}
}
try{
  await boot();
  const names=['Mira','Theo','Jules'],souls=[];
  await step('create the same three legacy residents in a fresh dev world',async()=>{
    for(const name of names){const r=await req('/v1/souls',{name,description:'Bodies migration proof fixture'},name);souls.push({id:r.soul.id,name});}
    return souls;
  });
  await shoot('before',names);await halt();
  await boot('plan');
  await step('plan records three candidates without assigning a look',async()=>{
    const lines=readFileSync(resolve(out,'server-plan.log'),'utf8').split('\n'),line=lines.find(l=>l.startsWith('[legacy-looks]'));
    const r=JSON.parse(line.slice('[legacy-looks]'.length));assert.equal(r.planned.length,3);assert.equal(r.migrated.length,0);return {planned:r.planned.length,migrated:0};
  });await halt();await boot('apply');
  await step('apply logs three exact legacy looks with no deferrals',async()=>{
    const line=readFileSync(resolve(out,'server-apply.log'),'utf8').split('\n').find(l=>l.startsWith('[legacy-looks]'));
    const r=JSON.parse(line.slice('[legacy-looks]'.length));assert.equal(r.migrated.length,3);assert.equal(r.deferred.length,0);return r;
  });
  await shoot('after',names);await halt();await boot('rollback');
  await step('rollback compensates all three assignments',async()=>{
    const line=readFileSync(resolve(out,'server-rollback.log'),'utf8').split('\n').find(l=>l.startsWith('[legacy-looks]'));
    const r=JSON.parse(line.slice('[legacy-looks]'.length));assert.equal(r.restored.length,3);assert.equal(r.deferred.length,0);return r;
  });await halt();
  // A final ordinary boot neither remigrates nor removes the residents.
  await boot();await step('ordinary restart retains the three original identities',async()=>{
    for(const name of names){const mine=await req('/v1/me',undefined,name);assert.equal(mine.souls[0].id,souls.find(s=>s.name===name).id);}
    return {identitiesPreserved:3};
  });assert.deepEqual(report.pageErrors,[]);
}catch(error){report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);}
finally{await browser?.close();release?.();await halt();report.finishedAt=new Date().toISOString();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log('Report '+resolve(out,'report.json'));}
