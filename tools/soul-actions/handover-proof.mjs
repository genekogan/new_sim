// Entry 41 real-client proof: a consensual hand-over between ordinary paired Soul CLI seats (Ada, Ben, and Cy) driven by
// plain words. Scenes: Ada picks up the lantern; offers it to Ben, who declines; offers it and withdraws; offers it and it
// lapses; offers it and Ben accepts (the hand-over); Ben gives it back ("take the lantern"); Cy picks up the bowl and
// gives it to Ben. The camera never touches the world: it is placed between commands from where the bodies are drawn.
// Frames are stamped with the depicted tick; samples of the drawn rig (palms, hips, walk weight, activity) and of the
// drawn and native items every ~50 ms feed handover-metrics.py. SOUL_HANDOVER_DRY=1: the same words, no browser.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {installFrameStamp} from './frame-stamp.mjs';
const scene=process.env.SOUL_HANDOVER_SCENE??'<team>/soul-actions/day-41/scene',out=process.env.SOUL_HANDOVER_OUT??'<team>/soul-actions/day-41/visual-01',port=Number(process.env.SOUL_HANDOVER_PORT??7880),base=`http://127.0.0.1:${port}/w/soul-handover`,dry=process.env.SOUL_HANDOVER_DRY==='1';mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test');
const browser=dry?null:await chromium.launch({channel:'chrome',headless:true}),ctx=dry?null:await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out+'/raw',size:{width:1440,height:1080}}}),page=dry?null:await ctx.newPage();
const videoStart=Date.now(),errors=[],samples=[],commands=[],reads=[],marks=[];page?.on('pageerror',e=>errors.push(String(e)));let timer,busy=false,pass=false,viewport=null,ids={},things={};
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'handover-proof'})})).json()).token;
const post=async(path,data)=>{const j=await(await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})).json();assert.equal(j.accepted,true,JSON.stringify(j));};
const cli=async(seat,args)=>JSON.parse((await promisify(execFile)(process.execPath,['eden.mjs',...args],{cwd:scene+'/'+seat,timeout:240000,maxBuffer:1<<24})).stdout);
const wait=ms=>dry?new Promise(r=>setTimeout(r,ms)):page.waitForTimeout(ms);
const depicted=()=>dry?null:page.evaluate(()=>window.__simEntity.depictedTick);
const mark=async(label,extra={})=>{marks.push({label,at:Date.now(),video:(Date.now()-videoStart)/1000,tick:await depicted(),...extra});writeFileSync(out+'/marks.json',JSON.stringify(marks,null,1));};
const TERMINAL=['completed','failed','cancelled','replaced'];
/** `act --wait` returns early on an invitation event (the CLI's own rule): then follow the receipt to its end. */
const settle=async(seat,r)=>{if(!r.receipt?.id||TERMINAL.includes(r.receipt.phase))return r;for(let i=0;i<600;i++){const q=await cli(seat,['receipt',r.receipt.id]);if(TERMINAL.includes(q.phase))return {...r,receipt:q};await wait(250);}return r;};
const act=(seat,words,params,expect)=>{const start=Date.now();return (async()=>{const tick=await depicted(),r=await settle(seat,await cli(seat,['act',words,...(params?[JSON.stringify(params)]:[]),'--wait','60','--json']));const c={seat,words,params,start,sentTick:tick,end:Date.now(),video:[(start-videoStart)/1000,(Date.now()-videoStart)/1000],endTick:await depicted(),result:r};commands.push(c);writeFileSync(out+'/commands.json',JSON.stringify(commands,null,1));
 if(expect==='refused')assert.equal(r.accepted,false,JSON.stringify(r));else{assert.equal(r.accepted,true,words+' '+JSON.stringify(r).slice(0,600));if(expect)assert.equal(r.receipt?.phase==='completed'?'completed':r.receipt?.code,expect,words+' '+JSON.stringify(r).slice(0,800));}return r;})();};
