// Entry 32 real-client proof: two ordinary paired Soul CLI seats (Ada, Bea; Bea owns the courtyard-door), plain words only.
// The owner walks in and locks it by hand; Ada is refused; Ada knocks and Bea (inside) hears it; Bea unlocks and Ada comes
// in; Bea locks; both walk out of the locked yard together (Ada turns the thumb-turn, Bea waits behind, shuts it, it locks
// again); Bea's key from outside; Ada locked in alone walks out (thumb-turn, latch).
// Two fixed read-only cameras: inside (sampled every 50 ms, actual WebAudio recorded) and outside; frames stamped with the
// depicted tick; uncut continuous recordings. SOUL_LOCKS_FRAME=1: framing stills only, no command sent.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const run=promisify(execFile),scene=process.env.SOUL_LOCKS_SCENE??'<team>/soul-actions/day-32/scene',out=process.env.SOUL_LOCKS_OUT??'<team>/soul-actions/day-32/visual-01',base='http://127.0.0.1:7872/w/soul-door-locks';mkdirSync(out,{recursive:true});
const FRAME=process.env.SOUL_LOCKS_FRAME==='1',INSIDE=process.env.SOUL_LOCKS_EYE_IN??'/?eye=-8.9,3.3,6.9&at=-6.2,1.0,3.1',OUTSIDE=process.env.SOUL_LOCKS_EYE_OUT??'/?eye=-3.1,3.1,-0.9&at=-6.1,1.1,3.0';
const cliSrc=new URL('../world-launcher/soul/eden.mjs',import.meta.url).pathname;
const cli=async(seat,args,timeout=200000)=>JSON.parse((await run(process.execPath,['eden.mjs',...args,'--json'],{cwd:scene+'/'+seat,timeout})).stdout);
const eventsOf=async seat=>JSON.parse((await run(process.execPath,['eden.mjs','events'],{cwd:scene+'/'+seat,timeout:60000})).stdout);
const seats={ada:'Ada',bea:'Bea'},ids={};
for(const [seat,name] of Object.entries(seats)){const dir=scene+'/'+seat;mkdirSync(dir,{recursive:true});if(!existsSync(dir+'/.eden-agent.json')){copyFileSync(cliSrc,dir+'/eden.mjs');await cli(seat,['register',base]);await cli(seat,['create',name]);}const st=await cli(seat,['status']);ids[seat]=st.soul?.id?'h_'+st.soul.id.slice(2):null;}
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const ctx=await browser.newContext({viewport:{width:1440,height:1080},...(FRAME?{}:{recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}})}),page=await ctx.newPage();
const ctx2=await browser.newContext({viewport:{width:1120,height:840},...(FRAME?{}:{recordVideo:{dir:out+'/raw-outside',size:{width:1120,height:840}}})}),page2=await ctx2.newPage();
const errors=[],samples=[],commands=[],marks=[],events={};let busy=false,timer,pass=false;page.on('pageerror',e=>errors.push(String(e)));page2.on('pageerror',e=>errors.push('outside: '+String(e)));
const frame=()=>page.evaluate(()=>{const a=window.__simEntity,f=a.contactFrame();if(!f?.bones)return null;const d=[...a.layer.model.entities.values()].find(e=>e.name==='courtyard-door'),obj=d&&a.layer.drawn.get(d.id)?.obj;
 const part=n=>{const o=obj?.getObjectByName('role:'+n);return o?{x:+o.position.x.toFixed(4),rz:+o.rotation.z.toFixed(4),visible:o.visible}:null;};
 return {at:Date.now(),tick:f.tick,dt:f.dt,bodies:Object.entries(f.entities).filter(([id])=>f.bones?.[id]).map(([id,e])=>({id,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,motion:e.state?.handActuator,arms:f.bones[id].arms,hipY:f.bones[id].hipY,pose:f.bones[id].pose,feet:f.bones[id].feet})),
  door:d?{id:d.id,state:d.state,angle:obj?.getObjectByName('role:door')?.rotation.y??null,bolt:part('bolt'),thumb:part('thumb'),key:part('key')}:null};});
const mark=async label=>{const f=await frame();marks.push({label,tick:f?.tick,at:Date.now()});writeFileSync(out+'/marks.json',JSON.stringify(marks,null,2));};
const act=async(seat,words,expect='completed')=>{const start=await frame(),t0=Date.now();let r;try{r=await cli(seat,['act',words,'--wait','150']);}catch(e){r={error:String(e.stdout??e)};}
 commands.push({seat,words,startTick:start?.tick,start:t0,end:Date.now(),result:r});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));
 if(expect==='refused')assert.equal(r.accepted,false,JSON.stringify(r));else{assert.equal(r.accepted,true,JSON.stringify(r));assert.equal(r.receipt?.phase,'completed',JSON.stringify(r));}return r;};
