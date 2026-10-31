// Entry 43 real-client proof (entry 34's watering-proof.mjs): Ada, an ordinary paired Soul CLI seat, makes tea in plain
// words: "fill the kettle", "put the kettle on" (it heats, boils, clicks off), "pour the tea", "pick up the cup",
// "put the cup on the table". Then the world is stopped and started again on the same data, the page reloads, and the cup
// of tea is still on the table; "make a cup of tea" fills the second mug from the still-hot kettle. The camera is
// read-only and moves only while she walks. Continuous recording with frame stamps; the actual WebAudio is recorded.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_TEA_SCENE??'<team>/soul-actions/day-43/scene',out=process.env.SOUL_TEA_OUT??'<team>/soul-actions/day-43/visual-01',port=process.env.SOUL_TEA_PORT??7882,base=`http://127.0.0.1:${port}/w/soul-tea`;mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[],marks=[],reads=[];page.on('pageerror',e=>errors.push(String(e.stack??e)));let timer,busy=false,pass=false,phase='before';
const run=promisify(execFile);
const snap=await(await fetch(base+'/v1/world/snapshot')).json(),id=n=>snap.entities.find(e=>e.name===n).id,ids={kettle:id('kettle'),cup:id('cup'),cup2:id('cup-two'),sink:id('sink'),counter:id('counter'),table:id('table')};
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});};
// views: the counter from the side (her arms, the kettle, the cups); the sink from behind her right; the table
const VIEW={counter:[[1.55,1.5,1.75],[-0.05,0.98,2.95]],kettle:[[-0.75,1.62,4.15],[0.05,1.0,2.85]],pour:[[-0.75,1.62,4.15],[0.05,1.0,2.85]],sink:[[-1.05,1.55,1.95],[-2.15,0.95,3.0]],table:[[1.25,1.55,0.45],[2.55,0.85,1.55]],wide:[[0.6,2.3,-0.6],[0.2,0.8,2.4]]};
const STATIONS={counter:[0,2.55],sink:[-2.75,2.95],table:[2.6,1.0]};
// what the viewer draws, every 50 ms: the body (bones, hands), the drawn kettle (grip, palm, tilt, turn, the pour stream),
// the cups (drawn, palm, tea), steam, the world state and the kettle's voice
const sample=()=>page.evaluate((ids)=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const L=api.layer,V=()=>new (L.thingsGroup.position.constructor)(),v=x=>x?[x.x,x.y,x.z]:null,bodies=[];
 for(const [bid,e]of Object.entries(f.entities)){const b=f.bones?.[bid];if(!b)continue;bodies.push({id:bid,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,watering:e.state?.wateringV1??null,actuator:e.state?.handActuator?{target:e.state.handActuator.target,at:e.state.handActuator.at,startTick:e.state.handActuator.startTick}:null,transfer:e.state?.itemTransferV1??null,handTransfer:e.state?.handTransferV1??null,bones:{activity:b.activity,walkW:b.walkW,hipY:b.hipY,feet:b.feet,variety:b.variety??null,arms:b.arms.map(a=>({side:a.side,palm:a.palm,target:a.target,err:a.err}))}});}
 const d=L.drawn.get(ids.kettle);let kettle=null;
 if(d){const grip=d.obj.userData.handleGrip,g=grip?d.obj.localToWorld(V().set(grip[0],grip[1],grip[2])):null,sw=d.obj.localToWorld(V().set(-0.118,0.236,0)),body=L.held.get(ids.kettle),fig=body?L.figureOf(body):null;let palm=null;if(fig){const w=fig.wrists[1].getWorldPosition(V());const k=fig.knuckles[1];if(k)w.lerp(k.getWorldPosition(V()),0.5);palm=v(w);}
  const pour=L.pours.get(ids.kettle),st=L.steamers.get(ids.kettle);
  kettle={p:v(d.obj.position),q:d.obj.quaternion.toArray(),grip:v(g),switch:v(sw),palm,held:!!body,tilt:fig?.holder.userData.wateringTilt??0,flow:fig?.holder.userData.wateringFlow??0,turn:fig?.holder.userData.wateringYaw??0,pour:d.obj.userData.pourDebug??null,stream:pour?{visible:pour.visible,dir:pour.material.uniforms.uDir.value,drop:pour.material.uniforms.uDrop.value,flow:pour.material.uniforms.uFlow.value}:null,heat:d.obj.userData.kettleHeat??null,steam:st?{visible:st.pts.visible,heat:st.pts.material.uniforms.uHeat.value,lamp:!!st.lamp?.visible}:null};}
 const cups={};for(const k of ['cup','cup2']){const c=L.drawn.get(ids[k]);if(!c)continue;const st=L.steamers.get(ids[k]);cups[k]={p:v(c.obj.position),held:L.held.has(ids[k]),steam:st?st.pts.visible:null,steamHeat:st?st.pts.material.uniforms.uHeat.value:null};}
 const st={};for(const e of L.model.entities.values())for(const [k,i]of Object.entries(ids))if(e.id===i&&['kettle','cup','cup2','sink'].includes(k))st[k]={parent:e.in.parent,...e.state};
 const s=window.__edenSound,heard=(s?.state()?.heard??[]).filter(h=>h.kind==='kettle'||h.kind==='water').map(h=>({id:h.id,kind:h.kind,d:Math.round(h.d*100)/100}));
 return {at:Date.now(),tick:f.tick,dt:f.dt,depicted:api.depictedTick,bodies,kettle,cups,st,heard};},ids);
