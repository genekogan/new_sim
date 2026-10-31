// Entry 23 real-client proof at night: Ada closes and opens the curtains and the blind by hand at their pull cords; seen
// from inside (the hand at the cord) and from outside (the lit room hidden and shown). Ordinary paired Soul CLI seat;
// camera read-only, one preset per command (moved only between commands); frames stamped with the tick. No sound.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_CURTAINS_SCENE??'<team>/soul-actions/day-23/scene',out=process.env.SOUL_CURTAINS_OUT??'<team>/soul-actions/day-23/visual-01',base='http://127.0.0.1:7865/w/soul-curtains';mkdirSync(out,{recursive:true});
const NAMES=['curtains','blind'];
const IN=[[-1.6,1.75,0.6],[0.8,1.35,3.7]],OUT=[[0.9,1.8,9.4],[0.2,1.5,4]];
const STEPS=JSON.parse(process.env.SOUL_CURTAINS_STEPS??'null')??[
 {words:'close the curtains',eye:IN[0],at:IN[1],hold:3500},
 {words:'close the blind',eye:OUT[0],at:OUT[1],hold:4500},
 {words:'open the curtains',eye:OUT[0],at:OUT[1],hold:4500},
 {words:'open the blind',eye:[1.7,1.75,0.5],at:[-0.9,1.35,3.7],hold:3500}];
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:[]}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'curtains-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});await page.waitForTimeout(600);};
const sample=()=>page.evaluate((NAMES)=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,motion:e.state?.handActuator,arms:b.arms});}
 const things={};for(const e of api.layer.model.entities.values())if(NAMES.includes(e.name))things[e.name]={id:e.id,open:!!e.state.open};const cover=[];api.scene.traverse(o=>{if(/^role:(curtain|blind)/.test(o.name))cover.push([o.name,+o.scale.x.toFixed(3),+o.scale.y.toFixed(3)]);});return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,things,cover};},NAMES);
const act=async(seat,words)=>{const start=Date.now(),r=await promisify(execFile)(process.execPath,['eden.mjs','act',words,'--wait','120','--json'],{cwd:scene+'/'+seat,timeout:180000}),result=JSON.parse(r.stdout);commands.push({seat,words,start,end:Date.now(),result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt.phase,'completed',JSON.stringify(result));return result;};
try{
 await post('/v1/god/env',{timeOfDay:process.env.SOUL_CURTAINS_TIME??'21:00',timeScale:0,weather:{kind:'clear'}});
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
 // the covering eases over ~1.1 s after the flip (no jump): count samples mid-draw for each flip
 const flips=[];for(const n of NAMES){let prev=null;for(const s of S){const v=s.things[n]?.open;if(prev!==null&&v!==prev)flips.push({n,tick:s.tick,at:s.at,to:v});prev=v;}}
 const mid=flips.map(fl=>({...fl,midSamples:S.filter(s=>s.at>fl.at&&s.at<fl.at+1300&&s.cover.some(c=>{const k=fl.n==='blind'?(c[0]==='role:blind'?c[2]:null):(c[0].startsWith('role:curtain')?c[1]:null);return k!==null&&k>0.3&&k<0.95;})).length}));
 writeFileSync(out+'/checks.json',JSON.stringify({pass:mid.every(m=>m.midSamples>=3),earlyFlips:early.length,flips:mid},null,2));
 assert.ok(mid.every(m=>m.midSamples>=3),'each covering eases (several samples mid-draw)');pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,commands,samples,errors,steps:STEPS,method:'Real full client at night, one ordinary paired Soul CLI seat, plain words; camera preset per command, moved only between commands; no sound.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
