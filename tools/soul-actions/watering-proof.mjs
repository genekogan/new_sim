// Entry 34 real-client proof: Ada, an ordinary paired Soul CLI seat, is told in plain words to water the rose bed (the can
// is empty on its hook: she takes it, fills it at the tap, pours, hangs it back); the world clock then runs a few days
// (the watered bed grows, the dry herb bed stalls and wilts); she waters again (no fill), days pass, and she waters the
// herb bed with what is left (the can runs out). The camera is read-only; it moves to the next place only while she
// walks there. Continuous recording with frame stamps; the visitor's actual WebAudio is recorded.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_WATERING_SCENE??'<team>/soul-actions/day-34/scene',out=process.env.SOUL_WATERING_OUT??'<team>/soul-actions/day-34/visual-01',base=`http://127.0.0.1:${process.env.SOUL_WATERING_PORT??7872}/w/soul-watering`;mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[],marks=[];page.on('pageerror',e=>errors.push(String(e.stack??e)));let timer,busy=false,pass=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'watering-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const snap=await(await fetch(base+'/v1/world/snapshot')).json(),id=n=>snap.entities.find(e=>e.name===n).id,ids={can:id('watering-can'),hook:id('can-hook'),tap:id('garden-tap'),rose:id('rose-bed'),herb:id('herb-bed')};
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});};
const VIEW={hook:[[3.7,1.65,4.1],[2.0,1.0,2.6]],tap:[[-1.25,1.55,4.75],[-2.55,0.75,3.45]],rose:[[-1.4,1.45,4.2],[0.45,0.7,5.05]],herb:[[-3.5,1.45,4.7],[-1.7,0.7,5.95]],beds:[[-0.6,2.3,2.4],[-0.7,0.5,5.8]]};
// what the viewer draws, every 50 ms: the body (bones, hands, motion), the drawn can and the palm holding it, the rose
// shower, the tap's stream, the beds' eased looks, the world state and the sound heard
const sample=()=>page.evaluate((ids)=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const L=api.layer,bodies=[];
 for(const [bid,e]of Object.entries(f.entities)){const b=f.bones?.[bid];if(!b)continue;bodies.push({id:bid,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,frame:api.renderer?.info?.render?.frame??null,watering:e.state?.wateringV1??null,bones:{activity:b.activity,walkW:b.walkW,hipY:b.hipY,feet:b.feet,variety:b.variety??null,arms:b.arms.map(a=>({side:a.side,palm:a.palm,target:a.target,err:a.err}))}});}
 const d=L.drawn.get(ids.can),grip=d?.obj.userData.handleGrip,v=x=>x?[x.x,x.y,x.z]:null;let can=null;
 if(d){const g=grip?d.obj.localToWorld(new d.obj.position.constructor(grip[0],grip[1],grip[2])):null,rose=d.obj.localToWorld(new d.obj.position.constructor(0.465,0.352,0)),open=d.obj.localToWorld(new d.obj.position.constructor(0.115,0.278,0));
  const body=L.held.get(ids.can),fig=body?L.figureOf(body):null;let palm=null;if(fig){const w=fig.wrists[1].getWorldPosition(new d.obj.position.constructor());const k=fig.knuckles[1];if(k)w.lerp(k.getWorldPosition(new d.obj.position.constructor()),0.5);palm=v(w);}
  can={p:v(d.obj.position),q:d.obj.quaternion.toArray(),grip:v(g),rose:v(rose),opening:v(open),palm,held:!!body,tilt:fig?.holder.userData.wateringTilt??0,flow:fig?.holder.userData.wateringFlow??0};}
 const pour=L.pours.get(ids.can),pu=pour?.material.uniforms;const jets=L.tapJets.get(ids.tap),tapJet=jets?{drop:jets.material.uniforms.uDrop.value,dropDefault:jets.userData.dropDefault,at:v(jets.getWorldPosition(new jets.position.constructor()))}:null;
 const looks={};for(const k of ['rose','herb']){const dd=L.drawn.get(ids[k]);let patch=null;dd?.obj.traverse(o=>{if(o.userData.role==='fill')patch=o.scale.x;});looks[k]={shown:L.plantShown.get(ids[k])??null,tween:L.plantTweens.has(ids[k]),patch};}
 const st={};for(const e of L.model.entities.values())for(const [k,i]of Object.entries(ids))if(e.id===i)st[k]={parent:e.in.parent,...e.state};
 const s=window.__edenSound,heard=(s?.state()?.heard??[]).filter(h=>h.kind==='water').map(h=>({id:h.id,d:Math.round(h.d*100)/100}));
 return {at:Date.now(),tick:f.tick,dt:f.dt,world:api.worldSeconds,bodies,can,pour:pour?{visible:pour.visible,p:v(pour.position),flow:pu.uFlow.value,dir:pu.uDir.value,drop:pu.uDrop.value}:null,tapJet,looks,st,heard};},ids);