const open=async(p,eye)=>{await p.goto(base+eye);await p.waitForFunction(()=>Object.keys(window.__simEntity?.contactFrame()?.bones??{}).length>=2&&window.__edenSound,null,{timeout:180000});await p.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await p.waitForTimeout(2500);};
try{
 const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'door-locks-proof'})})).json()).token;
 const env=await(await fetch(base+'/v1/god/env',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({timeOfDay:process.env.SOUL_LOCKS_TIME??'10:30',timeScale:0,weather:{kind:'clear'}})})).json();assert.equal(env.accepted,true);
 await open(page,INSIDE);await open(page2,OUTSIDE);
 if(FRAME){await page.screenshot({path:out+'/frame-inside.png'});await page2.screenshot({path:out+'/frame-outside.png'});console.log(JSON.stringify(await frame()).slice(0,600));pass=true;}
 else{
 await installFrameStamp(page);await installFrameStamp(page2);
 writeFileSync(out+'/initial.yml',await page.locator('body').ariaSnapshot());await page.screenshot({path:out+'/initial.png'});
 // the visitor's own speaker button turns the music off and unlocks sound; then the page's actual output is recorded
 await page.getByRole('button',{name:'Music is on: turn off',exact:true}).click();await page.waitForFunction(()=>window.__edenSound.state().ctx==='running');
 const audioStart=await page.evaluate(()=>{const stream=window.__edenSound.tap();if(!stream)throw Error('no audio output');const chunks=[],rec=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};window.__locksAudio={rec,chunks,stream};rec.start();return{at:Date.now(),tick:window.__simEntity.depictedTick};});writeFileSync(out+'/audio-start.json',JSON.stringify(audioStart));
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await frame();if(s)samples.push(s);}finally{busy=false;}},50);
 await page.waitForTimeout(2000);
 await mark('1-owner-in');await act('bea','walk to the courtyard-bench');await page.waitForTimeout(1200);
 await mark('2-lock');await act('bea','lock the courtyard-door');await act('bea','walk to the courtyard-bench');await page.waitForTimeout(1200);
 await mark('3-refused');await act('ada','unlock the courtyard-door','refused');await act('ada','walk to the olive-bench','refused');await page.waitForTimeout(1500);
 await mark('4-knock');events.before={bea:await eventsOf('bea'),ada:await eventsOf('ada')};await act('ada','knock on the courtyard-door');await page.waitForTimeout(1500);events.after={bea:await eventsOf('bea'),ada:await eventsOf('ada')};writeFileSync(out+'/events.json',JSON.stringify(events,null,2));
 await mark('5-answer');await act('bea','unlock the courtyard-door');await act('bea','walk to the courtyard-bench');await act('ada','walk to the olive-bench');await act('bea','lock the courtyard-door');await act('bea','walk to the courtyard-bench');await page.waitForTimeout(1500);
 await mark('6-escape-following');await Promise.all([act('ada','walk to the west-bench'),(async()=>{await page.waitForTimeout(2500);return act('bea','walk to the east-lantern');})()]);await page.waitForTimeout(1500);
 await mark('7-key');await act('bea','unlock the courtyard-door');await act('bea','walk to the east-lantern');await act('ada','walk to the olive-bench');await act('bea','lock the courtyard-door');await page.waitForTimeout(1500);
 await mark('8-solo-escape');await act('ada','walk to the west-bench');await page.waitForTimeout(3000);await mark('end');
 assert.deepEqual(errors,[]);pass=true;}
}finally{clearInterval(timer);let bytes=null,contacts=null;try{contacts=await page.evaluate(()=>window.__edenSound?.contacts?.()??null);bytes=await page.evaluate(async()=>{const a=window.__locksAudio;if(!a)return null;await new Promise(r=>{a.rec.onstop=r;a.rec.stop();});const b=new Blob(a.chunks,{type:'audio/webm'});const buf=await b.arrayBuffer();a.stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(buf));});}catch{}
 if(bytes)writeFileSync(out+'/actual-audio.webm',Buffer.from(bytes));
 writeFileSync(out+'/proof.json',JSON.stringify({pass,ids,errors,commands,marks,contacts,samples,method:'Actual full client; two ordinary paired Soul CLI seats driven by plain words; two fixed read-only cameras (inside sampled, outside recorded); native root/hand/leaf/lock timeline; actual WebAudio master tap of the inside page; no teleport; continuous sources retained.'}));
 try{if(!FRAME){const v=page.video(),v2=page2.video();await ctx.close();await ctx2.close();await v.saveAs(out+'/continuous.webm');await v2.saveAs(out+'/continuous-outside.webm');}else{await ctx.close();await ctx2.close();}}finally{await browser.close();}
 console.log(JSON.stringify({pass,errors,commands:commands.map(c=>[c.seat,c.words,c.result?.accepted,c.result?.receipt?.phase??c.result?.error?.code??c.result?.code]),samples:samples.length}));}
