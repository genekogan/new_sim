// Entry 40 (M04 integration) real-client check of the shared motion changes against earlier validated entries: on ONE
// integrated world, two ordinary paired Soul CLI seats with different bodies each switch on the floor lamp (entry 1), open
// and close the door (entry 2), turn the garden tap on and off (15/28) and light the candle (22), walking with stops
// between them, by plain words. Camera fixed and read-only; frames stamped with the depicted tick; the drawn rig of every
// body sampled every ~50 ms (palms, hips, feet, head, walk weight, idle variety) for m04i-metrics.py.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const run=promisify(execFile);
const scene=process.env.SOUL_M04I_SCENE??'<team>/soul-actions/day-40/scene',out=process.env.SOUL_M04I_OUT??'<team>/soul-actions/day-40/visual-01',port=Number(process.env.SOUL_M04I_PORT??7872),base=`http://127.0.0.1:${port}/w/soul-m04i`;mkdirSync(out,{recursive:true});
const seats=JSON.parse(process.env.SOUL_M04I_SEATS??'{"ada":"Ada","ben":"Ben"}');
const cliSrc=new URL('../world-launcher/soul/eden.mjs',import.meta.url).pathname;
const cli=async(seat,args,timeout=200000)=>JSON.parse((await run(process.execPath,['eden.mjs',...args,'--json'],{cwd:scene+'/'+seat,timeout})).stdout);
const ids={};for(const [seat,name] of Object.entries(seats)){const dir=scene+'/'+seat;mkdirSync(dir,{recursive:true});if(!existsSync(dir+'/.eden-agent.json')){copyFileSync(cliSrc,dir+'/eden.mjs');await cli(seat,['register',base]);await cli(seat,['create',name]);}const st=await cli(seat,['status']);ids[seat]=st.soul?.id?'h_'+st.soul.id.slice(2):null;}
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false,viewport=null;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'m04i-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const NAMES=['reading-lamp','garden-door','garden-tap','candle'];
const sample=()=>page.evaluate(NAMES=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,frame:api.renderer?.info?.render?.frame??null,motion:e.state?.handActuator??null,bones:{activity:b.activity,walkW:b.walkW,hipY:b.hipY,feet:b.feet,head:b.head,pose:b.pose,variety:b.variety??null,dims:b.dims??null,arms:b.arms.map(a=>({side:a.side,palm:a.palm,target:a.target,err:a.err}))}});}const things={};for(const e of api.layer.model.entities.values())if(NAMES.includes(e.name))things[e.name]={on:e.state?.on,open:e.state?.open};return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,things};},NAMES);
const act=async(seat,words)=>{const start=Date.now(),tick=await page.evaluate(()=>window.__simEntity.depictedTick),r=await run(process.execPath,['eden.mjs','act',words,'--wait','120','--json'],{cwd:scene+'/'+seat,timeout:180000}),result=JSON.parse(r.stdout);commands.push({seat,body:ids[seat],words,start,sentTick:tick,end:Date.now(),result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt?.phase,'completed',JSON.stringify(result));return result;};
const STEPS=JSON.parse(process.env.SOUL_M04I_STEPS??JSON.stringify([
 ['ada','turn on the reading lamp'],['ada','open the garden door'],['ada','close the garden door'],['ada','turn on the garden tap'],['ada','turn off the garden tap'],['ada','light the candle'],['ada','put out the candle'],['ada','turn off the reading lamp'],
 ['ben','turn on the reading lamp'],['ben','open the garden door'],['ben','close the garden door'],['ben','turn on the garden tap'],['ben','turn off the garden tap'],['ben','light the candle']]));
try{
 await post('/v1/god/env',{timeOfDay:'16:30',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+(process.env.SOUL_M04I_EYE??'/?eye=0.2,4.2,-2.6&at=0.2,0.9,5.6'));await page.waitForFunction(n=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=n,Object.keys(seats).length,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 writeFileSync(out+'/initial.yml',await page.locator('body').ariaSnapshot());
 viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio}));
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 await page.waitForTimeout(3000);
 for(const [seat,words] of STEPS){await act(seat,words);await page.waitForTimeout(3500);}
 await page.waitForTimeout(3000);
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,ids,commands,samples,errors,viewport,method:'Real full client, two ordinary paired Soul CLI seats (different bodies), plain words; camera fixed; samples of the drawn rig of every body every ~50 ms.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
