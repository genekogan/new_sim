// Entry 33 real-client proof at night: Ada lights a standing torch and a wall torch by hand, switches a neon sign on and
// off at its switch box, then puts both torches out. Actual WebAudio recorded (torch crackle, neon hum). Ordinary paired
// Soul CLI seat, plain words; camera read-only, one preset per command (moved only between commands); frames stamped.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_TORCH_SCENE??'<team>/soul-actions/day-33/scene',out=process.env.SOUL_TORCH_OUT??'<team>/soul-actions/day-33/visual-01',base=`http://127.0.0.1:${Number(process.env.SOUL_TORCH_PORT??7873)}/w/soul-torch-neon`;mkdirSync(out,{recursive:true});
const NAMES=['torch','wall-torch','neon-sign'];
const STEPS=JSON.parse(process.env.SOUL_TORCH_STEPS??'null')??[
 {words:'light the standing torch',eye:[-4.3,1.6,2.6],at:[-2.2,1.3,3.8],hold:5000},
 {words:'light the wall torch',eye:[-4.2,1.6,5.3],at:[-2.1,1.45,6.6],hold:5000},
 // retest on M04: stand ≥ 10 s at the sign, then on until the idle variety holds a hand up, so the switch-off reach
 // starts out of a gesture (the take-4 pop) on camera
 {words:'switch on the neon sign',eye:[0.4,1.6,3.9],at:[2.2,1.55,6.15],hold:10000,gesture:60000},
 {words:'switch off the neon sign',eye:[0.4,1.6,3.9],at:[2.2,1.55,6.15],hold:4500},
 {words:'put out the wall torch',eye:[-4.2,1.6,5.3],at:[-2.1,1.45,6.6],hold:3500},
 {words:'put out the standing torch',eye:[0.2,1.6,4.7],at:[-2.2,1.3,4.2],hold:3500}];
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[],cameras=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'torch-neon-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});cameras.push({at:Date.now(),eye,target:at});await page.waitForTimeout(600);};
const sample=()=>page.evaluate((NAMES)=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,motion:e.state?.handActuator,arms:b.arms,pose:b.pose,walkW:b.walkW,hipY:b.hipY,variety:b.variety??null});}
 const things={};for(const e of api.layer.model.entities.values())if(NAMES.includes(e.name))things[e.name]={id:e.id,on:!!e.state.on};
 const s=window.__edenSound,st=s?.state();const heard=(st?.heard??[]).filter(h=>(h.kind==='fire'||h.kind==='hum')&&h.d<14).map(h=>({id:h.id,kind:h.kind,variant:h.variant,gain:h.gain,d:h.d}));
 const fx=window.__simFx?.stats(),ids=Object.values(things).map(t=>t.id),fires=(fx?.fire?.burning??[]).filter(b=>ids.includes(b.id)),neon=(fx?.neon?.signs??[]).filter(n=>ids.includes(n.id));
 const cam=api.camera,W=innerWidth,H=innerHeight,proj=p=>{const v=new cam.position.constructor(...p).project(cam);return [Math.round((v.x+1)/2*W),Math.round((1-v.y)/2*H)];};
 return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,things,sound:s?{level:s.level(),heard}:null,fires,neon,cam:[cam.position.x,cam.position.y,cam.position.z],
  probes:{torchGround:proj([-1.6,0.02,4.6]),torchGroundLast:proj([-2.8,0.02,3.6]),torchPole:proj([-2.2,0.9,3.98]),wallTorchWall:proj([-1.6,1.25,7.12]),neonSign:proj([2.7,1.78,6.17]),neonGround:proj([2.7,0.02,5.5])}};},NAMES);
const marks=[],hashId=id=>{let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;return h;};
/** M04 proof's copy of the humans.ts idle-variety schedule: a hand gesture at full weight at depicted seconds t, or null. */
function gesture(id,t){const h=hashId(id),out=[];
 {const ph=(h%997)/997,u=((t/25+ph)%1)*25;if(u>=1&&u<6)out.push({kind:'Idle_Neutral',left:6-u});}
 {const ph=((h>>>7)%991)/991,cyc=t/37+ph,u=(cyc%1)*37,clip=['Idle_LookAround_Loop','Idle_FoldArms_Loop'][(Math.floor(cyc)+h)%2];if(u>=1.2&&u<9)out.push({kind:clip,left:9-u});}
 return out.sort((a,b)=>b.left-a.left)[0]??null;}
/** Wait at most maxMs until the depicted body holds a hand up in a gesture (a palm > 1.05 m above its feet, ≥ 2 s of the
 *  gesture window left); records what it waited for. */