const act=async(words)=>{const start=Date.now(),r=await promisify(execFile)(process.execPath,['eden.mjs','act',words,'--wait','150','--json'],{cwd:scene+'/ada',timeout:240000}),result=JSON.parse(r.stdout);commands.push({seat:'ada',words,start,end:Date.now(),result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt.phase,'completed',JSON.stringify(result).slice(0,800));return result;};
// the camera follows the phases only while the body walks between them (never during a reach or a pour)
let follow=null,lastView='';const STATIONS={hook:[1.7,2.62],tap:[-2.93,3.5],rose:[0.6,4.41],herb:[-1.6,5.61]};
const steer=async()=>{const s=samples.at(-1),b=s?.bodies[0];if(!follow||!b||b.bones.walkW<0.5)return;
 const near=Object.entries(STATIONS).filter(([k])=>!((k==='rose'||k==='herb')&&k!==follow)).map(([k,[x,z]])=>[k,Math.hypot(b.p[0]-x,b.p[2]-z)]).sort((p,q)=>p[1]-q[1])[0];if(near&&near[1]<1.6&&lastView!==near[0]){lastView=near[0];marks.push({tick:s.tick,view:near[0]});await camera(...VIEW[near[0]]);}};
const waitFor=async(pred,ms)=>{const t0=Date.now();while(Date.now()-t0<ms){const s=await(await fetch(base+'/v1/world/snapshot')).json();if(pred(s))return s;await page.waitForTimeout(2000);}return null;};
const stateOf=(s,n)=>s.entities.find(e=>e.id===ids[n])?.state??{};
const waterRun=async(words,bed,camStart)=>{follow=bed;lastView='';await camera(...VIEW[camStart]);lastView=camStart;marks.push({tick:samples.at(-1)?.tick,view:camStart,words});const r=await act(words);await page.waitForTimeout(3500);follow=null;return r;};
try{
 await post('/v1/god/env',{timeOfDay:'09:30',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+'/?eye=3.7,1.65,4.1&at=2,1,2.6');await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1&&window.__edenSound,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 await page.getByRole('button',{name:'Music is on: turn off',exact:true}).click();await page.waitForFunction(()=>window.__edenSound.state().ctx==='running');
 const audioStart=await page.evaluate(()=>{const stream=window.__edenSound.tap();if(!stream)throw Error('no audio output');const chunks=[],rec=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};window.__tapAudio={rec,chunks,stream};rec.start();return{at:Date.now(),tick:window.__simEntity.depictedTick};});writeFileSync(out+'/audio-start.json',JSON.stringify(audioStart));
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s){samples.push(s);await steer();}}finally{busy=false;}},50);
 await camera(...VIEW.beds);await page.waitForTimeout(3000);
 // 1: an empty can on its hook: take, fill at the tap, pour on the rose bed, hang back
 await waterRun('water the rose bed','rose','hook');
 // days pass (one world day a minute): the rose bed sprouts and leafs out; the herb bed flowers once, then stalls and wilts
 await camera(...VIEW.beds);marks.push({tick:samples.at(-1)?.tick,view:'beds',days:1});await post('/v1/god/env',{timeScale:1440});
 await waitFor(s=>stateOf(s,'rose').growth>=2&&stateOf(s,'herb').thirst>=1,260000);await post('/v1/god/env',{timeOfDay:'10:00',timeScale:0});await page.waitForTimeout(5000);
 // 2: the can still holds water: no fill this time
 await waterRun('water the rose bed','rose','hook');
 await camera(...VIEW.beds);marks.push({tick:samples.at(-1)?.tick,view:'beds',days:2});await post('/v1/god/env',{timeScale:1440});
 await waitFor(s=>stateOf(s,'rose').growth>=4,260000);await post('/v1/god/env',{timeOfDay:'11:00',timeScale:0});await page.waitForTimeout(5000);
 // 3: the wilted herb bed gets what is left: the can runs out
 await waterRun('water the herb bed','herb','hook');
 await camera(...VIEW.beds);await page.waitForTimeout(4000);
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);let bytes=null;try{bytes=await page.evaluate(async()=>{const a=window.__tapAudio;if(!a)return null;await new Promise(r=>{a.rec.onstop=r;a.rec.stop();});const b=new Blob(a.chunks,{type:'audio/webm'});const buf=await b.arrayBuffer();a.stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(buf));});}catch{}if(bytes)writeFileSync(out+'/actual-audio.webm',Buffer.from(bytes));writeFileSync(out+'/proof.json',JSON.stringify({pass,ids,commands,marks,samples,errors,method:'Real full client, one ordinary paired Soul CLI seat, plain words; camera read-only, moved only while she walks; actual WebAudio master tap recorded; music playlist off.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors:errors.length}));}
