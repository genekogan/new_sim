// Entry 19 real-client proof: Ada, Ben and Cy pin signed notes on one pinboard by hand; Ben takes his own down; Ben reads the rest.
// Ordinary paired Soul CLI seats; camera read-only; continuous recording; frames stamped with the depicted tick.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_NOTES_SCENE??'<team>/soul-actions/day-19/scene',out=process.env.SOUL_NOTES_OUT??'<team>/soul-actions/day-19/visual-01',base='http://127.0.0.1:7861/w/soul-notes';mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage(),videoStart=Date.now();const errors=[],samples=[],commands=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'notes-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});await page.waitForTimeout(400);};
const sample=()=>page.evaluate(()=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,hands:e.hands,motion:e.state.handActuator,arms:b.arms});}const boards=[];for(const e of api.layer.model.entities.values())if(['pinboard','notice-board'].includes(e.name))boards.push({name:e.name,id:e.id,text:e.state.text??''});return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,boards};});
const act=async(seat,words,params,expect='completed')=>{const start=Date.now(),args=['eden.mjs','act',words,...(params?[JSON.stringify(params)]:[]),'--wait','--json'],r=await promisify(execFile)(process.execPath,args,{cwd:scene+'/'+seat,timeout:180000}),result=JSON.parse(r.stdout);commands.push({seat,words,params,start,end:Date.now(),videoSeconds:[(start-videoStart)/1000,(Date.now()-videoStart)/1000],result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));
 if(expect==='refused'){assert.equal(result.accepted,false,JSON.stringify(result));return result;}
 assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt.phase,'completed',JSON.stringify(result));await page.waitForTimeout(2200);await page.screenshot({path:out+'/'+String(commands.length).padStart(2,'0')+'.png'});return result;};
try{
 await post('/v1/god/env',{timeOfDay:'14:00',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+'/?eye=-1.6,1.75,1.7&at=0,1.35,3.95');await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=3,null,{timeout:120000});await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(3000);await installFrameStamp(page);
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 await camera([-1.6,1.75,1.7],[0,1.35,3.95]);await page.waitForTimeout(1500);
 await act('ada','pin a note on the pinboard',{text:'Picnic at noon by the pond'});
 await act('ben','pin a note on the pinboard',{text:'Lost: a blue scarf, near the well'});
 await act('cy','pin a note on the pinboard',{text:'Choir practice at dusk, all welcome'});
 await act('ada','pin a note on the pinboard',{text:'Bring fruit if you can'});
 await act('ben','take down my note from the pinboard');
 const again=await act('ben','take down my note from the pinboard',undefined,'refused');
 const read=await act('cy','read the pinboard');
 await camera([0.1,1.45,2.75],[0,1.35,3.95]);await page.waitForTimeout(4000);await page.screenshot({path:out+'/close.png'});
 assert.deepEqual(errors,[]);
 // a note appears (or comes down) only at the depicted stroke end
 const early=[];for(const s of samples)for(const b of s.bodies){const m=b.motion;if(!m?.stroke)continue;const t=(s.tick-m.startTick)*s.dt,board=s.boards.find(x=>x.id===m.target),before=samples.filter(p=>p.tick<m.startTick).at(-1)?.boards.find(x=>x.id===m.target)?.text;if(board&&before!==undefined&&t<.65+m.stroke.seconds-.06&&board.text!==before)early.push({tick:s.tick,t,text:board.text});}
 assert.deepEqual(early,[],'notes change only at the depicted stroke end');
 const final=samples.at(-1).boards.find(b=>b.name==='pinboard').text.split('\n');
 assert.deepEqual(final,['Picnic at noon by the pond — Ada','Choir practice at dusk, all welcome — Cy','Bring fruit if you can — Ada']);
 writeFileSync(out+'/checks.json',JSON.stringify({pass:true,final,refusedAgain:{code:again.code,reason:again.reason},readDone:read.done??read.receipt,earlySamples:early.length,samples:samples.length},null,2));pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,videoStart,commands,samples,errors,method:'Real full client, three ordinary paired Soul CLI seats, continuous recording; camera read-only, moved between commands only.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
