// Entry 35 real-client proof: rock-paper-scissors and holding hands with consent, three ordinary paired Soul CLI seats
// (Ada, Bea, and Cy as a bystander) driven by plain words. Scenes: a game declined; a game played (hidden throws, the
// world's verdict); a hand offered and withdrawn; a hand offered and left to lapse; a hand offered and taken; a walk
// together; letting go; a hand offered back and taken; a walk together on which Bea is told to go elsewhere (she lets go
// first). The camera never touches the world: it is placed between commands from where the bodies are drawn. Frames are
// stamped with the depicted tick; samples of the drawn rig (palms, shoulders, hips, walk weight, the hand-game layer and
// finger curls) every ~50 ms feed hands-metrics.py.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_HANDS_SCENE??'<team>/soul-actions/day-35/scene',out=process.env.SOUL_HANDS_OUT??'<team>/soul-actions/day-35/visual-01',port=Number(process.env.SOUL_HANDS_PORT??7876),base=`http://127.0.0.1:${port}/w/soul-hands`;mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();
const videoStart=Date.now(),errors=[],samples=[],commands=[],reads=[],marks=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false,viewport=null,ids={};
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'hands-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const cli=async(seat,args)=>JSON.parse((await promisify(execFile)(process.execPath,['eden.mjs',...args],{cwd:scene+'/'+seat,timeout:240000,maxBuffer:1<<24})).stdout);
const depicted=()=>page.evaluate(()=>window.__simEntity.depictedTick);
const mark=async(label,extra={})=>{marks.push({label,at:Date.now(),video:(Date.now()-videoStart)/1000,tick:await depicted(),...extra});writeFileSync(out+'/marks.json',JSON.stringify(marks,null,1));};
/** One plain-word act; `bg` returns the pending promise (an offer waits for its answer). */
const TERMINAL=['completed','failed','cancelled','replaced'];
/** `act --wait` returns early on an invitation event (the CLI's own rule): then follow the receipt to its end. */
const settle=async(seat,r)=>{if(!r.receipt?.id||TERMINAL.includes(r.receipt.phase))return r;for(let i=0;i<600;i++){const q=await cli(seat,['receipt',r.receipt.id]);if(TERMINAL.includes(q.phase))return {...r,receipt:q};await page.waitForTimeout(250);}return r;};
const act=(seat,words,params,expect)=>{const start=Date.now();const p=(async()=>{const tick=await depicted(),r=await settle(seat,await cli(seat,['act',words,...(params?[JSON.stringify(params)]:[]),'--wait','60','--json']));const c={seat,words,params,start,sentTick:tick,end:Date.now(),video:[(start-videoStart)/1000,(Date.now()-videoStart)/1000],endTick:await depicted(),result:r};commands.push(c);writeFileSync(out+'/commands.json',JSON.stringify(commands,null,1));
 if(expect==='refused')assert.equal(r.accepted,false,JSON.stringify(r));else{assert.equal(r.accepted,true,JSON.stringify(r));if(expect)assert.equal(r.receipt?.phase==='completed'?'completed':r.receipt?.code,expect,JSON.stringify(r).slice(0,600));}return r;})();return p;};
const read=async(seat,what='here')=>{const r=await cli(seat,[what]);reads.push({seat,what,at:Date.now(),video:(Date.now()-videoStart)/1000,tick:await depicted(),[what]:r});writeFileSync(out+'/reads.json',JSON.stringify(reads,null,1));return r;};
const offerFor=async(seat,ms=30000)=>{const t0=Date.now();while(Date.now()-t0<ms){const h=await read(seat);if(h.me?.offer)return h;await page.waitForTimeout(400);}throw new Error('no offer reached '+seat);};
const sample=()=>page.evaluate(()=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,frame:api.renderer?.info?.render?.frame??null,hh:e.state?.handHold??null,rps:e.state?.rps??null,speed:e.state?.speed??null,bones:{template:b.template,activity:b.activity,walkW:b.walkW,hipY:b.hipY,feet:b.feet,head:b.head,variety:b.variety??null,handGame:b.handGame??null,arms:b.arms.map(a=>({side:a.side,palm:a.palm,shoulder:a.shoulder,len:a.len}))}});}
 return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,residents:api.residents().map(r=>({id:r.id,p:r.p}))};});
