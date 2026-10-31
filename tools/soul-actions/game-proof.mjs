// Entry 27 real-client proof: Ada and Ben play noughts and crosses by hand; Ada tries to play out of turn and Cy tries to join
// (both refused on camera); Ada wins; Cy reads the board, wipes it and starts a new game.
// Ordinary paired Soul CLI seats; camera read-only; continuous recording; frames stamped with the depicted tick.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_GAME_SCENE??'<team>/soul-actions/day-27/scene',out=process.env.SOUL_GAME_OUT??'<team>/soul-actions/day-27/visual-01',base='http://127.0.0.1:7869/w/soul-game';mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage(),videoStart=Date.now();const errors=[],samples=[],commands=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'game-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const camera=async(eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});await page.waitForTimeout(400);};
const sample=()=>page.evaluate(()=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,hands:e.hands,motion:e.state.handActuator,arms:b.arms});}const boards=[];for(const e of api.layer.model.entities.values())if(['game'].includes(e.name))boards.push({name:e.name,id:e.id,text:e.state.text??'',by:e.state.textBy??''});return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,boards};});
const act=async(seat,words,params,expect='completed')=>{const start=Date.now(),args=['eden.mjs','act',words,...(params?[JSON.stringify(params)]:[]),'--wait','--json'],r=await promisify(execFile)(process.execPath,args,{cwd:scene+'/'+seat,timeout:180000}),result=JSON.parse(r.stdout);commands.push({seat,words,params,start,end:Date.now(),videoSeconds:[(start-videoStart)/1000,(Date.now()-videoStart)/1000],result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));
 if(expect==='refused'){assert.equal(result.accepted,false,JSON.stringify(result));return result;}
 assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt.phase,'completed',JSON.stringify(result));await page.waitForTimeout(2200);await page.screenshot({path:out+'/'+String(commands.length).padStart(2,'0')+'.png'});return result;};
try{
 await post('/v1/god/env',{timeOfDay:'14:00',timeScale:0,weather:{kind:'clear'}});
 await page.goto(base+'/?eye=-1.55,1.55,1.35&at=0,1.2,4');await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=3,null,{timeout:120000});await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(3000);await installFrameStamp(page);
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 const WIDE=[[-1.55,1.55,1.35],[0,1.2,4]],CLOSE=[[0.15,1.35,2.85],[0,1.25,4]];
 await camera(...WIDE);await page.waitForTimeout(1500);
 const M=(seat,square,expect)=>act(seat,'mark a square on the game board',{square},expect);
 await M('ada','centre');
 const early1=await M('ada','top right','refused');
 await M('ben','top left');
 const third=await M('cy','bottom right','refused');
 await M('ada','top right');await M('ben','middle left');await M('ada','bottom left');
 const over=await M('ben','bottom right','refused');
 await camera(...CLOSE);await page.waitForTimeout(3500);await page.screenshot({path:out+'/close-won.png'});
 await camera(...WIDE);await page.waitForTimeout(800);
 const read=await act('cy','read the game board');
 await act('cy','wipe the game board for a new game');
 await M('cy','5');
 await camera(...CLOSE);await page.waitForTimeout(3000);await page.screenshot({path:out+'/close-new.png'});
 assert.deepEqual(errors,[]);
 // a note appears (or comes down) only at the depicted stroke end
 const early=[];for(const s of samples)for(const b of s.bodies){const m=b.motion;if(!m?.stroke)continue;const t=(s.tick-m.startTick)*s.dt,board=s.boards.find(x=>x.id===m.target),before=samples.filter(p=>p.tick<m.startTick).at(-1)?.boards.find(x=>x.id===m.target)?.text;if(board&&before!==undefined&&t<.65+m.stroke.seconds-.06&&board.text!==before)early.push({tick:s.tick,t,text:board.text});}
 assert.deepEqual(early,[],'notes change only at the depicted stroke end');
 const final=samples.at(-1).boards.find(x=>x.name==='game')?.text;assert.equal(final,'....X....');
 writeFileSync(out+'/checks.json',JSON.stringify({pass:true,final,refusals:[early1.reason,third.reason,over.reason],readDone:read.done??read.receipt,earlySamples:early.length,samples:samples.length},null,2));pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,videoStart,commands,samples,errors,method:'Real full client, three ordinary paired Soul CLI seats, continuous recording; camera read-only, moved between commands only.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
