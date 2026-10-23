// Visual + behaviour check of the dialogue UI (stub data, no server), to Gene's 10-08 spec (CONV-UI): there is no public
// conversation list (nothing shows until asked for); a fresh line pops up in a nearby speaker's name tag (a distant
// speaker only gets the dot) and clicking it opens that one thread; the selected Soul's card holds its own threads
// (newest expanded, older ones one line each); a zoomed-in marker over a talking group opens its thread and frames
// the speakers. Run from the repo root: node apps/web/test/dialogue-dock.browser.mjs
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=process.cwd(),run=root+'/.e2e/runs/dialogue-dock-'+new Date().toISOString().replaceAll(':','-');mkdirSync(run,{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),{chromium}=require('@playwright/test');
const entry=`import {createRoot} from 'react-dom/client';import {useRef,useState,useEffect} from 'react';import {DialogueDock} from './DialogueDock.tsx';import {paintSpeakingDot,requestSoulConversations} from './dialogue-speaking.ts';
const ref=(soulId,name)=>({soulId,name});const T=ref('s_t','Tamsin Quill'),D=ref('s_d','His Duckness'),M=ref('s_m','Moss Arden'),I=ref('s_i','Ione Vale'),B=ref('s_b','Bram Holt'),P=ref('s_p','Pell Okafor'),J=ref('s_j','Juno Reyes'),W=ref('s_w','Wren Ashby');
const now=Date.now();let tick=1000,n=0;
const sp=(from,text,place,heardBy=[])=>({type:'edge',kind:'speech',tick:++tick,at:now-60000+(++n)*1000,id:'sp'+n,from,channel:{kind:'earshot',placeId:place,radius:12},text,heardBy});
const tn=(cv,seq,from,text)=>({type:'edge',kind:'conversation.turn',tick:++tick,at:now-60000+(++n)*1000,conversation:cv,turn:{seq,from,text}});
const base=[sp(M,'Has anyone seen where the bees went?','commons',['s_i','s_b']),sp(I,'Over by the pergola, near the lavender.','commons',['s_m','s_b']),sp(B,'I can build them a better hive.','commons',['s_m','s_i','s_p']),
 {type:'edge',kind:'conversation.start',tick:++tick,at:now-50000,conversation:'cv1',from:T,invited:[D]},
 ...['Can I ask you something quietly?','Of course.','A night swim, do you think?','Only if there are snacks.','Lemon cakes, then.','I decree it: a swim at moonrise.','Do not tell Moss yet.','My beak is sealed.'].map((t,i)=>tn('cv1',i+1,i%2?D:T,t)),
 sp(P,'Who wants the heel of the bread?','commons-kitchen',['s_j']),sp(J,'Me, with butter.','commons-kitchen',['s_p']),
 {type:'edge',kind:'conversation.start',tick:++tick,at:now-20000,conversation:'cv2',from:W,invited:[M]},tn('cv2',1,W,'Can I borrow your lantern?'),tn('cv2',2,M,'Bring it back before the bees wake.')];
window.__push=null;
// Name tags as LiveWorld paints them (same inline style), repainted at its 4 Hz label cadence; Moss is far away.
const tags=[['s_t','Tamsin Quill',520,420,14],['s_d','His Duckness',660,430,15],['s_m','Moss Arden',900,300,120]];
function Tags(){useEffect(()=>{const els=tags.map(([id,name,x,y,dist])=>{const el=document.createElement('div');
  el.style.cssText='position:absolute;transform:translate(-50%,-100%);font:11px/1.25 system-ui,sans-serif;color:#fff;background:rgba(18,20,18,.66);padding:2px 7px 3px;border-radius:5px;text-align:center;white-space:nowrap;pointer-events:auto;cursor:pointer;max-width:260px';
  el.style.left=(x/14.4)+'vw';el.style.top=y+'px';el.dataset.soulId=id;const b=document.createElement('b');b.textContent=name;el.append(b);el.addEventListener('click',()=>{window.__selected=id;});document.body.append(el);return [el,id,dist];});
  const t=setInterval(()=>{for(const [el,id,dist] of els)paintSpeakingDot(el,id,true,performance.now(),dist);},250);return()=>clearInterval(t);},[]);return null;}
function App(){const frame=useRef(null);const [edge,setEdge]=useState(base);const [sel,setSel]=useState(null);const [card,setCard]=useState(null);const [anchors,setAnchors]=useState([]);
 window.__push=m=>setEdge(e=>[...e,m]);window.__sel=setSel;window.__card=setCard;window.__anchors=setAnchors;const handle={frameSouls:ids=>{window.__framed=ids;}};
 const state={shownTick:1e9,presentation:'live',cameraMode:'broadcast',selection:{soulId:sel,entityId:null},speechAnchors:anchors,playback:'live',loading:false,unavailableReason:null,inputScope:'viewport-pointer'};
 return <div ref={frame} className="human-world" style={{position:'relative',height:'100vh',background:'linear-gradient(#8fb08a,#4d6e4a)'}}>
  <details className="viewer-navigation" style={{position:'absolute',top:136,left:16,width:310}}><summary>Camera controls</summary></details>
  <DialogueDock root={frame} scope="w" edge={edge} talk={[]} state={state} active handle={handle} nameOf={id=>({s_t:'Tamsin Quill',s_d:'His Duckness',s_m:'Moss Arden',s_i:'Ione Vale',s_b:'Bram Holt',s_p:'Pell Okafor',s_j:'Juno Reyes',s_w:'Wren Ashby'})[id]??'someone'}/><Tags/>
  {card&&<aside className="soul-card" style={{position:'absolute',right:16,top:16,width:'min(320px,calc(100vw - 32px))',background:'#fff',padding:12,borderRadius:10}}><h3>{card}</h3><div className="soul-card-thread" data-soul-thread={card}/></aside>}</div>;}
createRoot(document.getElementById('app')).render(<App/>);
window.__tn=tn;window.__sp=sp;window.__T=T;window.__M=M;window.__live=m=>({...m,at:Date.now()});window.__W=W;window.__soul=requestSoulConversations;`;
const out=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root+'/apps/web/src',loader:'tsx',sourcefile:'dock.tsx'},bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic',loader:{'.css':'css'},outdir:run+'/b',define:{'process.env.NODE_ENV':'"development"'}});
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=out.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>Buffer.from(f.contents).toString()).join('\n');
if(existsSync(root+'/.e2e/browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';const browser=await chromium.launch({headless:true});
const serve=async page=>{await page.route('**/*',r=>{const u=r.request().url();if(u.endsWith('/a.js'))return r.fulfill({contentType:'text/javascript',body:Buffer.from(js)});if(u.endsWith('/a.css'))return r.fulfill({contentType:'text/css',body:':root{--bg:#fafaf7;--fg:#1b1b18;--dim:#77776f;--line:#d8d8cf;--panel:#fff;--accent:#0b6e4f}\n'+css});return r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/a.css><body style="margin:0"><div id=app></div><script type=module src=/a.js></script>'});});await page.goto('http://127.0.0.1:4961/');await page.waitForTimeout(800);};
const summary={};
const short=await browser.newPage({viewport:{width:1440,height:900}});await serve(short);
// No public list: nothing but the name tags until a Soul, a pop-up or a marker asks for a thread.
summary.idle=await short.evaluate(()=>({dock:document.querySelectorAll('.dialogue-dock').length,threads:document.querySelectorAll('.dlg-thread,.dlg-row').length,markers:document.querySelectorAll('.conversation-marker').length,pill:!!document.querySelector('.dlg-pill')}));
assert.deepEqual(summary.idle,{dock:0,threads:0,markers:0,pill:false},'no public conversation list');

// A fresh private line from Tamsin (near) and an aloud one from Moss (far): only Tamsin gets a pop-up.
await short.evaluate(()=>{window.__push(window.__live(window.__tn('cv1',9,window.__T,"Nine o'clock by the shore? Bring the lemon cakes and the lantern, and do not tell anyone else about it.")));window.__push(window.__live(window.__sp(window.__M,'Has anyone seen my good trowel?','commons',['s_i'])));});
await short.waitForTimeout(900);
summary.popup=await short.evaluate(()=>{const tag=id=>document.querySelector(`[data-soul-id="${id}"]`),pop=id=>tag(id).querySelector('[data-speech-popup]');
 return {tamsin:pop('s_t')&&!pop('s_t').hidden?pop('s_t').textContent:null,tamsinCls:tag('s_t').className,lines:pop('s_t')?Math.round(pop('s_t').getBoundingClientRect().height/16.75):0,w:Math.round(tag('s_t').getBoundingClientRect().width),
  moss:pop('s_m')&&!pop('s_m').hidden?pop('s_m').textContent:null,mossDot:!!tag('s_m').querySelector('[data-speaking-dot]:not([hidden])'),tamsinDot:!!tag('s_t').querySelector('[data-speaking-dot]:not([hidden])')};});
assert.match(summary.popup.tamsin??'',/^🔒 Nine o'clock by the shore\?/,'private pop-up over the near speaker');assert.match(summary.popup.tamsinCls,/dialogue-popping-private/);
assert.ok(summary.popup.lines<=2&&summary.popup.w<=232,'compact: at most two lines '+JSON.stringify(summary.popup));
assert.equal(summary.popup.moss,null,'no pop-up for a distant speaker');assert.ok(summary.popup.mossDot&&!summary.popup.tamsinDot,'distant speaker: dot only');
// Clicking the pop-up opens just that conversation in a small floating dock (no card on screen); it does not select the Soul.
await short.click('[data-soul-id="s_t"] [data-speech-popup]');await short.waitForTimeout(300);
summary.opened=await short.evaluate(()=>({threads:[...document.querySelectorAll('.dlg-thread')].map(t=>t.dataset.thread),selected:window.__selected??null,head:document.querySelector('.dialogue-dock .dlg-dock-head')?.textContent}));
assert.deepEqual(summary.opened.threads,['c:cv1'],'only the clicked conversation');assert.equal(summary.opened.selected,null);assert.match(summary.opened.head??'',/^Live conversation/);
await short.screenshot({path:run+'/popup-thread.png'});
await short.click('.dialogue-dock [aria-label="Close conversation"]');await short.waitForTimeout(200);
assert.equal(await short.evaluate(()=>document.querySelectorAll('.dialogue-dock').length),0,'closes again');
// Selecting a Soul whose card is on screen: its own threads render inside the card, never a floating dock.
await short.evaluate(()=>{window.__sel('s_m');window.__card('s_m');});await short.waitForTimeout(300);
const inCard=page=>page.evaluate(()=>{const c=document.querySelector('.soul-card .soul-card-thread');return {expanded:[...c.querySelectorAll('.dlg-thread')].map(t=>t.dataset.thread),rows:c.querySelectorAll('.dlg-row').length,names:[...c.querySelectorAll('.dlg-thread .dlg-names, .dlg-row')].map(e=>e.textContent),floating:document.querySelectorAll('.dialogue-dock.contextual').length};});
summary.mossCard=await inCard(short);
assert.equal(summary.mossCard.expanded.length,1,'one thread expanded '+JSON.stringify(summary.mossCard));assert.ok(summary.mossCard.rows>=1&&summary.mossCard.rows<=2,'older threads one line each');
assert.ok(summary.mossCard.names.every(t=>t.includes('Moss')),'only threads Moss is in');assert.equal(summary.mossCard.floating,0,'no floating dock beside the card');
await short.click('.soul-card .dlg-row');await short.waitForTimeout(200);
summary.mossSwap=await inCard(short);assert.notDeepEqual(summary.mossSwap.expanded,summary.mossCard.expanded,'a one-liner expands on click');
await short.screenshot({path:run+'/card.png'});
// Selection without a card on screen opens nothing; asking for the Soul's conversations (My Souls) uses the fallback dock.
await short.evaluate(()=>window.__card(null));await short.waitForTimeout(200);
assert.equal(await short.evaluate(()=>document.querySelectorAll('.dlg-thread,.dlg-row').length),0,'selection alone shows no list');
await short.evaluate(()=>window.__soul('s_m'));await short.waitForTimeout(200);
summary.fallback=await short.evaluate(()=>({head:document.querySelector('.dialogue-dock.contextual .dlg-dock-head')?.textContent,threads:document.querySelectorAll('.dialogue-dock.contextual .dlg-thread').length}));
assert.match(summary.fallback.head??'',/^Moss Arden · conversations/);assert.ok(summary.fallback.threads>=2);
await short.click('.dialogue-dock [aria-label="Close conversation"]');await short.evaluate(()=>window.__sel(null));await short.waitForTimeout(200);
// A marker over a talking group appears only when its speakers are close (zoomed in); clicking it frames them and opens the thread.
await short.evaluate(()=>{window.__push(window.__live(window.__tn('cv2',3,window.__W,'I will, I promise.')));window.__anchors([{soulId:'s_w',x:700,y:500,distance:60,visible:true},{soulId:'s_m',x:780,y:510,distance:62,visible:true}]);});await short.waitForTimeout(300);
summary.markerFar=await short.evaluate(()=>document.querySelectorAll('.conversation-marker').length);assert.equal(summary.markerFar,0,'no marker when zoomed out');
await short.evaluate(()=>window.__anchors([{soulId:'s_w',x:700,y:500,distance:14,visible:true},{soulId:'s_m',x:780,y:510,distance:15,visible:true}]));await short.waitForTimeout(300);
summary.marker=await short.evaluate(()=>{const m=[...document.querySelectorAll('.conversation-marker')];const r=m[0]?.getBoundingClientRect();return {n:m.length,label:m[0]?.getAttribute('aria-label'),x:r&&Math.round(r.left+r.width/2),bottom:r&&Math.round(r.bottom)};});
assert.equal(summary.marker.n,1,'one marker over the talking pair');assert.match(summary.marker.label,/Wren Ashby & Moss Arden|Moss Arden & Wren Ashby/);assert.ok(Math.abs(summary.marker.x-740)<=4&&summary.marker.bottom<=500,'above the pair '+JSON.stringify(summary.marker));
await short.evaluate(()=>{window.__sel('s_m');window.__card('s_m');});await short.waitForTimeout(200);
await short.click('.conversation-marker');await short.waitForTimeout(300);
summary.markerOpen={framed:await short.evaluate(()=>window.__framed),...await inCard(short)};
assert.deepEqual([...summary.markerOpen.framed].sort(),['s_m','s_w'],'frames the speakers');assert.deepEqual(summary.markerOpen.expanded,['c:cv2'],'the marker thread leads in the card');assert.equal(summary.markerOpen.floating,0);
await short.screenshot({path:run+'/marker-card.png'});
// Phone width: the card thread and the fallback dock fit with no horizontal scroll.
const phone=await browser.newPage({viewport:{width:390,height:844}});await serve(phone);
await phone.evaluate(()=>{window.__sel('s_m');window.__card('s_m');});await phone.waitForTimeout(300);
summary.phone={...await inCard(phone),scrollW:await phone.evaluate(()=>document.documentElement.scrollWidth)};
assert.equal(summary.phone.expanded.length,1);assert.equal(summary.phone.scrollW,390,'no horizontal page scroll');
await phone.screenshot({path:run+'/phone-card.png'});
await phone.evaluate(()=>{window.__card(null);window.__soul('s_m');});await phone.waitForTimeout(300);
summary.phoneDock=await phone.evaluate(()=>({h:Math.round(document.querySelector('.dialogue-dock.contextual').getBoundingClientRect().height),scrollW:document.documentElement.scrollWidth}));
assert.ok(summary.phoneDock.h<=844*0.6,'fallback dock never covers the whole scene '+JSON.stringify(summary.phoneDock));assert.equal(summary.phoneDock.scrollW,390);
writeFileSync(run+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({run,summary}));await browser.close();
