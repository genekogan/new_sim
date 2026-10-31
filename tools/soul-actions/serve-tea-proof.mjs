// Entry 44 real-client proof (entries 41 and 43's proofs): two ordinary paired Soul CLI seats, Ada and Ben, in plain words.
// Ada makes a cup of tea, picks it up and offers it to Ben ("offer Ben the tea"); he accepts. She makes a second cup and
// picks it up; both drink at the table at once ("drink the tea"); both put their mugs on the table; Ben washes his
// ("wash the cup"): to the sink, rinsed under the tap, back on the table clean. The world is stopped and started again on
// the same data, the page reloads, and the table is as they left it. Camera read-only, moved only between acts or while a
// Soul walks; continuous recording with frame stamps; the actual WebAudio (the tap) recorded.
// SOUL_SERVE_PLAN=cal: a calibration run (not a take): a cup of tea on the counter, Ada picks it up and takes two sips
// with the camera on her face; stills at each sip.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_TEA_SCENE??'<team>/soul-actions/day-44/scene',out=process.env.SOUL_TEA_OUT??'<team>/soul-actions/day-44/visual-01',port=process.env.SOUL_TEA_PORT??7883,base=`http://127.0.0.1:${port}/w/soul-serve-tea`,plan=process.env.SOUL_SERVE_PLAN??'take';mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[],marks=[],reads=[];page.on('pageerror',e=>errors.push(String(e.stack??e)));let timer,busy=false,pass=false,phase='before';
const run=promisify(execFile),wait=ms=>new Promise(r=>setTimeout(r,ms));
const snap=await(await fetch(base+'/v1/world/snapshot')).json(),id=n=>snap.entities.find(e=>e.name===n).id,ids={kettle:id('kettle'),cup:id('cup'),cup2:id('cup-two'),sink:id('sink'),counter:id('counter'),table:id('table')};
const camera=async(eye,at,why)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});marks.push({tick:samples.at(-1)?.tick,at:Date.now(),camera:why??'set',eye,look:at});};
// views: the counter; the table from its long side (both faces in profile across it); the sink from behind his right
const VIEW={counter:[[1.55,1.5,1.75],[-0.05,0.98,2.95]],table:[[2.6,1.55,-0.55],[2.6,1.15,1.4]],tableSide:[[4.45,1.62,1.4],[2.6,1.2,1.4]],sink:[[-1.15,1.55,1.85],[-2.2,1.0,3.0]],wide:[[0.4,2.6,-1.6],[0.6,0.8,2.2]],face:[[1.5,1.62,1.55],[0.2,1.35,2.45]]};
const STATIONS={counter:[0,2.55],sink:[-2.75,2.85],table:[2.6,1.4]};
// what the viewer draws, every 50 ms: bodies (bones, head, hands), the mugs (drawn pose, the cup timeline's debug, the
// world state), the tap's stream, the rinse water's stream, the tap's voice
const sample=()=>page.evaluate((ids)=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const L=api.layer,v=x=>x?[x.x,x.y,x.z]:null,bodies=[];
 for(const [bid,e]of Object.entries(f.entities)){const b=f.bones?.[bid];if(!b)continue;bodies.push({id:bid,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,cup:e.state?.cupV1?{stage:e.state.cupV1.stage,startTick:e.state.cupV1.startTick,item:e.state.cupV1.item,hand:e.state.cupV1.hand}:null,transfer:e.state?.itemTransferV1??null,handOver:e.state?.handOverV1??null,letGo:e.state?.letGoV1??null,bones:{activity:b.activity,walkW:b.walkW,hipY:b.hipY,head:b.head,feet:b.feet,variety:b.variety??null,pose:b.pose,arms:b.arms.map(a=>({side:a.side,palm:a.palm,target:a.target,err:a.err}))}});}
 const cups={};for(const k of ['cup','cup2']){const c=L.drawn.get(ids[k]);if(!c)continue;const pour=L.pours.get(ids[k]),wtr=L.cupWaters?.get(ids[k]);cups[k]={p:v(c.obj.position),q:c.obj.quaternion.toArray(),held:L.held.has(ids[k]),holder:L.held.get(ids[k])??null,shown:c.obj.visible,debug:c.obj.userData.cupShown?c.obj.userData.cupDebug??null:null,pour:pour?{visible:pour.visible,flow:pour.material.uniforms.uFlow.value,drop:pour.material.uniforms.uDrop.value,p:v(pour.position)}:null,water:wtr?{visible:wtr.visible,p:v(wtr.position),r:wtr.scale.x}:null};}
 const st={};for(const e of L.model.entities.values())for(const [k,i]of Object.entries(ids))if(e.id===i&&['cup','cup2','sink','kettle'].includes(k))st[k]={parent:e.in.parent,...e.state};
 const jets=[...L.tapJets.values()].map(j=>{const p=j.getWorldPosition(new (L.thingsGroup.position.constructor)());return{visible:j.visible,drop:j.material.uniforms.uDrop.value,p:v(p)};});
 const s=window.__edenSound,heard=(s?.state()?.heard??[]).filter(h=>h.kind==='water'||h.kind==='kettle').map(h=>({id:h.id,kind:h.kind,d:Math.round(h.d*100)/100}));
 return {at:Date.now(),tick:f.tick,dt:f.dt,depicted:api.depictedTick,bodies,cups,st,jets,heard};},ids);
