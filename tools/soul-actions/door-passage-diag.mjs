// Entry 31 (retest on M04): diagnostic real-client run, no video. Same owned world and seats as the proof; repeats the
// same-side following/queue scene in and out and samples, per body, the drawn walk weight, idle variety, feet and palms
// with the live take window the frame came from, to find a pose snap at a queued stop.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const run=promisify(execFile),scene=process.env.SOUL_DOOR_SCENE,out=process.env.SOUL_DOOR_OUT,base=`http://127.0.0.1:${process.env.SOUL_DOOR_PORT??7872}/w/soul-door-passage`,rounds=+(process.env.ROUNDS??3);mkdirSync(out,{recursive:true});
const cli=async(seat,args,timeout=200000)=>JSON.parse((await run(process.execPath,['eden.mjs',...args,'--json'],{cwd:scene+'/'+seat,timeout})).stdout);
const ids={};for(const [seat,name] of Object.entries({ada:'Ada',bea:'Bea'})){const dir=scene+'/'+seat;mkdirSync(dir,{recursive:true});if(!existsSync(dir+'/.eden-agent.json')){copyFileSync(new URL('../world-launcher/soul/eden.mjs',import.meta.url).pathname,dir+'/eden.mjs');await cli(seat,['register',base]);await cli(seat,['create',name]);}const st=await cli(seat,['status']);ids[seat]='h_'+st.soul.id.slice(2);}
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1080}}),samples=[],commands=[];let busy=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'door-passage-diag'})})).json()).token;
await fetch(base+'/v1/god/env',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({timeOfDay:'10:30',timeScale:0,weather:{kind:'clear'}})});
await page.goto(base+'/?eye=-6.6,9.6,-2.6&at=-6,0.4,3.7');await page.waitForFunction(()=>Object.keys(window.__simEntity?.contactFrame()?.bones??{}).length>=2,null,{timeout:180000});await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2000);
const frame=()=>page.evaluate(()=>{const f=window.__simEntity.contactFrame();if(!f?.bones)return null;return {at:Date.now(),tick:f.tick,takeStart:f.takeStart,bodies:Object.entries(f.entities).filter(([id])=>f.bones[id]).map(([id,e])=>{const b=f.bones[id];return {id,p:e.p,yaw:e.yaw,activity:e.activity,op:!!e.state?.handActuator,walkW:b.walkW,variety:b.variety,gait:b.gait?.weight??null,feet:b.feet,palms:b.arms.map(a=>a.palm)};})};});
const timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await frame();if(s)samples.push(s);}finally{busy=false;}},50);
const act=async(seat,words)=>{const t0=Date.now(),s=samples.at(-1);let r;try{r=await cli(seat,['act',words,'--wait','150']);}catch(e){r={error:String(e.stdout??e)};}commands.push({seat,words,startTick:s?.tick,start:t0,end:Date.now(),phase:r.receipt?.phase??r.error??r.code});};
try{
 for(let i=0;i<rounds;i++){
  // outside first (Ada east, Bea west), then the following scene in, then the same out (both inside, same side)
  await Promise.all([act('ada','walk to the east-lantern'),act('bea','walk to the west-bench')]);await page.waitForTimeout(1000);
  await Promise.all([act('ada','walk to the courtyard-bench'),(async()=>{await page.waitForTimeout(2500);return act('bea','walk to the courtyard-seat');})()]);await page.waitForTimeout(1000);
  await Promise.all([act('bea','walk to the west-bench'),(async()=>{await page.waitForTimeout(2500);return act('ada','walk to the east-lantern');})()]);await page.waitForTimeout(1000);
 }
}finally{clearInterval(timer);writeFileSync(out+'/diag.json',JSON.stringify({ids,commands,samples}));await browser.close();console.log(JSON.stringify({samples:samples.length,commands:commands.map(c=>[c.seat,c.words,c.phase])}));}
