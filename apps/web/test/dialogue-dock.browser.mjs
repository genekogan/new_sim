// Visual + behaviour check of the DLG3 dialogue (stub data, no server): the dock is closed by default (a small
// "Conversations" control); a fresh line pops up in a nearby speaker's name tag for a few seconds (a distant
// speaker only gets the dot); clicking the pop-up opens the dock on that conversation. Once open, DLG2's
// threads: one per conversation, <=3 expanded, scroll-back with "new lines", phone bottom sheet without page scroll.
// Run from the repo root: node apps/web/test/dialogue-dock.browser.mjs
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=process.cwd(),run=root+'/.e2e/runs/dialogue-dock-'+new Date().toISOString().replaceAll(':','-');mkdirSync(run,{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),{chromium}=require('@playwright/test');
const entry=`import {createRoot} from 'react-dom/client';import {useRef,useState,useEffect} from 'react';import {DialogueDock} from './DialogueDock.tsx';import {paintSpeakingDot} from './dialogue-speaking.ts';
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
function App(){const frame=useRef(null);const [edge,setEdge]=useState(base);window.__push=m=>setEdge(e=>[...e,m]);
 const state={shownTick:1e9,presentation:'live',cameraMode:'broadcast',selection:{soulId:null,entityId:null},playback:'live',loading:false,unavailableReason:null,inputScope:'viewport-pointer'};
 return <div ref={frame} className="human-world" style={{position:'relative',height:'100vh',background:'linear-gradient(#8fb08a,#4d6e4a)'}}>
  <details className="viewer-navigation" style={{position:'absolute',top:136,left:16,width:310}}><summary>Camera controls</summary></details>
  <DialogueDock root={frame} scope="w" edge={edge} talk={[]} state={state} active handle={null} nameOf={id=>({s_t:'Tamsin Quill',s_d:'His Duckness',s_m:'Moss Arden',s_i:'Ione Vale',s_b:'Bram Holt',s_p:'Pell Okafor',s_j:'Juno Reyes',s_w:'Wren Ashby'})[id]??'someone'}/><Tags/></div>;}
createRoot(document.getElementById('app')).render(<App/>);
window.__tn=tn;window.__sp=sp;window.__T=T;window.__M=M;window.__live=m=>({...m,at:Date.now()});`;
const out=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root+'/apps/web/src',loader:'tsx',sourcefile:'dock.tsx'},bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic',loader:{'.css':'css'},outdir:run+'/b',define:{'process.env.NODE_ENV':'"development"'}});
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=out.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>Buffer.from(f.contents).toString()).join('\n');
if(existsSync(root+'/.e2e/browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';const browser=await chromium.launch({headless:true});
const serve=async page=>{await page.route('**/*',r=>{const u=r.request().url();if(u.endsWith('/a.js'))return r.fulfill({contentType:'text/javascript',body:Buffer.from(js)});if(u.endsWith('/a.css'))return r.fulfill({contentType:'text/css',body:':root{--bg:#fafaf7;--fg:#1b1b18;--dim:#77776f;--line:#d8d8cf;--panel:#fff;--accent:#0b6e4f}\n'+css});return r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/a.css><body style="margin:0"><div id=app></div><script type=module src=/a.js></script>'});});await page.goto('http://127.0.0.1:4961/');await page.waitForTimeout(800);};
const summary={};
const short=await browser.newPage({viewport:{width:1440,height:900}});await serve(short);
// Closed by default: only the control, with the number of current conversations; not a viewport inset.
summary.closed=await short.evaluate(()=>{const d=document.querySelector('.dialogue-dock');return {cls:d.className,inset:d.dataset.inset,text:d.textContent,threads:document.querySelectorAll('.dlg-thread').length,h:d.getBoundingClientRect().height};});
assert.equal(summary.closed.threads,0,'no thread is shown until asked for');assert.match(summary.closed.cls,/closed/);assert.equal(summary.closed.inset,'none');
assert.match(summary.closed.text,/^Conversations4$/);assert.ok(summary.closed.h<44,'a small control');
// A fresh private line from Tamsin (near) and an aloud one from Moss (far): only Tamsin gets a pop-up.
await short.evaluate(()=>{window.__push(window.__live(window.__tn('cv1',9,window.__T,"Nine o'clock by the shore? Bring the lemon cakes and the lantern, and do not tell anyone else about it.")));window.__push(window.__live(window.__sp(window.__M,'Has anyone seen my good trowel?','commons',['s_i'])));});
await short.waitForTimeout(900);
summary.popup=await short.evaluate(()=>{const tag=id=>document.querySelector(`[data-soul-id="${id}"]`),pop=id=>tag(id).querySelector('[data-speech-popup]');
 return {tamsin:pop('s_t')&&!pop('s_t').hidden?pop('s_t').textContent:null,tamsinCls:tag('s_t').className,lines:pop('s_t')?Math.round(pop('s_t').getBoundingClientRect().height/16.75):0,w:Math.round(tag('s_t').getBoundingClientRect().width),
  moss:pop('s_m')&&!pop('s_m').hidden?pop('s_m').textContent:null,mossDot:!!tag('s_m').querySelector('[data-speaking-dot]:not([hidden])'),tamsinDot:!!tag('s_t').querySelector('[data-speaking-dot]:not([hidden])')};});
assert.match(summary.popup.tamsin??'',/^🔒 Nine o'clock by the shore\?/,'private pop-up over the near speaker');assert.match(summary.popup.tamsinCls,/dialogue-popping-private/);
assert.ok(summary.popup.lines<=2&&summary.popup.w<=232,'compact: at most two lines '+JSON.stringify(summary.popup));
assert.equal(summary.popup.moss,null,'no pop-up for a distant speaker');assert.ok(summary.popup.mossDot&&!summary.popup.tamsinDot,'distant speaker: dot only');
await short.screenshot({path:run+'/popup.png'});
// Clicking the pop-up opens the dock on that conversation (it does not select the Soul).
await short.click('[data-soul-id="s_t"] [data-speech-popup]');await short.waitForTimeout(400);
summary.opened=await short.evaluate(()=>({first:document.querySelector('.dlg-thread')?.dataset.thread,cls:document.querySelector('.dlg-thread')?.className,selected:window.__selected??null,dock:document.querySelector('.dialogue-dock').className}));
assert.equal(summary.opened.first,'c:cv1','the clicked conversation leads');assert.equal(summary.opened.selected,null);assert.doesNotMatch(summary.opened.dock,/closed/);
await short.screenshot({path:run+'/opened-from-popup.png'});
await short.click('.dialogue-dock [aria-label="Close conversations"]');await short.waitForTimeout(200);
assert.match(await short.evaluate(()=>document.querySelector('.dialogue-dock').className),/closed/,'closes again');
// After its few seconds the pop-up fades away; the dot stays a while longer and also opens the thread.
await short.waitForTimeout(6600);
summary.after=await short.evaluate(()=>({pop:!!document.querySelector('[data-soul-id="s_t"] [data-speech-popup]:not([hidden])'),dot:!!document.querySelector('[data-soul-id="s_t"] [data-speaking-dot]:not([hidden])')}));
assert.deepEqual(summary.after,{pop:false,dot:true});
await short.click('[data-soul-id="s_m"] [data-speaking-dot]');await short.waitForTimeout(300);
assert.equal(await short.evaluate(()=>document.querySelector('.dlg-thread')?.querySelector('.dlg-names')?.textContent.includes('Moss Arden')),true,'dot click opens the speaker thread');
await short.click('.dialogue-dock [aria-label="Close conversations"]');await short.waitForTimeout(200);
await short.click('.dialogue-dock .dlg-pill');await short.waitForTimeout(300);
summary.short=await short.evaluate(()=>({open:document.querySelectorAll('.dlg-thread').length,rows:document.querySelectorAll('.dlg-row').length}));
assert.deepEqual(summary.short,{open:2,rows:2},'a 900px window keeps two threads open so each stays readable');
const desk=await browser.newPage({viewport:{width:1440,height:1000}});await serve(desk);await desk.click('.dialogue-dock .dlg-pill');await desk.waitForTimeout(300);
summary.desktop=await desk.evaluate(()=>({threads:[...document.querySelectorAll('.dlg-thread')].map(t=>[t.dataset.kind,t.querySelector('.dlg-names').textContent,t.querySelectorAll('li').length]),more:document.querySelector('.dlg-more')?.textContent,rows:[...document.querySelectorAll('.dlg-row')].map(r=>r.textContent)}));
assert.equal(summary.desktop.threads.length,3,'three expanded on a tall window');
assert.equal(summary.desktop.more,undefined,'nothing older than the current threads');
assert.ok(summary.desktop.threads.some(([k,names,n])=>k==='private'&&names==='Tamsin Quill & His Duckness'&&n===8),'one private thread with all its lines');
assert.match(summary.desktop.rows[0],/^Moss Arden, Ione Vale \+1 Bram Holt: I can build/,'the oldest scene collapsed to one line');
await desk.screenshot({path:run+'/desktop.png'});
// Scroll the private thread back, then a new line arrives: it keeps the reader's place and offers a jump.
await desk.evaluate(()=>{document.querySelector('[data-thread="c:cv1"] .dlg-lines').scrollTop=0;});await desk.waitForTimeout(200);
await desk.evaluate(()=>window.__push(window.__tn('cv1',9,window.__T,"Nine o'clock by the shore?")));await desk.waitForTimeout(300);
summary.scrolled=await desk.evaluate(()=>({top:document.querySelector('[data-thread="c:cv1"] .dlg-lines').scrollTop,jump:document.querySelector('[data-thread="c:cv1"] .dlg-new')?.textContent}));
assert.equal(summary.scrolled.top,0);assert.equal(summary.scrolled.jump,'1 new line ↓');
await desk.screenshot({path:run+'/desktop-scrolled.png'});
await desk.click('[data-thread="c:cv1"] .dlg-new');await desk.waitForTimeout(200);
assert.equal(await desk.evaluate(()=>!!document.querySelector('[data-thread="c:cv1"] .dlg-new')),false);
const phone=await browser.newPage({viewport:{width:390,height:844}});await serve(phone);
summary.phone=await phone.evaluate(()=>{const r=document.querySelector('.dialogue-dock').getBoundingClientRect();return {cls:document.querySelector('.dialogue-dock').className,rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],scrollW:document.documentElement.scrollWidth};});
assert.match(summary.phone.cls,/closed/);assert.ok(summary.phone.rect[2]<80&&summary.phone.rect[3]<=44,'a small corner control '+JSON.stringify(summary.phone));assert.equal(summary.phone.scrollW,390,'no horizontal page scroll');
await phone.screenshot({path:run+'/phone.png'});
await phone.click('.dialogue-dock .dlg-pill');await phone.waitForTimeout(300);
summary.phoneOpen=await phone.evaluate(()=>({h:document.querySelector('.dialogue-dock').getBoundingClientRect().height,threads:document.querySelectorAll('.dlg-thread').length}));
assert.ok(summary.phoneOpen.h<=844*0.5,'sheet never covers the whole scene');
await phone.screenshot({path:run+'/phone-open.png'});
writeFileSync(run+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({run,summary}));await browser.close();