const cli=async(seat,args,timeout=300000)=>JSON.parse((await run(process.execPath,['eden.mjs',...args],{cwd:scene+'/'+seat,timeout,maxBuffer:1<<24})).stdout);
const TERMINAL=['completed','failed','cancelled','replaced','refused'];const settle=async(seat,r)=>{if(!r.receipt?.id||TERMINAL.includes(r.receipt.phase))return r;for(let i=0;i<1200;i++){const q=await cli(seat,['receipt',r.receipt.id]);const ph=q.phase??q.receipt?.phase;if(TERMINAL.includes(ph))return {...r,receipt:q.receipt??q};await wait(250);}return r;};
const act=async(seat,words,wait=200)=>{const start=Date.now(),result=await settle(seat,await cli(seat,['act',words,'--wait',String(wait),'--json']));commands.push({seat,words,start,end:Date.now(),tick:samples.at(-1)?.tick,result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,seat+' '+words+' '+JSON.stringify(result).slice(0,600));assert.equal(result.receipt.phase,'completed',seat+' '+words+' '+JSON.stringify(result).slice(0,900));return result;};
const send=async(seat,words)=>{const start=Date.now(),result=await cli(seat,['act',words,'--json']);commands.push({seat,words,start,end:Date.now(),tick:samples.at(-1)?.tick,result,sent:true});assert.equal(result.accepted,true,seat+' '+words+' '+JSON.stringify(result).slice(0,600));return result;};
const here=async(seat,note)=>{const h=await cli(seat,['here'],60000);reads.push({seat,note,at:Date.now(),tick:samples.at(-1)?.tick,me:h.me,objects:h.objects.filter(o=>o.state||/cup|mug/.test(o.name??'')),bytes:JSON.stringify({...h,tick:0}).length});writeFileSync(out+'/reads.json',JSON.stringify(reads,null,2));return h;};
let follow=null,lastView='';
const steer=async()=>{const s=samples.at(-1);if(!follow||!s)return;const b=s.bodies.find(x=>x.id===follow);if(!b||b.bones.walkW<0.5)return;
 const near=Object.entries(STATIONS).map(([k,[x,z]])=>[k,Math.hypot(b.p[0]-x,b.p[2]-z)]).sort((p,q)=>p[1]-q[1])[0];if(near&&near[1]<1.8&&lastView!==near[0]){lastView=near[0];await camera(...VIEW[near[0]],'follow '+near[0]);}};
const startAudio=async(name)=>{const a=await page.evaluate(()=>{const stream=window.__edenSound.tap();if(!stream)throw Error('no audio output');const chunks=[],rec=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};window.__tapAudio={rec,chunks,stream};rec.start();return{at:Date.now(),tick:window.__simEntity.depictedTick};});writeFileSync(out+'/'+name+'-start.json',JSON.stringify(a));};
const stopAudio=async(name)=>{let bytes=null;try{bytes=await page.evaluate(async()=>{const a=window.__tapAudio;if(!a)return null;await new Promise(r=>{a.rec.onstop=r;a.rec.stop();});const b=new Blob(a.chunks,{type:'audio/webm'});const buf=await b.arrayBuffer();a.stream.getTracks().forEach(t=>t.stop());window.__tapAudio=null;return Array.from(new Uint8Array(buf));});}catch{}if(bytes)writeFileSync(out+'/'+name+'.webm',Buffer.from(bytes));};
const ready=async(n=1)=>{await page.waitForFunction((n)=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=n&&window.__edenSound,n,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 const on=page.getByRole('button',{name:'Music is on: turn off',exact:true}),off=page.getByRole('button',{name:'Music is off: turn on',exact:true});
 if(await on.count())await on.click();else if(await off.count()){await off.click();await page.waitForTimeout(300);if(await on.count())await on.click();}
 try{await page.waitForFunction(()=>window.__edenSound.state().ctx==='running',null,{timeout:30000});}catch(e){await page.keyboard.press('KeyM');await page.keyboard.press('KeyM');await page.waitForFunction(()=>window.__edenSound.state().ctx==='running',null,{timeout:15000}).catch(()=>marks.push({audio:'not unlocked after reload'}));}};
const sampling=()=>{timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s){s.phase=phase;samples.push(s);await steer();}}catch{}finally{busy=false;}},50);};
const seatIds={};const bodyOf=async(seat)=>{if(!seatIds[seat]){const h=await cli(seat,['here'],60000);seatIds[seat]=h.me?.entity??h.me?.id??null;}return seatIds[seat];};
const stills=async(name)=>{mkdirSync(out+'/stills',{recursive:true});await page.screenshot({path:`${out}/stills/${name}.png`});};
try{
 await page.goto(base+'/?eye=0.4,2.6,-1.6&at=0.6,0.8,2.2');await ready(plan==='cal'?1:2);await startAudio('audio-1');sampling();
 await camera(...VIEW.wide,'wide');await page.waitForTimeout(2500);
 if(plan==='cal'){
  phase='pick';follow=null;await camera(...VIEW.counter,'counter');if(!process.env.SOUL_CAL_HOLDING)await act('ada','pick up the cup');
  phase='sip';
  // the camera beside her face once she stands still at the table: 0.8 m ahead-right of her, at head height
  const faceCam=async(side=1)=>{const s=samples.at(-1),b=s?.bodies[0];if(!b?.bones.head)return;const c=Math.cos(b.yaw),n=Math.sin(b.yaw),h=b.bones.head;const F=Number(process.env.SOUL_CAL_F??0.75),R=Number(process.env.SOUL_CAL_R??0.75);await camera([h[0]+c*F-n*R*side,h[1]+0.03,h[2]+n*F+c*R*side],[h[0]+c*0.08,h[1]-0.02,h[2]+n*0.08],'face');};
  for(let k=0;k<Number(process.env.SOUL_CAL_SIPS??3);k++){const p=send('ada','have a sip');let shot=0,cam=false;const t0=Date.now();while(Date.now()-t0<30000){await wait(100);const s=samples.at(-1),c=s?.cups?.cup?.debug;if(c&&!cam){await faceCam(k===1?-1:1);cam=true;}if(c?.atLips&&shot<8&&Date.now()-t0>1500+shot*300){await stills(`sip${k+1}-${shot++}`);}if(cam&&!c&&shot)break;}await p;}
  await page.waitForTimeout(1500);pass=true;
 }else{
  // Ben goes to the table first; Ada makes the tea at the counter
  phase='walk';await act('ben','walk to the table');
  phase='brew';follow=await bodyOf('ada');lastView='';await camera(...VIEW.counter,'counter');await act('ada','make a cup of tea',240);follow=null;
  phase='pick';await act('ada','pick up the cup');await here('ada','holding the tea');
  phase='offer';follow=await bodyOf('ada');lastView='';const g=send('ada','offer Ben the tea');
  for(let t0=Date.now();Date.now()-t0<40000;){const h=await cli('ben',['here'],60000);if(h.me?.offer){reads.push({seat:'ben',note:'offer line',at:Date.now(),tick:samples.at(-1)?.tick,me:h.me,bytes:JSON.stringify({...h,tick:0}).length});break;}await wait(400);}
  follow=null;await camera(...VIEW.table,'table hand-over');await act('ben','accept');await g;await page.waitForTimeout(2000);
  phase='brew2';follow=await bodyOf('ada');lastView='';await act('ada','make a cup of tea',240);await act('ada','pick up the cup');follow=null;
  phase='drink';await camera(...VIEW.tableSide,'table side: both drink');const [da,db]=await Promise.all([act('ada','drink the tea',240),act('ben','drink the tea',240)]);void da;void db;
  await here('ben','drunk');
  phase='set-down';await act('ben','put the cup on the table');await act('ada','put the cup on the table');await page.waitForTimeout(1500);await here('ben','empty mugs on the table');
  phase='wash';follow=await bodyOf('ben');lastView='table';await act('ben','wash the cup',240);follow=null;await camera(...VIEW.table,'table');await page.waitForTimeout(3000);await here('ben','after washing');
  // restart: the world stops and starts again on the same data; the page reloads
  phase='restart';await stopAudio('audio-1');clearInterval(timer);await page.waitForTimeout(200);
  const world=JSON.parse(readFileSync(scene+'/world.json'));marks.push({restart:'stop',at:Date.now(),tick:samples.at(-1)?.tick,pid:world.pid});process.kill(world.pid);
  for(let i=0;i<100;i++){try{await fetch(base+'/healthz');await wait(200);}catch{break;}}
  await run(process.execPath,['tools/soul-actions/start-serve-tea.mjs'],{cwd:new URL('../..',import.meta.url).pathname,env:{...process.env,SOUL_TEA_SCENE:scene},timeout:300000});marks.push({restart:'started',at:Date.now()});
  await page.goto(base+'/?eye=2.6,1.55,-0.55&at=2.6,1.15,1.4');await ready(2);await startAudio('audio-2').catch(e=>marks.push({audio2:String(e)}));phase='after-restart';sampling();await camera(...VIEW.table,'table after restart');
  await page.waitForTimeout(6000);await here('ben','after restart');
 }
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);await stopAudio(phase==='restart'?'audio-1':'audio-2').catch(()=>{});writeFileSync(out+'/proof.json',JSON.stringify({pass,plan,ids,seatIds,commands,marks,reads,samples,errors,method:'Real full client, two ordinary paired Soul CLI seats, plain words; camera read-only, moved between acts or while a Soul walks; actual WebAudio master tap recorded; music playlist off.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors:errors.slice(0,3)}));}