const read=async(seat,what='here')=>{const r=await cli(seat,[what]);reads.push({seat,what,at:Date.now(),video:(Date.now()-videoStart)/1000,tick:await depicted(),[what]:r});writeFileSync(out+'/reads.json',JSON.stringify(reads,null,1));return r;};
const offerFor=async(seat,ms=40000)=>{const t0=Date.now();while(Date.now()-t0<ms){const h=await read(seat);if(h.me?.offer)return h;await wait(400);}throw new Error('no offer reached '+seat);};
const sample=()=>page.evaluate(names=>{const api=window.__simEntity,f=api?.contactFrame();if(!f)return null;const bodies=[];for(const [id,e]of Object.entries(f.entities)){const b=f.bones?.[id];if(!b)continue;bodies.push({id,p:e.p,yaw:e.yaw,activity:e.activity,frame:api.renderer?.info?.render?.frame??null,tr:e.state?.itemTransferV1??null,held:e.state?.heldItemsV1??null,hands:e.state?.hands??null,speed:e.state?.speed??null,bones:{template:b.template,activity:b.activity,walkW:b.walkW,hipY:b.hipY,feet:b.feet,head:b.head,variety:b.variety??null,arms:b.arms.map(a=>({side:a.side,palm:a.palm,shoulder:a.shoulder,len:a.len}))}});}
 const objects=[...api.layer.model.entities.values()].filter(e=>names.includes(e.name)).map(e=>{const d=api.layer.drawn.get(e.id)?.obj;return {id:e.id,name:e.name,parent:e.in.parent,drawn:d?.position.toArray()??null,yaw:d?d.rotation.y:null,native:f.entities[e.id]?{p:f.entities[e.id].p,yaw:f.entities[e.id].yaw,support:f.entities[e.id].state?.support??null}:null};});
 return {at:Date.now(),tick:f.tick,dt:f.dt,bodies,objects,residents:api.residents().map(r=>({id:r.id,p:r.p}))};},['lantern','bowl']);
const drawn=()=>{const s=samples.at(-1);return s?Object.fromEntries(Object.entries(ids).map(([n,e])=>[n,s.bodies.find(b=>b.id===e)])):{};};
const camera=async(eye,at)=>{if(dry)return;await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});await page.waitForTimeout(300);};
const waitDrawn=async(cond,ms=30000)=>{if(dry)return true;const t0=Date.now();while(Date.now()-t0<ms){const d=drawn();if(d.ada&&d.ben&&d.cy&&cond(d))return true;await page.waitForTimeout(100);}return false;};
/** A side view of two bodies: square to the line between them, `dist` off, eye `h` up, looking at their middle at 1.0 m. */
async function side(n1,n2,dist=2.3,h=1.4,towards=[6,-6]){const d=drawn(),A=d[n1],B=d[n2];if(!A||!B)return;const m=[(A.p[0]+B.p[0])/2,(A.p[2]+B.p[2])/2],u=[B.p[0]-A.p[0],B.p[2]-A.p[2]],L=Math.hypot(...u)||1,n=[-u[1]/L,u[0]/L];
 const s=Math.sign(n[0]*(towards[0]-m[0])+n[1]*(towards[1]-m[1]))||1;await camera([m[0]+n[0]*s*dist,h,m[1]+n[1]*s*dist],[m[0],1.0,m[1]]);await mark(`camera-side-${n1}-${n2}`);}
