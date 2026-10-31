// Entry 38 real-client proof: Ada puts up a concert poster, Ben a pottery poster; Cy is refused taking down Ada's and takes
// down Zed's out-of-date one; Ada pins a wanted note, Ben an offered note, Cy replies on Ben's and takes on Ada's; Ada is
// refused taking down Ben's; Ben reads the wall, Cy the board. Ordinary paired Soul CLI seats, plain words; camera read-only
// (moved between commands only); continuous recording; frames stamped with the depicted tick; samples of the drawn rig
// (palms vs engine hand points, walk weight, hip height, posture) every ~50 ms for posters-metrics.py.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_POSTERS_SCENE??'<team>/soul-actions/day-38/scene',out=process.env.SOUL_POSTERS_OUT??'<team>/soul-actions/day-38/visual-01',port=Number(process.env.SOUL_POSTERS_PORT??7873),base=`http://127.0.0.1:${port}/w/soul-posters`;mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test'),browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=await ctx.newPage(),videoStart=Date.now();const errors=[],samples=[],commands=[],cams=[];page.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false;
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'posters-proof'})})).json()).token;
const god=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));return j;};
const camera=async(label,eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});cams.push({label,eye,at,videoSeconds:(Date.now()-videoStart)/1000});await page.waitForTimeout(500);};
const sample=()=>page.evaluate(()=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,hands:e.hands,motion:e.state?.handActuator??null,bones:{activity:b.activity,walkW:b.walkW,hipY:b.hipY,pose:b.pose,variety:b.variety??null,arms:b.arms.map(a=>({side:a.side,palm:a.palm,target:a.target,err:a.err}))}});}const boards=[];for(const e of api.layer.model.entities.values())if(e.name==='poster-wall'||e.name==='wanted-board')boards.push({name:e.name,id:e.id,text:e.state.text??'',by:e.state.textBy??''});return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,boards};});
const run=promisify(execFile);
const act=async(seat,words,params,expect='completed')=>{const start=Date.now(),args=['eden.mjs','act',words,...(params?[JSON.stringify(params)]:[]),'--wait','150','--json'],r=await run(process.execPath,args,{cwd:scene+'/'+seat,timeout:200000}),result=JSON.parse(r.stdout);commands.push({seat,words,params,start,end:Date.now(),videoSeconds:[(start-videoStart)/1000,(Date.now()-videoStart)/1000],result});writeFileSync(out+'/commands.json',JSON.stringify(commands,null,2));
 if(expect==='refused'){assert.equal(result.accepted,false,JSON.stringify(result));await page.waitForTimeout(1500);return result;}
 assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.receipt.phase,'completed',JSON.stringify(result));await page.waitForTimeout(2200);await page.screenshot({path:out+'/'+String(commands.length).padStart(2,'0')+'.png'});return result;};
try{
 await god('/v1/god/env',{timeOfDay:'14:00',timeScale:0,weather:{kind:'clear'}});
 // Zed's jumble-sale poster went up 4 world days before today (out of date); "today" from a seat's own here line
 const here=JSON.parse((await run(process.execPath,['eden.mjs','here','--json'],{cwd:scene+'/ada',timeout:60000})).stdout),line=JSON.stringify(here),m=/world day (\d+)/.exec(line);assert.ok(m,'world day in here');const today=Number(m[1])-1;
 const snap=await(await fetch(base+'/v1/world/snapshot')).json(),wall=Object.values(snap.entities).find(e=>e.name==='poster-wall');
 await god('/v1/god/act',{ops:[{op:'set',id:wall.id,state:{text:'Jumble sale — Saturday, the old barn (Zed)',textBy:JSON.stringify([{s:0,t:'Jumble sale',d:'Saturday, the old barn',by:'s_zed',n:'Zed',day:today-4}])}}]});
 await page.goto(base+'/?eye=-0.2,1.75,1.4&at=-1.2,1.35,4');await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=3,null,{timeout:240000});await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(3000);await installFrameStamp(page);
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
 const WALL=[[0.6,1.65,1.75],[-1.5,1.4,4]],WALL_L=[[-3.9,1.65,1.9],[-1.9,1.4,4]],BOARD=[[3.9,1.6,2.0],[2.0,1.4,4]];
 await camera('wall',...WALL);await page.waitForTimeout(1500);
 await act('ada','put up a poster for the concert at the bandstand tonight',{title:'Concert at the bandstand',detail:'Tonight at 8 · bring a blanket'});
 await camera('wall-left',...WALL_L);await page.waitForTimeout(800);
 await act('ben','put up a poster on the poster wall',{title:'Pottery class',detail:'Saturday 10:00 at the studio'});
 await camera('wall',...WALL);await page.waitForTimeout(800);
 const refused=await act('cy','take down Ada\'s poster from the poster wall',{which:'concert'},'refused');
 await act('cy','take down the old poster from the poster wall',{which:'jumble'});
 await camera('board',...BOARD);await page.waitForTimeout(800);
 await act('ada','pin a wanted note on the wanted board',{text:'Wanted: help carrying chairs to the bandstand'});
 await act('ben','pin an offered note on the wanted board',{text:'Offered: spare blankets for the concert'});
 await act('cy','reply to Ben\'s note on the wanted board',{note:'blankets',text:'Two please!'});
 await act('cy','take on Ada\'s wanted note',{note:'chairs'});
 const notYours=await act('ada','take down Ben\'s note from the wanted board',{note:'blankets'},'refused');
 const readWall=await act('ben','read the poster wall'),readBoard=await act('cy','read the wanted board');
 for(const [n,cam] of [['wall',[[-1.7,1.5,1.9],[-1.7,1.42,4]]],['wall-concert',[[-1.4,1.48,2.75],[-1.4,1.45,4]]],['board',[[2.0,1.5,2.35],[2.0,1.42,4]]]]){await camera('close-'+n,...cam);await page.waitForTimeout(3000);await page.screenshot({path:out+`/close-${n}.png`});}
 assert.deepEqual(errors,[]);
 // nothing changes on a board before the depicted end of its stroke
 const early=[];for(const s of samples)for(const b of s.bodies){const m=b.motion;if(!m?.stroke)continue;const t=(s.tick-m.startTick)*s.dt,board=s.boards.find(x=>x.id===m.target),before=samples.filter(p=>p.tick<m.startTick).at(-1)?.boards.find(x=>x.id===m.target)?.by;if(board&&before!==undefined&&t<.65+m.stroke.seconds-.06&&board.by!==before)early.push({tick:s.tick,t,id:board.id});}
 assert.deepEqual(early,[],'boards change only at the depicted stroke end');
 const last=samples.at(-1).boards,final=Object.fromEntries(last.map(x=>[x.name,x.text]));
 writeFileSync(out+'/checks.json',JSON.stringify({pass:true,today,final,refused:{code:refused.code,reason:refused.reason},notYours:{code:notYours.code,reason:notYours.reason},reads:{wall:readWall.done??readWall.receipt?.outcome?.summary??null,board:readBoard.done??readBoard.receipt?.outcome?.summary??null},earlySamples:early.length,samples:samples.length},null,2));pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,videoStart,commands,cams,samples,errors,method:'Real full client, three ordinary paired Soul CLI seats (Ada, Ben, Cy), plain words, continuous recording; camera read-only, moved between commands only.'}));try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