const drawn=()=>{const s=samples.at(-1);return s?Object.fromEntries(Object.entries(ids).map(([n,e])=>[n,s.bodies.find(b=>b.id===e)])):{};};
/** Camera between commands: `view(kind)` frames the pair from where they are drawn now (never during a command's body motion). */
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});await page.waitForTimeout(300);};
// Known places from start-hands.mjs (the lawn's far end, the orchard, the bench) for framing walks from the side.
const waitDrawn=async(cond,ms=20000)=>{const t0=Date.now();while(Date.now()-t0<ms){const d=drawn();if(d.ada&&d.bea&&cond(d))return true;await page.waitForTimeout(100);}return false;};
/** Walks: the camera keeps a fixed offset from the pair's drawn middle (square to their facing when the walk began, 5.5 m
 *  off, 2.2 m up), eased so it never jumps; it only follows, it never touches the world. Stop with track.stop(). */
let tracker=null;
function track(){let at=null,yaw=null,on=true;
 const step=async()=>{if(!on)return;const d=drawn(),a=d.ada,b=d.bea;if(a&&b){const m=[(a.p[0]+b.p[0])/2,(a.p[2]+b.p[2])/2];at=at?[at[0]+(m[0]-at[0])*.08,at[1]+(m[1]-at[1])*.08]:m;
  // from the side of the way they face now (eased, so the camera swings round slowly as they turn)
  yaw=yaw===null?a.yaw:yaw+Math.atan2(Math.sin(a.yaw-yaw),Math.cos(a.yaw-yaw))*.03;const f=[Math.cos(yaw),Math.sin(yaw)],side=[-f[1],f[0]];
  await page.evaluate(({eye,look})=>{const s=window.__simEntity;s.controls.target.set(...look);s.camera.position.set(...eye);s.camera.lookAt(s.controls.target);s.controls.update();},{eye:[at[0]+side[0]*5.5-f[0]*1.5,2.2,at[1]+side[1]*5.5-f[1]*1.5],look:[at[0],0.9,at[1]]});}
  if(on)setTimeout(step,50);};
 tracker={stop:()=>{on=false;}};void step();}
async function view(kind,arg){const d=drawn(),A=d.ada,B=d.bea;if(!A||!B)return;const m=[(A.p[0]+B.p[0])/2,(A.p[2]+B.p[2])/2],u=[B.p[0]-A.p[0],B.p[2]-A.p[2]],L=Math.hypot(...u)||1,n=[-u[1]/L,u[0]/L];
 if(kind==='side'){const s=Math.sign(n[0]*(4-m[0])+n[1]*(-6-m[1]))||1;await camera([m[0]+n[0]*s*2.1,1.3,m[1]+n[1]*s*2.1],[m[0],1.0,m[1]]);}
 // front: in front of the pair, the way the one standing still faces (arg: 'bea' or 'ada')
 else if(kind==='front'){const who=d[arg??'bea'],f=[Math.cos(who.yaw),Math.sin(who.yaw)];await camera([m[0]+f[0]*2.7-f[1]*0.5,1.45,m[1]+f[1]*2.7+f[0]*0.5],[m[0],0.95,m[1]]);}
 else await camera([m[0]+4.5,3.2,m[1]-5.5],[m[0],0.9,m[1]]);
 await mark('camera-'+kind+(arg?'-'+arg:''));}
