#!/usr/bin/env node
// Resident looks v2, real-Chrome proof on a fresh dev world (fake minds, dev auth, lane-D port 6360, no live data).
//   node tools/humanoid/looks-v2.browser.mjs <stage> [--no-portraits] [--looks <file.json>]
// Creates the residents, sets each look through the owner route (PUT /v1/souls/:id/look, as an owner's agent would),
// waits for the automatic portraits (unless --no-portraits: the "before" behaviour, the viewer's own 96 px render),
// then selects each resident with a real click on its name in the world and shoots the page and its Soul card at dpr 1
// and 2. Writes <out>/<stage>-*.png, the stored portraits and report-<stage>.json.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,openSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import { scratchDir } from '../lib/paths.mjs';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),stage=args[0]??'after',portraits=!args.includes('--no-portraits');
const looksFile=args.includes('--looks')?args[args.indexOf('--looks')+1]:null;
const out=resolve(process.env.LOOKS_PROOF_OUT??scratchDir('r3d/proof'));
const port=Number(process.env.LOOKS_PROOF_PORT??6360),slug='looks',base=`http://127.0.0.1:${port}/w/${slug}`;
mkdirSync(out,{recursive:true});
const data=resolve(out,'data-'+stage);rmSync(data,{recursive:true,force:true});
const LOOKS=looksFile?JSON.parse(readFileSync(looksFile,'utf8')):{
  Mira:{frame:'fem',face:'soft',hair:'bob',hat:'sunhat',glasses:'round',skin:'#8f5b3f',hair1:'#2b1d14',top:'shirt',pattern:'stripes',top1:'#a03a3a',top2:'#f0eee6'},
  Theo:{preset:'punk',height:1.85}};
const report={stage,portraits,startedAt:new Date().toISOString(),steps:[],shots:[],pageErrors:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,release;
const env={...process.env,PORT:String(port),HOST:'127.0.0.1',WORLD_KEY:slug,WORLD_ID:'looks-1',WORLD_PATH:'/w/'+slug,ENGINE:'mars',MIND_DRIVER:'edge',BRAIN_MODE:'fake',
  DATA_DIR:data,MARS_WEB_DIR:resolve(root,'mars/viewer/public'),PUBLIC_URL:`http://127.0.0.1:${port}`,BIRTH_LOOKS:'0',SEED_NATIVES:'0',SOUL_LIFECYCLE:'1',INVITE_REQUIRED:'0',DEV_AUTH:'1',EDGE_FADING:'0',TAKES_PERSIST:'0',
  ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',TYPESAFE_API_KEY:'',SIM_AUTO_PORTRAITS:portraits?'1':'0'};
async function boot(){
  const log=resolve(out,`server-${stage}.log`),fd=openSync(log,'w');
  server=spawn(process.execPath,[resolve(root,'apps/server/src/main.ts')],{cwd:root,env,stdio:['ignore',fd,fd]});
  for(let n=0;n<1200;n++){if(server.exitCode!==null)throw Error(`server exited: ${readFileSync(log,'utf8').slice(-1500)}`);try{if((await fetch(base+'/healthz')).ok)return;}catch{}await wait(100);}
  throw Error('fresh looks world did not boot');
}
async function halt(){if(!server)return;const child=server;server=null;const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}
async function req(path,body,owner,method=body===undefined?'GET':'POST'){
  const r=await fetch(base+path,{method,headers:{authorization:`Bearer dev:${owner}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await r.json();assert.equal(r.status,200,path+' '+JSON.stringify(value));return value;
}
async function step(name,fn){const value=await fn();report.steps.push({name,ok:true,value});console.log('PASS '+name);return value;}
async function frame(page,name){
  const label=page.locator('b').filter({hasText:new RegExp('^'+name+'$')}).first();
  await label.waitFor({state:'visible',timeout:120000});await label.click();await wait(700);
  for(let k=0;k<3;k++){const box=await label.boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height+45);await page.mouse.wheel(0,-360);await wait(600);}
  await wait(1500);
}
try{
  await boot();const souls={};
  await step('create residents and set their looks through the owner route',async()=>{
    for(const [name,look] of Object.entries(LOOKS)){
      const r=await req('/v1/souls',{name,description:'Looks v2 proof resident'},name);souls[name]=r.soul.id;
      for(let n=0;n<100;n++){const rr=await fetch(base+'/v1/souls/'+r.soul.id+'/look',{method:'PUT',headers:{authorization:`Bearer dev:${name}`,'content-type':'application/json'},body:JSON.stringify(look)});
        const v=await rr.json();if(rr.status===200){souls[name]={id:r.soul.id,body:v.body};break;}if(rr.status!==409)throw Error('look refused '+JSON.stringify(v));await wait(300);}
      assert.ok(souls[name].body,'look applied for '+name);
    }
    return souls;
  });
  if(portraits)await step('automatic portraits stored for every resident',async()=>{
    const got={};
    for(const [name,s] of Object.entries(souls)){
      for(let n=0;n<300&&!got[name];n++){const me=await req('/v1/me',undefined,name),p=me.souls.find(x=>x.id===s.id)?.profile;if(p?.photoSource==='auto')got[name]=p.photo;else await wait(200);}
      assert.ok(got[name],'auto portrait for '+name);
      const png=Buffer.from(await (await fetch(`http://127.0.0.1:${port}${got[name].url}`)).arrayBuffer());writeFileSync(resolve(out,`${stage}-portrait-${name}.png`),png);
    }
    return got;
  });
  const {chromium}=createRequire(resolve(root,'mars/viewer/package.json'))('@playwright/test');
  release=await chromeLease('r3d-looks');
  try{
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
    for(const dpr of [1,2])for(const name of Object.keys(LOOKS)){
      const page=await browser.newPage({viewport:{width:1100,height:760},deviceScaleFactor:dpr});
      page.on('pageerror',e=>report.pageErrors.push(e.message));
      await page.goto(base+'?dev=1',{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForSelector('canvas',{timeout:120000});await wait(7000);await frame(page,name);
      assert.equal(await page.getByText(/look could not be composed/).count(),0,'the composed body must load');
      const renderer=await page.evaluate(()=>{const gl=document.querySelector('canvas')?.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;});
      assert.match(renderer??'',/Apple|Metal/,'real GPU required');
      const card=page.locator('.soul-card').first();await card.waitFor({state:'visible',timeout:30000});await wait(2500);
      const avatar=await card.locator('.soul-card-portrait img').first().getAttribute('data-avatar-source').catch(()=>null);
      const path=resolve(out,`${stage}-dpr${dpr}-${name}.png`),cardPath=resolve(out,`${stage}-dpr${dpr}-${name}-card.png`);
      await page.screenshot({path,timeout:120000});await card.screenshot({path:cardPath,timeout:60000});
      report.shots.push({dpr,name,path,cardPath,renderer,avatar});console.log('shot',name,'dpr',dpr,'avatar',avatar);await page.close();
      if(portraits)assert.equal(avatar,'profile-photo','the card shows the stored portrait');
    }
  }finally{await browser?.close();browser=null;release?.();release=null;}
  assert.deepEqual(report.pageErrors,[]);
}catch(error){report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);}
finally{await browser?.close();release?.();await halt();report.finishedAt=new Date().toISOString();writeFileSync(resolve(out,`report-${stage}.json`),JSON.stringify(report,null,2));console.log('Report '+resolve(out,`report-${stage}.json`));}