async function wide(){const d=drawn(),ps=['ada','ben','cy'].map(n=>d[n]?.p).filter(Boolean);if(!ps.length)return;const m=[ps.reduce((a,p)=>a+p[0],0)/ps.length,ps.reduce((a,p)=>a+p[2],0)/ps.length];await camera([m[0]+5,3.4,m[1]-6.5],[m[0],0.9,m[1]]);await mark('camera-wide');}
const held=(thing,who)=>{const s=samples.at(-1),o=s?.objects.find(x=>x.name===thing);return o?.native?.support?.kind==='in-hand'&&o.native.support.by===ids[who];};
const raised=(who)=>{const b=drawn()[who];return !!b?.tr?.hold&&b.tr.holdTick===undefined&&samples.at(-1).tick>b.tr.reachTick+24;};
try{
 await post('/v1/god/env',{timeOfDay:'17:30',timeScale:0,weather:{kind:'clear'}});
 for(const s of ['ada','ben','cy'])ids[s]=(await cli(s,['here'])).me.soulId;
 if(!dry){
  await page.goto(base+'/?eye=4,4,-6&at=-1,1,3');await page.waitForFunction(()=>window.__simEntity?.contactFrame()?.bones&&Object.keys(window.__simEntity.contactFrame().bones).length>=3,null,{timeout:180000});
  await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:300000});await page.waitForTimeout(2500);await installFrameStamp(page);
  viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio}));
  timer=setInterval(async()=>{if(busy)return;busy=true;try{const s=await sample();if(s)samples.push(s);}finally{busy=false;}},50);
  await page.waitForTimeout(1500);
  {const s=samples.at(-1);for(const [n,sid] of Object.entries(ids)){const r=s.residents.find(x=>x.id===sid),b=r&&s.bodies.find(q=>Math.hypot(q.p[0]-r.p[0],q.p[2]-r.p[2])<1e-6);ids[n]=b?.id;}assert.ok(ids.ada&&ids.ben&&ids.cy,JSON.stringify(ids));}
 }
 // places: Cy to the bench (the bystander), Ben to the meadow, Ada picks up the lantern at the table
 await act('cy','walk to the bench','','completed');await act('ben','walk to the meadow','','completed');
 await wide();await wait(1200);
 await act('ada','pick up the lantern','','completed');await mark('ada-holds-lantern');await wait(1500);
 // 1) offered and declined
 const o1=act('ada','give the lantern to Ben',undefined,'invite.declined');
 await offerFor('ben');await read('cy');await read('ada');await mark('offer-1');await waitDrawn(()=>raised('ada'));await side('ada','ben');await wait(2500);
 await act('ben','decline','','completed');await o1;await mark('declined');await wait(2500);
 // 2) offered and withdrawn
 const o2=act('ada','give the lantern to Ben',undefined,'invite.withdrawn');
 await offerFor('ben');await mark('offer-2');await waitDrawn(()=>raised('ada'));await wait(2500);
 await act('ada','withdraw my offer','','completed');await o2;await mark('withdrawn');await read('ben');await wait(2500);
 // 3) offered and left unanswered: it lapses
 const o3=act('ada','give the lantern to Ben',undefined,'invite.expired');await offerFor('ben');await mark('offer-3');await o3;await mark('lapsed');await read('ben');await wait(2500);
 // 4) offered and accepted: the hand-over
 const o4=act('ada','give the lantern to Ben',undefined,'completed');await offerFor('ben');await mark('offer-4');await waitDrawn(()=>raised('ada'));await side('ada','ben',1.9,1.3);await wait(1500);
 const a4=act('ben','accept','','completed');const [g4,t4]=await Promise.all([o4,a4]);await mark('handed-over',{ada:g4.receipt?.outcome?.summary,ben:t4.receipt?.outcome?.summary});
 assert.match(g4.receipt?.outcome?.summary??'',/Gave the lantern to Ben/);assert.match(t4.receipt?.outcome?.summary??'',/Took the lantern from Ada/);
 await read('ben');await read('ada');await wait(2500);
 // 5) back to Ada, in other words
 const o5=act('ben','give the lantern to Ada',undefined,'completed');await offerFor('ada');await mark('offer-5');await waitDrawn(()=>raised('ben'));await side('ben','ada',1.9,1.3);await wait(1500);
 const a5=act('ada','take the lantern','','completed');await Promise.all([o5,a5]);await mark('handed-back');await wait(2500);
 // 6) the bowl: Cy picks it up and gives it to Ben
 await wide();const pb=act('cy','pick up the bowl','','completed');await pb;await mark('cy-holds-bowl');await wait(1000);
 const o6=act('cy','give the bowl to Ben',undefined,'completed');await offerFor('ben');await mark('offer-6');await waitDrawn(()=>raised('cy'));await side('cy','ben',1.9,1.3);await wait(1500);
 const a6=act('ben','accept','','completed');await Promise.all([o6,a6]);await mark('bowl-handed-over');await read('ben');await wait(3000);
 assert.deepEqual(errors,[]);pass=true;
}finally{clearInterval(timer);writeFileSync(out+'/proof.json',JSON.stringify({pass,ids,videoStart,commands,reads,marks,samples,errors,viewport,method:'Real full client, three ordinary paired Soul CLI seats, plain words, continuous recording; camera placed between commands only.'}));if(!dry){try{const v=page.video();await ctx.close();await v.saveAs(out+'/continuous.webm');}finally{await browser.close();}}console.log(JSON.stringify({pass,out,commands:commands.length,samples:samples.length,errors}));}
