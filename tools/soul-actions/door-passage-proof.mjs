// Entry 31 real-client proof: two ordinary paired Soul CLI seats (Ada, Bea), plain words only, walk through the courtyard
// door: one passage in; both at once from opposite sides; one out; one following the other; and a locked door refused.
// Camera fixed and read-only; frames stamped with the depicted tick; uncut continuous recording; samples every 50 ms.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const run=promisify(execFile),scene=process.env.SOUL_DOOR_SCENE??'<team>/soul-actions/day-31/scene',out=process.env.SOUL_DOOR_OUT??'<team>/soul-actions/day-31/visual-01',base='http://127.0.0.1:7872/w/soul-door-passage';mkdirSync(out,{recursive:true});
const cliSrc=new URL('../world-launcher/soul/eden.mjs',import.meta.url).pathname;
const cli=async(seat,args,timeout=200000)=>JSON.parse((await run(process.execPath,['eden.mjs',...args,'--json'],{cwd:scene+'/'+seat,timeout})).stdout);
// seats: an ordinary paired CLI each (register <url>, then create "<Name>")
const seats={ada:'Ada',bea:'Bea'},ids={};
for(const [seat,name] of Object.entries(seats)){const dir=scene+'/'+seat;mkdirSync(dir,{recursive:true});if(!existsSync(dir+'/.eden-agent.json')){copyFileSync(cliSrc,dir+'/eden.mjs');await cli(seat,['register',base]);await cli(seat,['create',name]);}const st=await cli(seat,['status']);ids[seat]=st.entityId??st.soul?.entityId??st.body?.entityId??null;}
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage(),errors=[],samples=[],commands=[],marks=[];let busy=false,timer,pass=false;page.on('pageerror',e=>errors.push(String(e)));
const frame=()=>page.evaluate(()=>{const a=window.__simEntity,f=a.contactFrame();if(!f?.bones)return null;const d=[...a.layer.model.entities.values()].find(e=>e.name==='courtyard-door'),s=[...a.layer.model.entities.values()].find(e=>e.name==='store-door');
 return {at:Date.now(),tick:f.tick,dt:f.dt,bodies:Object.entries(f.entities).filter(([id])=>f.bones?.[id]).map(([id,e])=>({id,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,motion:e.state?.handActuator,arms:f.bones[id].arms})),door:d?{id:d.id,state:d.state,angle:a.layer.drawn.get(d.id)?.obj?.getObjectByName('role:door')?.rotation.y??null}:null,store:s?{state:s.state,angle:a.layer.drawn.get(s.id)?.obj?.getObjectByName('role:door')?.rotation.y??null}:null};});
const mark=async label=>{const f=await frame();marks.push({label,tick:f?.tick,at:Date.now()});writeFileSync(out+'/marks.json',JSON.stringify(marks,null,2));};
const act=async(seat,words,expect='completed')=>{const start=await frame(),t0=Date.now();let r;try{r=await cli(seat,['act',words,'--wait','150']);}catch(e){r={error:String(e.stdout??e)};}
 commands.push({seat,words,startTick:start?.tick,start:t0,end:Date.now(),result:r});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));
 if(expect==='refused')assert.equal(r.accepted,false,JSON.stringify(r));else{assert.equal(r.accepted,true,JSON.stringify(r));assert.equal(r.receipt?.phase,'completed',JSON.stringify(r));}return r;};
try{
 const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'door-passage-proof'})})).json()).token;
 const env=await(await fetch(base+'/v1/god/env',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({timeOfDay:process.env.SOUL_DOOR_TIME??'10:30',timeScale:0,weather:{kind:'clear'}})})).json();assert.equal(env.accepted,true);
 await page.goto(base+(process.env.SOUL_DOOR_EYE??'/?eye=-1.6,4.6,-1.6&at=-6,0.9,3.3'));
 await page.waitForFunction(()=>Object.keys(window.__simEntity?.contactFrame()?.bones??{}).length>=2,null,{timeout:180000});await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 writeFileSync(out+'/initial.yml',await page.locator('body').ariaSnapshot());await page.screenshot({path:out+'/initial.png'});
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await frame();if(s)samples.push(s);}finally{busy=false;}},50);
 await page.waitForTimeout(2000);
 await mark('1-in');await act('ada','walk to the courtyard-bench');await page.waitForTimeout(1500);
 await mark('2-contention');await Promise.all([act('ada','walk to the gate-lamp'),act('bea','walk to the courtyard-seat')]);await page.waitForTimeout(1500);
 await mark('3-out');await act('bea','walk to the post-lamp');await page.waitForTimeout(1500);
 await mark('4-following');await Promise.all([act('ada','walk to the courtyard-bench'),(async()=>{await page.waitForTimeout(2500);return act('bea','walk to the courtyard-seat');})()]);await page.waitForTimeout(1500);
 await mark('5-locked');await act('ada','walk to the store-bench','refused');await page.waitForTimeout(3000);await mark('end');
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,ids,errors,commands,marks,samples,method:'Actual full client; two ordinary paired Soul CLI seats driven by plain words; camera fixed and read-only; native root/hand/leaf timeline; no teleport; continuous source retained.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,errors,commands:commands.map(c=>[c.seat,c.words,c.result?.accepted,c.result?.receipt?.phase??c.result?.error?.code??c.result?.code]),samples:samples.length}));}