async function waitGesture(label,maxMs){const t0=Date.now();while(Date.now()-t0<maxMs){const s=samples.filter(Boolean).at(-1),b=s?.bodies[0];if(b){const g=gesture(b.id,s.tick*s.dt),up=Math.max(...b.arms.map(a=>a.palm[1]-b.p[1]));if(g&&g.kind!=='Idle_LookAround_Loop'&&g.left>=2&&up>1.05){marks.push({label,at:Date.now(),tick:s.tick,gesture:g,palmUp:up,variety:b.variety});return g;}}await page.waitForTimeout(100);}marks.push({label,at:Date.now(),tick:samples.at(-1)?.tick,gesture:null,timeout:true});return null;}
const act=async(seat,words)=>{const start=Date.now(),r=await promisify(execFile)(process.execPath,['eden.mjs','act',words,'--wait','120','--json'],{cwd:scene+'/'+seat,timeout:180000}),result=JSON.parse(r.stdout);commands.push({seat,words,start,end:Date.now(),result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt.phase,'completed',JSON.stringify(result));return result;};
try{
 await post('/v1/god/env',{timeOfDay:process.env.SOUL_TORCH_TIME??'20:10',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+`/?eye=${STEPS[0].eye.join(',')}&at=${STEPS[0].at.join(',')}`);await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1&&window.__edenSound,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 const snap=await page.locator('body').ariaSnapshot();writeFileSync(out+'/initial.yml',snap);await page.getByRole('button',{name:'Music is on: turn off',exact:true}).click();await page.waitForFunction(()=>window.__edenSound.state().ctx==='running');
 const audioStart=await page.evaluate(()=>{const stream=window.__edenSound.tap();if(!stream)throw Error('no audio output');const chunks=[],rec=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};window.__torchAudio={rec,chunks,stream};rec.start();return{at:Date.now(),tick:window.__simEntity.depictedTick};});writeFileSync(out+'/audio-start.json',JSON.stringify(audioStart));
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 for(const [i,st] of STEPS.entries()){const prev=STEPS[i-1];if(!prev||JSON.stringify([prev.eye,prev.at])!==JSON.stringify([st.eye,st.at])){await camera(st.eye,st.at);await page.waitForTimeout(1500);}await act('ada',st.words);await page.waitForTimeout(st.hold);await page.screenshot({path:out+`/${String(i+1).padStart(2,'0')}.png`});if(st.gesture)await waitGesture('after '+st.words,st.gesture);}
 assert.deepEqual(errors,[]);
 const S=samples.filter(Boolean);
 // each thing's depicted state flips only once the depicted hand has reached it (reach ~0.65 s into the motion)
 const early=[];for(const n of NAMES){let prev=null;for(const s of S){const v=s.things[n]?.on;if(prev!==null&&v!==prev){const m=S.filter(p=>p.tick<=s.tick).map(p=>p.bodies[0]?.motion).filter(Boolean).at(-1);const t=m?(s.tick-m.startTick)*s.dt:null;if(t===null||t<0.55||m.target!==s.things[n].id)early.push({n,tick:s.tick,t});}prev=v;}}
 assert.deepEqual(early,[],'state changes only at the depicted contact');
 const signId=S[0].things['neon-sign'].id,lit=S.filter(s=>s.things['neon-sign']?.on),dark=S.filter(s=>!s.things['neon-sign']?.on),flips=S.filter((s,i)=>i&&s.things['neon-sign']?.on!==S[i-1].things['neon-sign']?.on).map(s=>s.at);
 const hum=s=>(s.sound?.heard??[]).some(h=>h.kind==='hum'&&h.id.startsWith(signId)),heard=lit.filter(hum).length,heardDark=dark.filter(s=>hum(s)&&!flips.some(t=>Math.abs(s.at-t)<600)).length;
 writeFileSync(out+'/checks.json',JSON.stringify({pass:heardDark===0&&heard>lit.length*0.8,earlyFlips:early.length,neonLitSamples:lit.length,humHeardWhileLit:heard,humHeardWhileDark:heardDark,flipLagMs:flips.map(t=>{const f=S.find(s=>s.at>=t&&hum(s)===!!s.things['neon-sign']?.on);return f?f.at-t:null;})},null,2));
 assert.equal(heardDark,0,'no hum while dark');assert.ok(heard>lit.length*0.8,'hum while lit');pass=true;
}finally{clearInterval(timer);let bytes=null;try{bytes=await page.evaluate(async()=>{const a=window.__torchAudio;if(!a)return null;await new Promise(r=>{a.rec.onstop=r;a.rec.stop();});const b=new Blob(a.chunks,{type:'audio/webm'});const buf=await b.arrayBuffer();a.stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(buf));});}catch{}if(bytes)writeFileSync(out+'/actual-audio.webm',Buffer.from(bytes));writeFileSync(out+'/proof.json',JSON.stringify({pass,commands,cameras,samples,errors,marks,steps:STEPS,method:'Real full client at night (20:10), one ordinary paired Soul CLI seat, plain words; actual WebAudio master tap recorded; music playlist off; camera preset per command, moved only between commands.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