const act=async(words,wait=150)=>{const start=Date.now(),r=await run(process.execPath,['eden.mjs','act',words,'--wait',String(wait),'--json'],{cwd:scene+'/ada',timeout:300000}),result=JSON.parse(r.stdout);commands.push({seat:'ada',words,start,end:Date.now(),tick:samples.at(-1)?.tick,result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt.phase,'completed',JSON.stringify(result).slice(0,800));return result;};
const here=async(note)=>{const r=await run(process.execPath,['eden.mjs','here'],{cwd:scene+'/ada',timeout:60000});const h=JSON.parse(r.stdout);reads.push({note,at:Date.now(),tick:samples.at(-1)?.tick,objects:h.objects.filter(o=>o.state),bytes:JSON.stringify({...h,tick:0}).length});writeFileSync(out+'/reads.json',JSON.stringify(reads,null,2));};
let follow=false,lastView='';
const steer=async()=>{const s=samples.at(-1),b=s?.bodies[0];if(!follow||!b||b.bones.walkW<0.5)return;
 const near=Object.entries(STATIONS).map(([k,[x,z]])=>[k,Math.hypot(b.p[0]-x,b.p[2]-z)]).sort((p,q)=>p[1]-q[1])[0];if(near&&near[1]<1.7&&lastView!==near[0]){lastView=near[0];marks.push({tick:s.tick,view:near[0]});await camera(...VIEW[near[0]]);}};
const startAudio=async(name)=>{const a=await page.evaluate(()=>{const stream=window.__edenSound.tap();if(!stream)throw Error('no audio output');const chunks=[],rec=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};window.__tapAudio={rec,chunks,stream};rec.start();return{at:Date.now(),tick:window.__simEntity.depictedTick};});writeFileSync(out+'/'+name+'-start.json',JSON.stringify(a));};
const stopAudio=async(name)=>{let bytes=null;try{bytes=await page.evaluate(async()=>{const a=window.__tapAudio;if(!a)return null;await new Promise(r=>{a.rec.onstop=r;a.rec.stop();});const b=new Blob(a.chunks,{type:'audio/webm'});const buf=await b.arrayBuffer();a.stream.getTracks().forEach(t=>t.stop());window.__tapAudio=null;return Array.from(new Uint8Array(buf));});}catch{}if(bytes)writeFileSync(out+'/'+name+'.webm',Buffer.from(bytes));};
const ready=async()=>{await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1&&window.__edenSound,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 // a user gesture unlocks the page's audio: the music toggle (left off). After a reload the setting is remembered off,
 // so it is turned on and off again (two clicks) to give the gesture.
 const on=page.getByRole('button',{name:'Music is on: turn off',exact:true}),off=page.getByRole('button',{name:'Music is off: turn on',exact:true});
 if(await on.count())await on.click();else if(await off.count()){await off.click();await page.waitForTimeout(300);if(await on.count())await on.click();}
 try{await page.waitForFunction(()=>window.__edenSound.state().ctx==='running',null,{timeout:30000});}catch(e){await page.keyboard.press('KeyM');await page.keyboard.press('KeyM');await page.waitForFunction(()=>window.__edenSound.state().ctx==='running',null,{timeout:15000}).catch(()=>marks.push({audio:'not unlocked after reload'}));}};
