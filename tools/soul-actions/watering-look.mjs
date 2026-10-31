// Entry 34 dev preview (not an acceptance take): stills of the can on its hook, the beds at each growth stage and wilted,
// and stills through one watering, to judge how things look before the takes. Camera read-only.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const scene=process.env.SOUL_WATERING_SCENE??'<team>/soul-actions/day-34/scene',out=process.env.SOUL_WATERING_LOOK??'<team>/soul-actions/day-34/dev-preview',base=`http://127.0.0.1:${process.env.SOUL_WATERING_PORT??7872}/w/soul-watering`;mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),page=await(await browser.newContext({viewport:{width:1280,height:900}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e.stack??e)));
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'watering-look'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();if(!j.accepted)throw Error(JSON.stringify(j));};
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});await page.waitForTimeout(300);};
const shot=n=>page.screenshot({path:`${out}/${n}.png`});
const snap=await(await fetch(base+'/v1/world/snapshot')).json(),id=n=>snap.entities.find(e=>e.name===n).id;
try{
 await post('/v1/god/env',{timeOfDay:'10:30',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+'/?eye=0.3,2.4,-0.8&at=0,0.7,4.2');await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1,null,{timeout:180000});await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(3000);
 await camera([0.3,2.4,-0.8],[0,0.7,4.2]);await shot('00-overview');
 await camera([3.6,1.6,4.0],[2.2,1.0,2.6]);await shot('01-can-on-hook');
 const mode=process.argv[2]??'all';
 if(mode==='all'||mode==='stages'){
  await camera([0.3,1.25,3.85],[0.3,0.55,5.2]);
  for(const [g,m,t,n] of [[0,0.1,0,'seed'],[1,0.8,0,'sprout'],[2,0.8,0,'leafy'],[3,0.8,0,'flowering'],[4,0.8,0,'fruiting'],[4,0.1,1,'fruiting-dry-1'],[4,0,3,'fruiting-wilted-3']]){await post('/v1/god/act',{ops:[{op:'set',id:id('rose-bed'),state:{growth:g,moisture:m,thirst:t}}]});await page.waitForTimeout(3200);await shot(`02-stage-${g}-${n}`);}
  await post('/v1/god/act',{ops:[{op:'set',id:id('rose-bed'),state:{growth:0,moisture:0.1,thirst:0}}]});await page.waitForTimeout(3000);
 }
 if(mode==='all'||mode==='act'){
  await post('/v1/god/act',{ops:[{op:'set',id:id('watering-can'),state:{level:0}},{op:'set',id:id('rose-bed'),state:{growth:0,moisture:0.1,thirst:0}}]});await page.waitForTimeout(2500);
  const views=[[[3.6,1.6,4.0],[2.2,1.0,2.6]],[[-1.4,1.5,4.6],[-2.4,0.7,3.4]],[[-1.5,1.35,4.5],[0.3,0.7,4.9]]];
  const run=promisify(execFile)(process.execPath,['eden.mjs','act',process.env.SOUL_WATERING_WORDS??'water the rose bed','--wait','120','--json'],{cwd:scene+'/ada',timeout:180000});
  let n=0,v=-1;const t0=Date.now();
  while(Date.now()-t0<60000){const s=await page.evaluate(()=>{const f=window.__simEntity.contactFrame();const b=Object.values(f.entities)[0];return {act:b?.activity,stage:b?.state?.wateringV1?.stage,p:b?.p};}).catch(()=>null);
   const want=s?.stage==='fill'||(s?.p&&s.p[0]<-1)?1:s?.stage==='pour'||(s?.p&&s.p[2]>3.9)?2:0;if(want!==v){v=want;await camera(...views[v]);}
   await shot(`03-act-${String(n++).padStart(3,'0')}-${s?.stage??s?.act??''}`);await page.waitForTimeout(350);if(n>160)break;}
  const r=await run;writeFileSync(out+'/act.json',r.stdout);
 }
}finally{writeFileSync(out+'/errors.json',JSON.stringify(errors));await browser.close();console.log(JSON.stringify({errors:errors.length}));}
