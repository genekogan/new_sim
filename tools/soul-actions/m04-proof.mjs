// Entry 39 (M04) real-client proof: one scene through every shared transition. Ada walks to the garden tap and turns it on
// (walk start, walk stop, reach), stands until the client's idle variety plays a hand gesture, turns the tap off (reach out
// of the gesture), stands until a gesture plays again, then walks onto the low deck (walk start out of the gesture, step up)
// and stops on it. Ordinary paired Soul CLI seat, plain words; camera read-only and fixed; frames stamped with the depicted
// tick. Samples carry the drawn rig (palms, hips, feet, head, walk weight) every ~50 ms for m04-metrics.py.
// The idle-variety schedule below copies humans.ts (neutralWeight / idleVariant, hashId from people-light.ts) so the proof
// can wait for a gesture on the depicted clock; it never drives the renderer.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_M04_SCENE??'<team>/soul-actions/day-39/scene',out=process.env.SOUL_M04_OUT??'<team>/soul-actions/day-39/visual-01',port=Number(process.env.SOUL_M04_PORT??7873),base=`http://127.0.0.1:${port}/w/soul-m04`;mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[],marks=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false,viewport=null;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'m04-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const hashId=id=>{let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;return h;};
/** A hand gesture of the idle variety at full weight at depicted seconds t: {kind, left (s)} or null (humans.ts schedule). */
function gesture(id,t){const h=hashId(id),out=[];
 {const ph=(h%997)/997,u=((t/25+ph)%1)*25;if(u>=1&&u<6)out.push({kind:'Idle_Neutral',left:6-u});}
 {const ph=((h>>>7)%991)/991,cyc=t/37+ph,u=(cyc%1)*37,clip=['Idle_LookAround_Loop','Idle_FoldArms_Loop'][(Math.floor(cyc)+h)%2];if(u>=1.2&&u<9)out.push({kind:clip,left:9-u});}
 return out.sort((a,b)=>b.left-a.left)[0]??null;}
const sample=()=>page.evaluate(()=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,hands:e.hands,frame:api.renderer?.info?.render?.frame??null,motion:e.state?.handActuator??null,bones:{activity:b.activity,walkW:b.walkW,hipY:b.hipY,feet:b.feet,head:b.head,pose:b.pose,variety:b.variety??null,arms:b.arms.map(a=>({side:a.side,palm:a.palm,target:a.target,err:a.err}))}});}let on=null;for(const e of api.layer.model.entities.values())if(e.name==='garden-tap')on=!!e.state.on;return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,on};});
const act=async(seat,words)=>{const start=Date.now(),tick=await page.evaluate(()=>window.__simEntity.depictedTick),r=await promisify(execFile)(process.execPath,['eden.mjs','act',words,'--wait','120','--json'],{cwd:scene+'/'+seat,timeout:180000}),result=JSON.parse(r.stdout);commands.push({seat,words,start,sentTick:tick,end:Date.now(),result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt?.phase,'completed',JSON.stringify(result));return result;};
const body=()=>samples.filter(Boolean).at(-1)?.bodies[0];
/** Wait (≥ minMs) until the depicted body holds a hand up in a gesture (a palm > 1.05 m above its feet; ≥ 2 s of the
 *  gesture window left), at most maxMs; records what it waited for. */
async function waitGesture(label,minMs,maxMs){await page.waitForTimeout(minMs);const t0=Date.now();while(Date.now()-t0<maxMs){const s=samples.filter(Boolean).at(-1);if(s&&s.bodies[0]){const g=gesture(s.bodies[0].id,s.tick*s.dt);const b=s.bodies[0],up=Math.max(...b.bones.arms.map(a=>a.palm[1]-b.p[1]));if(g&&g.kind!=='Idle_LookAround_Loop'&&g.left>=2&&up>1.05){marks.push({label,tick:s.tick,gesture:g,palmUp:up});return g;}}await page.waitForTimeout(100);}marks.push({label,tick:samples.at(-1)?.tick,gesture:null,timeout:true});return null;}
try{
 await post('/v1/god/env',{timeOfDay:'15:30',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+(process.env.SOUL_M04_EYE??'/?eye=-1.6,2.1,-0.6&at=2.2,0.85,5.4'));await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=1,null,{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
 writeFileSync(out+'/initial.yml',await page.locator('body').ariaSnapshot());
 viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio}));
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 // the first walk starts out of a gesture too, when one is playing within 25 s
 await waitGesture('walk-start-1',3000,40000);
 await act('ada','turn on the garden tap');
 await waitGesture('reach-out-of-gesture',3500,90000);
 await act('ada','turn off the garden tap');
 await waitGesture('walk-start-2',3500,60000);
 await act('ada',process.env.SOUL_M04_WALK??'walk to the garden deck');
 await page.waitForTimeout(6000);
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,commands,marks,samples,errors,viewport,method:'Real full client, one ordinary paired Soul CLI seat, plain words; camera fixed; samples of the drawn rig every ~50 ms.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,marks,errors}));}