const sampling=()=>{timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s){s.phase=phase;samples.push(s);await steer();}}catch{}finally{busy=false;}},50);};
const kettlePhase=()=>samples.at(-1)?.kettle?.heat?.phase;
try{
 await page.goto(base+'/?eye=0.6,2.3,-0.6&at=0.2,0.8,2.4');await ready();await startAudio('audio-1');sampling();
 await camera(...VIEW.wide);await page.waitForTimeout(2500);
 phase='fill';follow=true;lastView='';await act('fill the kettle');await page.waitForTimeout(1500);
 phase='boil';await act('put the kettle on');follow=false;await camera(...VIEW.kettle);marks.push({tick:samples.at(-1)?.tick,view:'kettle'});
 await here('heating');
 for(let t0=Date.now();Date.now()-t0<60000&&kettlePhase()!=='boiling';)await page.waitForTimeout(300);
 await page.waitForTimeout(1500);await here('boiling');
 for(let t0=Date.now();Date.now()-t0<20000&&kettlePhase()!=='hot';)await page.waitForTimeout(300);
 await page.waitForTimeout(2500);
 phase='pour';await camera(...VIEW.pour);marks.push({tick:samples.at(-1)?.tick,view:'pour'});await act('pour the tea');await page.waitForTimeout(2000);
 phase='carry';follow=true;lastView='counter';await act('pick up the cup');await act('put the cup on the table');await page.waitForTimeout(2500);follow=false;await here('cup of tea on the table');
 // restart: the world stops and starts again on the same data; the page reloads
 phase='restart';await stopAudio('audio-1');clearInterval(timer);await page.waitForTimeout(200);
 const world=JSON.parse(readFileSync(scene+'/world.json'));marks.push({restart:'stop',at:Date.now(),tick:samples.at(-1)?.tick,pid:world.pid});process.kill(world.pid);
 for(let i=0;i<100;i++){try{await fetch(base+'/healthz');await new Promise(r=>setTimeout(r,200));}catch{break;}}
 await run(process.execPath,['tools/soul-actions/start-tea.mjs'],{cwd:new URL('../..',import.meta.url).pathname,env:{...process.env,SOUL_TEA_SCENE:scene},timeout:300000});marks.push({restart:'started',at:Date.now()});
 await page.goto(base+'/?eye=1.25,1.55,0.45&at=2.55,0.85,1.55');await ready();await startAudio('audio-2').catch(e=>marks.push({audio2:String(e)}));phase='after-restart';sampling();await camera(...VIEW.table);marks.push({tick:samples.at(-1)?.tick,view:'table',after:'restart'});
 await page.waitForTimeout(5000);await here('after restart');
 phase='brew';follow=true;lastView='table';await act('make a cup of tea');await page.waitForTimeout(3000);follow=false;await here('second cup');
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);await stopAudio(phase==='restart'?'audio-1':'audio-2');writeFileSync(out+'/proof.json',JSON.stringify({pass,ids,commands,marks,reads,samples,errors,method:'Real full client, one ordinary paired Soul CLI seat, plain words; camera read-only, moved only while she walks or between acts; actual WebAudio master tap recorded (before and after the restart); music playlist off.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors:errors.slice(0,3)}));}
