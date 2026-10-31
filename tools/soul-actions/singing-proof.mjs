// Entry 36 real-client proof: Ben plays the piano and Ada the drums; Bea, told in plain words, walks to the microphone,
// takes the mic and sings along; Cal asks to sing at the same mic and is refused; Bea is told to stop singing, then to sing
// again, and stops by herself when the band's time is up. Ordinary paired Soul CLI seats, plain words; camera read-only
// and fixed; frames stamped with the depicted tick; the visitor's actual WebAudio output recorded (the playlist turned off
// with the visitor's own speaker button, which also unlocks sound). Samples of the drawn rigs every ~50 ms.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_SING_SCENE??'<team>/soul-actions/day-36/scene',out=process.env.SOUL_SING_OUT??'<team>/soul-actions/day-36/visual-01',port=Number(process.env.SOUL_SING_PORT??7874),base=`http://127.0.0.1:${port}/w/soul-singing`;mkdirSync(out,{recursive:true});
const BAND=Number(process.env.SOUL_SING_BAND??80);
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[],marks=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false,viewport=null;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'singing-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const sample=()=>page.evaluate(()=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,instrument:e.instrument,bones:{activity:b.activity,walkW:b.walkW,hipY:b.hipY,feet:b.feet,head:b.head,variety:b.variety??null,arms:b.arms.map(a=>({side:a.side,palm:a.palm,target:a.target,err:a.err,source:a.source}))}});}
 let mic=null;const m=api.layer.model;for(const e of m.entities.values())if(e.name==='microphone'){const w=m.worldPose(e),c=Math.cos(w.yaw),s=Math.sin(w.yaw),L=[0,1.41,0.252].map(v=>v*w.s),G=[0,1.47,0.338].map(v=>v*w.s);mic={grip:[w.x+L[0]*c+L[2]*s,w.y+L[1],w.z-L[0]*s+L[2]*c],grille:[w.x+G[0]*c+G[2]*s,w.y+G[1],w.z-G[0]*s+G[2]*c],pole:[w.x,w.y,w.z]};}
 const st=window.__edenSound?.state();return {at:Date.now(),tick:f.tick,dt:f.dt,world:api.worldSeconds,bodies,mic,sound:st?{level:window.__edenSound.level(),piano:st.piano,drums:st.drums,voice:st.voice,music:window.__edenMusic?.state?.()?.volume??null}:null};});
const run=async(seat,words,params)=>{const start=Date.now(),tick=await page.evaluate(()=>window.__simEntity.depictedTick).catch(()=>null);let result;try{const r=await promisify(execFile)(process.execPath,['eden.mjs','act',words,...(params?[JSON.stringify(params)]:[]),'--wait','150','--json'],{cwd:scene+'/'+seat,timeout:200000});result=JSON.parse(r.stdout);}catch(e){result={error:String(e).slice(0,400),stdout:e.stdout?.slice?.(0,2000)};}const c={seat,words,params,start,sentTick:tick,end:Date.now(),result};commands.push(c);writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));return c;};
const mark=async(label)=>{const tick=await page.evaluate(()=>window.__simEntity.depictedTick);marks.push({label,at:Date.now(),tick});};
let beaBody=null;const bea=()=>{const s=samples.filter(Boolean).at(-1);if(!beaBody){const b=s?.bodies.find(b=>b.activity==='sing');if(b)beaBody=b.id;}return s?.bodies.find(b=>b.id===beaBody);};
const waitFor=async(pred,ms)=>{const t0=Date.now();while(Date.now()-t0<ms){if(pred())return true;await page.waitForTimeout(100);}return false;};
try{
 await post('/v1/god/env',{timeOfDay:process.env.SOUL_SING_TIME??'16:30',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+(process.env.SOUL_SING_EYE??'/?eye=0.7,1.7,1.75&at=0.05,1.15,4.8'));await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=4&&window.__edenSound,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 writeFileSync(out+'/initial.yml',await page.locator('body').ariaSnapshot());viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio}));
 await page.getByRole('button',{name:'Music is on: turn off',exact:true}).click();await page.waitForFunction(()=>window.__edenSound.state().ctx==='running');
 const audioStart=await page.evaluate(()=>{const stream=window.__edenSound.tap();if(!stream)throw Error('no audio output');const chunks=[],rec=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:192000});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};window.__singAudio={rec,chunks,stream};rec.start();return{at:Date.now(),tick:window.__simEntity.depictedTick};});writeFileSync(out+'/audio-start.json',JSON.stringify(audioStart));
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 await page.waitForTimeout(2500);
 // the band starts; Bea goes to the microphone once they are playing
 const band=[run('ben','play the piano',{seconds:BAND}),run('ada','play the nearest drums',{seconds:BAND})];
 await waitFor(()=>{const s=samples.filter(Boolean).at(-1);return s&&s.bodies.some(b=>b.activity==='play-piano')&&s.bodies.some(b=>b.activity==='play-music');},60000);await mark('band-playing');
 await page.waitForTimeout(3000);
 const sing1=run('bea','sing at the microphone');
 await waitFor(()=>bea()?.activity==='sing',60000);await mark('bea-singing');
 await page.waitForTimeout(16000);
 await run('cal','sing at the microphone');await mark('cal-refused');
 await page.waitForTimeout(6000);
 await mark('stop-sent');await run('bea','stop singing');
 await waitFor(()=>bea()&&bea().activity!=='sing',10000);await mark('bea-stopped');
 await page.waitForTimeout(5000);
 const sing2=run('bea','sing at the microphone');await waitFor(()=>bea()?.activity==='sing',30000);await mark('bea-singing-2');
 // the CLI's wait returns once an act has started: the band's end is read from the depiction
 await waitFor(()=>{const s=samples.filter(Boolean).at(-1);return s&&!s.bodies.some(b=>b.activity==='play-piano'||b.activity==='play-music');},(BAND+40)*1000);await mark('band-done');
 await waitFor(()=>bea()&&bea().activity!=='sing',10000);await mark('bea-stopped-2');await Promise.all([...band,sing1,sing2]);
 await page.waitForTimeout(4000);
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);let bytes=null,voiceLog=null;try{voiceLog=await page.evaluate(()=>window.__edenSound.voiceLog());bytes=await page.evaluate(async()=>{const a=window.__singAudio;if(!a)return null;await new Promise(r=>{a.rec.onstop=r;a.rec.stop();});const b=new Blob(a.chunks,{type:'audio/webm'});const buf=await b.arrayBuffer();a.stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(buf));});}catch{}if(bytes)writeFileSync(out+'/actual-audio.webm',Buffer.from(bytes));writeFileSync(out+'/proof.json',JSON.stringify({pass,beaBody,commands,marks,samples,voiceLog,errors,viewport,method:'Real full client, four ordinary paired Soul CLI seats, plain words; actual WebAudio master tap recorded; music playlist off; camera fixed.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.map(c=>[c.seat,c.words,c.result?.accepted,c.result?.receipt?.phase,c.result?.code]),samples:samples.length,marks,errors}));}
