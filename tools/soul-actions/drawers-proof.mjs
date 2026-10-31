// Entry 24 real-client proof: Ada slides the top drawer of a chest open and shut by hand. The drawn drawer is checked to
// follow the recorded hand (knob vs hand every sample). Ordinary paired Soul CLI seat; camera read-only, one preset per
// command (moved only between commands); frames stamped with the tick. No sound.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_DRAWERS_SCENE??'<team>/soul-actions/day-24/scene',out=process.env.SOUL_DRAWERS_OUT??'<team>/soul-actions/day-24/visual-01',base='http://127.0.0.1:7866/w/soul-drawers';mkdirSync(out,{recursive:true});
const NAMES=['chest'];
const SIDE=[[2.1,1.5,3.6],[0.15,0.95,4.6]],FRONT=[[-1.4,1.7,2.2],[0.1,0.9,4.7]];
const STEPS=JSON.parse(process.env.SOUL_DRAWERS_STEPS??'null')??[
 {words:'open the drawer',eye:SIDE[0],at:SIDE[1],hold:3500},
 {words:'close the drawer',eye:SIDE[0],at:SIDE[1],hold:3000},
 {words:'open the drawer',eye:FRONT[0],at:FRONT[1],hold:3500}];
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:[]}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'drawers-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});await page.waitForTimeout(600);};
const sample=()=>page.evaluate((NAMES)=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,motion:e.state?.handActuator,arms:b.arms});}
 const things={};for(const e of api.layer.model.entities.values())if(NAMES.includes(e.name))things[e.name]={id:e.id,open:!!e.state.open};
 // the drawn knob (role drawer's knob, world) against the recorded hand, every sample
 let knob=null;const d=api.layer.drawn?.get?.(things.chest?.id);d?.obj?.traverse?.(o=>{if(o.name==='role:drawer'){const k=o.children.find(c=>c.isMesh&&c.geometry?.type?.includes('Sphere'));const v=(k??o).getWorldPosition(o.position.clone());knob=[v.x,v.y,v.z];}});
 const hand=bodies[0]?.hands?.right??bodies[0]?.hands?.left??null;return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,things,knob,hand};},NAMES);
const act=async(seat,words)=>{const start=Date.now(),r=await promisify(execFile)(process.execPath,['eden.mjs','act',words,'--wait','120','--json'],{cwd:scene+'/'+seat,timeout:180000}),result=JSON.parse(r.stdout);commands.push({seat,words,start,end:Date.now(),result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt.phase,'completed',JSON.stringify(result));return result;};
try{
 await post('/v1/god/env',{timeOfDay:process.env.SOUL_DRAWERS_TIME??'16:00',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+`/?eye=${STEPS[0].eye.join(',')}&at=${STEPS[0].at.join(',')}`);await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1&&window.__edenSound,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 const snap=await page.locator('body').ariaSnapshot();writeFileSync(out+'/initial.yml',snap);
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 for(const [i,st] of STEPS.entries()){await camera(st.eye,st.at);await page.waitForTimeout(1500);await act('ada',st.words);await page.waitForTimeout(st.hold);await page.screenshot({path:out+`/${String(i+1).padStart(2,'0')}.png`});}
 assert.deepEqual(errors,[]);
 const S=samples.filter(Boolean);
 // each fixture's depicted state flips only once the depicted hand has reached it (reach ~0.6 s into the motion)
 const early=[];for(const n of NAMES){let prev=null;for(const s of S){const v=s.things[n]?.open;if(prev!==null&&v!==prev){const m=S.filter(p=>p.tick<=s.tick).map(p=>p.bodies[0]?.motion).filter(Boolean).at(-1);const t=m?(s.tick-m.startTick)*s.dt:null;if(t===null||t<0.55||m.target!==s.things[n].id)early.push({n,tick:s.tick,t});}prev=v;}}
 assert.deepEqual(early,[],'state changes only at the depicted contact');
 // while the hand holds the knob, the drawn knob is where the recorded hand is (the drawer follows the hand's timeline)
 const held=S.filter(s=>s.hand&&s.knob&&s.bodies[0]?.motion?.slide&&(s.tick-s.bodies[0].motion.startTick)*s.dt>0.7&&(s.tick-s.bodies[0].motion.startTick)*s.dt<0.65+1.02),off=held.map(s=>Math.hypot(s.hand[0]-s.knob[0],s.hand[1]-s.knob[1],s.hand[2]-s.knob[2]));
 const maxOff=off.length?Math.max(...off):null;
 writeFileSync(out+'/checks.json',JSON.stringify({pass:held.length>20&&maxOff<0.06,earlyFlips:early.length,heldSamples:held.length,maxKnobHandOffset:maxOff},null,2));
 assert.ok(held.length>20,'samples while the hand holds the knob: '+held.length);assert.ok(maxOff<0.06,'the drawn drawer follows the hand: '+maxOff);pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,commands,samples,errors,steps:STEPS,method:'Real full client at night, one ordinary paired Soul CLI seat, plain words; camera preset per command, moved only between commands; no sound.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
