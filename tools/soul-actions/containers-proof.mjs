// Entry 42 real-client proof: Ada carries a bowl to a chest of drawers, opens the drawer with her free hand, puts the bowl
// in, shuts it; the world restarts; she opens it again and takes the same bowl out. Ordinary paired Soul CLI seat, plain
// words; one fixed camera for the whole take (read-only); frames stamped with the tick; continuous recording. No sound.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const run=promisify(execFile);
const scene=process.env.SOUL_CONTAINERS_SCENE??'<team>/soul-actions/day-42/scene',out=process.env.SOUL_CONTAINERS_OUT??'<team>/soul-actions/day-42/visual-01',port=Number(process.env.SOUL_CONTAINERS_PORT??7881),base=`http://127.0.0.1:${port}/w/soul-containers`;mkdirSync(out,{recursive:true});
const EYE=JSON.parse(process.env.SOUL_CONTAINERS_EYE??'[-1.75,1.8,2.75]'),AT=JSON.parse(process.env.SOUL_CONTAINERS_AT??'[0.35,0.95,4.55]');
const STEPS=JSON.parse(process.env.SOUL_CONTAINERS_STEPS??'null')??[
 {words:'pick up the bowl',hold:2500},{words:'open the drawer',hold:2500},{words:'put the bowl in the drawer',hold:2500},{words:'close the drawer',hold:3000},
 {restart:true,hold:4000},{words:'open the drawer',hold:2500},{words:'take the bowl out of the chest',hold:2500},{words:'close the drawer',hold:3000}];
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:[]}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();
const errors=[],samples=[],commands=[],events=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false,ids={};
// the frame stamp sits at y 64 (under the top bar): a recording can lay the page out ~90 px short at the bottom (take 2)
const stamp=async()=>{await installFrameStamp(page);await page.evaluate(()=>{const c=[...document.querySelectorAll('canvas')].at(-1);c.style.bottom='auto';c.style.top='64px';});};
const camera=async()=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye:EYE,at:AT});};
const sample=()=>page.evaluate((ids)=>{const api=window.__simEntity,f=api?.contactFrame?.();if(!f||!f.bones)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,state:e.state,hands:e.hands,bones:b});}
 const m=api.layer.model,chest=m?.entities.get(ids.chest),bowl=ids.bowl&&m?.entities.get(ids.bowl);
 let knob=null,drawerZ=null;const d=api.layer.drawn?.get?.(ids.chest);d?.obj?.traverse?.(o=>{if(o.userData.role==='drawer'&&typeof o.userData.restZ==='number'&&drawerZ===null)drawerZ=o.position.z-o.userData.restZ;if(o.name==='role:drawer'){const k=o.children.find(c=>c.isMesh&&c.geometry?.type?.includes('Sphere'));const v=(k??o).getWorldPosition(o.position.clone());knob=[v.x,v.y,v.z];}});
 const kept=ids.bowl?api.layer.keptView(ids.bowl):null,native=ids.bowl?f.entities[ids.bowl]:null;
 return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,chest:{open:!!chest?.state?.open,pose:chest?m.worldPose(chest):null,knob,drawerZ},bowl:{parent:bowl?.in?.parent??null,slot:bowl?.in?.slot??null,drawn:kept?.p??api.layer.drawn.get(ids.bowl)?.obj.position.toArray()??null,visible:kept?kept.visible:null,keptIn:kept?.box??null,native:native?{p:native.p,support:native.state?.support}:null}};},ids);
const act=async(words)=>{const start=Date.now(),r=await run(process.execPath,['eden.mjs','act',words,'--wait','120','--json'],{cwd:scene+'/ada',timeout:180000}),result=JSON.parse(r.stdout);commands.push({words,start,end:Date.now(),utc:new Date(start).toISOString(),result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result).slice(0,800));assert.equal(result.receipt.phase,'completed',JSON.stringify(result).slice(0,800));return result;};
const restart=async()=>{const w=JSON.parse(readFileSync(scene+'/world.json','utf8'));events.push({restart:'stop',pid:w.pid,at:Date.now(),utc:new Date().toISOString()});process.kill(w.pid,'SIGTERM');
 for(let i=0;i<200;i++){try{await fetch(base+'/healthz');}catch{break;}await new Promise(r=>setTimeout(r,100));}
 const r=await run(process.execPath,['tools/soul-actions/start-containers.mjs'],{cwd:new URL('../..',import.meta.url).pathname,env:{...process.env,SOUL_CONTAINERS_SCENE:scene,SOUL_CONTAINERS_PORT:String(port)},timeout:240000});events.push({restart:'up',out:r.stdout.trim(),at:Date.now(),utc:new Date().toISOString()});
 // the open page reconnects on its own; wait for live ticks again (reload only if it never comes back, and say so)
 const t0=await page.evaluate(()=>window.__simEntity?.contactFrame?.()?.tick??0);let back=false;for(let i=0;i<120&&!back;i++){await page.waitForTimeout(500);const t=await page.evaluate(()=>window.__simEntity?.contactFrame?.()?.tick??0).catch(()=>0);back=t>t0+20||t<t0-5;}
 if(!back){events.push({reload:true,at:Date.now()});await page.reload();await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1,null,{timeout:180000});await page.waitForTimeout(2500);await stamp();await camera();}
 events.push({restart:'client back',reloaded:!back,at:Date.now(),utc:new Date().toISOString()});};
try{
 await page.goto(base+`/?eye=${EYE.join(',')}&at=${AT.join(',')}`);await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await stamp();await camera();
 ids=await page.evaluate(()=>Object.fromEntries([...window.__simEntity.layer.model.entities.values()].filter(e=>['chest','bowl','table','locker'].includes(e.name)).map(e=>[e.name,e.id])));
 writeFileSync(out+'/initial.yml',await page.locator('body').ariaSnapshot());await page.screenshot({path:out+'/00.png'});
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}catch{}finally{busy=false;}},50);
 for(const [i,st] of STEPS.entries()){await page.waitForTimeout(1200);if(st.restart)await restart();else await act(st.words);await page.waitForTimeout(st.hold);await page.screenshot({path:out+`/${String(i+1).padStart(2,'0')}.png`});}
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,ids,commands,events,samples,errors,steps:STEPS,camera:{eye:EYE,at:AT},method:'Real full client, one ordinary paired Soul CLI seat (shipped eden.mjs), plain words; one fixed camera, never moved during the take; world restarted mid-take (same data dir); no sound.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors,events}));}