try{
 await post('/v1/god/env',{timeOfDay:'16:00',timeScale:0,weather:{kind:'clear'}});
 for(const s of ['ada','bea','cy'])ids[s]=(await cli(s,['here'])).me.soulId;
 await page.goto(base+'/?eye=4,4,-6&at=0,1,2');await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=3,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio}));
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 await page.waitForTimeout(1500);
 // soul id → entity id: the resident at the same drawn point
 {const s=samples.at(-1),soul=Object.fromEntries(Object.entries(ids));for(const [n,sid] of Object.entries(soul)){const r=s.residents.find(x=>x.id===sid),b=r&&s.bodies.find(q=>Math.hypot(q.p[0]-r.p[0],q.p[2]-r.p[2])<1e-6);ids[n]=b?.id;}assert.ok(ids.ada&&ids.bea&&ids.cy,JSON.stringify(ids));}
 // Cy stands a few metres off as the bystander; Bea a little apart from Ada
 await act('cy','walk to the bench','','completed');
 await view('wide');await page.waitForTimeout(1500);
 // 1) a game declined
 const g1=act('ada','play rock-paper-scissors with Bea',{shape:'rock'},'invite.declined');
 await offerFor('bea');await read('cy');await read('ada');await mark('rps-offer-1');await page.waitForTimeout(2500);
 await act('bea','decline','','completed');await g1;await mark('rps-declined');await page.waitForTimeout(2500);
 // 2) a game played: Ada throws scissors, Bea paper (each chosen alone; the world keeps them until shoot)
 const g2=act('ada','play rock-paper-scissors with Bea',{shape:'scissors'},'completed');
 await offerFor('bea');await mark('rps-offer-2');await waitDrawn(d=>Math.hypot(d.ada.p[0]-d.bea.p[0],d.ada.p[2]-d.bea.p[2])<1.3&&d.ada.bones.walkW<.02);await view('side');await page.waitForTimeout(1000);
 const g3=act('bea','accept',{shape:'paper'},'completed');const [ra,rb]=await Promise.all([g2,g3]);await mark('rps-done',{ada:ra.receipt?.outcome?.summary,bea:rb.receipt?.outcome?.summary});
 assert.match(ra.receipt?.outcome?.summary??'',/You threw scissors; Bea threw paper\. You win\./);assert.match(rb.receipt?.outcome?.summary??'',/You threw paper; Ada threw scissors\. Ada wins\./);await page.waitForTimeout(2000);
 // 3) a hand offered, then withdrawn
 await view('wide');const h1=act('ada','offer Bea my hand',undefined,'invite.withdrawn');
 await offerFor('bea');await read('cy');await mark('hand-offer-1');await waitDrawn(d=>!!d.ada.hh?.offered);await view('front','bea');await page.waitForTimeout(3500);
 await act('ada','withdraw my offer','','completed');await h1;await mark('hand-withdrawn');await read('bea');await page.waitForTimeout(3000);
 // 4) a hand offered and left unanswered: it lapses
 const h2=act('ada','offer Bea my hand',undefined,'invite.expired');await offerFor('bea');await mark('hand-offer-2');await h2;await mark('hand-lapsed');await read('bea');await page.waitForTimeout(3000);
 // 5) a hand offered and taken
 const h3=act('ada','offer Bea my hand',undefined,'completed');await offerFor('bea');await mark('hand-offer-3');await page.waitForTimeout(2000);
 await act('bea','take her hand','','completed');await h3;await mark('hand-joined');await read('ada');await read('bea');await read('cy');await page.waitForTimeout(3000);
 // 6) a walk together
 track();await mark('camera-track-lawn');await act('ada','walk to the lawn','','completed');await page.waitForTimeout(1500);tracker.stop();await mark('walked-lawn');await page.waitForTimeout(1000);
 // 7) letting go
 await view('front','ada');await act('bea','let go of her hand','','completed');await mark('let-go');await page.waitForTimeout(3500);
 // 8) Bea offers back; Ada takes it
 const h4=act('bea','hold hands with Ada',undefined,'completed');await offerFor('ada');await mark('hand-offer-4');await page.waitForTimeout(1500);
 await act('ada','take her hand','','completed');await h4;await mark('hand-joined-2');await page.waitForTimeout(2500);
 // 9) walking together to the orchard; on the way Bea is told to go to the bench: she lets go first, then goes
 track();await mark('camera-track-orchard');const w2=act('ada','walk to the orchard','','completed');
 {const t0=Date.now();while(Date.now()-t0<20000){const b=drawn().bea;if(b&&b.bones.walkW>.9)break;await page.waitForTimeout(100);}}await page.waitForTimeout(2500);await mark('told-elsewhere');
 await act('bea','walk to the bench','','completed');await w2;await page.waitForTimeout(1500);tracker.stop();await mark('apart');await page.waitForTimeout(2000);
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,ids,videoStart,commands,reads,marks,samples,errors,viewport,method:'Real full client, three ordinary paired Soul CLI seats, plain words, continuous recording; camera placed between commands only.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
