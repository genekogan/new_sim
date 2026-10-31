// Entry 28 (M03) real-client proof: Ada turns the garden tap on and off at its raised valve (1.14 m), standing; the visitor's
// actual WebAudio output is recorded with the video (entry 21's fountain proof).
// Ordinary paired Soul CLI seat; camera read-only and fixed; frames stamped with the depicted tick; the music playlist is
// turned off by the visitor's own speaker button (which also unlocks sound), so the recording holds the world only.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_WATER_SCENE??'<team>/soul-actions/day-28/scene',out=process.env.SOUL_TAP_OUT??'<team>/soul-actions/day-28/visual-01',base='http://127.0.0.1:7858/w/soul-water';mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'tap-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const sample=()=>page.evaluate(()=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,motion:e.state?.handActuator,arms:b.arms});}let on=null,id=null;for(const e of api.layer.model.entities.values())if(e.name==='garden-tap'){on=!!e.state.on;id=e.id;}
 // jets drawn at this fountain only (the distant ones, half of them running, are 120 m away)
 let jets=0;api.scene?.traverse?.(o=>{if(o.name==='water jets (stream)'){const w=o.getWorldPosition(o.position.clone());if(Math.hypot(w.x,w.z-4)<2)jets++;}});const s=window.__edenSound,st=s?.state();const em=st?.emitters.find(e=>e.id===id||String(e.id).startsWith(id));const heard=(st?.heard??[]).filter(h=>h.kind==='water');return {at:Date.now(),tick:f.tick,dt:f.dt,world:api.worldSeconds,bodies,on,jets,sound:s?{level:s.level(),emitterOn:em?em.on:null,heard:heard}:null};});
const act=async(seat,words)=>{const start=Date.now(),r=await promisify(execFile)(process.execPath,['eden.mjs','act',words,'--wait','120','--json'],{cwd:scene+'/'+seat,timeout:180000}),result=JSON.parse(r.stdout);commands.push({seat,words,start,end:Date.now(),result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result));return result;};
try{
 await post('/v1/god/env',{timeOfDay:process.env.SOUL_FOUNTAIN_TIME??'15:30',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+(process.env.SOUL_FOUNTAIN_EYE??'/?eye=0.2,2.1,0.4&at=0.6,0.85,5'));await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1&&window.__edenSound,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 const snap=await page.locator('body').ariaSnapshot();writeFileSync(out+'/initial.yml',snap);await page.getByRole('button',{name:'Music is on: turn off',exact:true}).click();await page.waitForFunction(()=>window.__edenSound.state().ctx==='running');
 const audioStart=await page.evaluate(()=>{const stream=window.__edenSound.tap();if(!stream)throw Error('no audio output');const chunks=[],rec=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};window.__tapAudio={rec,chunks,stream};rec.start();return{at:Date.now(),tick:window.__simEntity.depictedTick};});writeFileSync(out+'/audio-start.json',JSON.stringify(audioStart));
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 await page.waitForTimeout(3000);
 const on=await act('ada','turn on the garden tap');assert.equal(on.receipt.phase,'completed',JSON.stringify(on));
 await page.waitForTimeout(14000);await page.screenshot({path:out+'/running.png'});
 const off=await act('ada','turn off the garden tap');assert.equal(off.receipt.phase,'completed',JSON.stringify(off));
 await page.waitForTimeout(5000);await page.screenshot({path:out+'/still.png'});
 assert.deepEqual(errors,[]);
 const S=samples.filter(Boolean),running=S.filter(s=>s.on),still=S.filter(s=>!s.on);
 // the depicted state flips only once the depicted hand has reached the valve (reach ~0.6 s into the motion)
 const early=[];let prev=null;for(const s of S){if(prev!==null&&s.on!==prev){const m=S.filter(p=>p.tick<=s.tick).map(p=>p.bodies[0]?.motion).filter(Boolean).at(-1);const t=m?(s.tick-m.startTick)*s.dt:null;if(t===null||t<0.55)early.push({tick:s.tick,t});}prev=s.on;}
 assert.deepEqual(early,[],'water changes only at the depicted contact');
 // moving water drawn exactly while on (one frame of slack around each flip)
 const flips=S.filter((s,i)=>i&&s.on!==S[i-1].on).map(s=>s.at),stray=S.filter(s=>(s.jets>0)!==!!s.on&&!flips.some(t=>Math.abs(s.at-t)<300));
 assert.deepEqual(stray.map(s=>s.tick),[],'jets drawn exactly while on');
 // the running-water loop (emitter #0, `when: on`); the still pool's faint lapping (#1, gain ~0.004) is heard either way
 const waterNear=s=>(s.sound?.heard??[]).some(h=>h.d<6&&h.id.endsWith('#0')),heard=running.filter(waterNear).length;assert.ok(heard>running.length*0.8,'water heard while on: '+heard+'/'+running.length);
 const heardOff=still.filter(s=>waterNear(s)&&!flips.some(t=>Math.abs(s.at-t)<600)).length;
 writeFileSync(out+'/checks.json',JSON.stringify({pass:true,runningSamples:running.length,stillSamples:still.length,earlyFlips:early.length,strayJetSamples:stray.length,waterHeardWhileOn:heard,waterHeardWhileOff:heardOff},null,2));assert.equal(heardOff,0,'no water sound while off');pass=true;
}finally{clearInterval(timer);let bytes=null;try{bytes=await page.evaluate(async()=>{const a=window.__tapAudio;if(!a)return null;await new Promise(r=>{a.rec.onstop=r;a.rec.stop();});const b=new Blob(a.chunks,{type:'audio/webm'});const buf=await b.arrayBuffer();a.stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(buf));});}catch{}if(bytes)writeFileSync(out+'/actual-audio.webm',Buffer.from(bytes));writeFileSync(out+'/proof.json',JSON.stringify({pass,commands,samples,errors,method:'Real full client, one ordinary paired Soul CLI seat, plain words; actual WebAudio master tap recorded; music playlist off; camera fixed.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
