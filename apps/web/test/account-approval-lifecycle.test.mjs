// Actual component (New Soul, BringAgent) rendered through React's installed hook dispatcher. (Lane LAP: the older
// worlds' AccountApproval view is gone; every world shows god-ui/ApprovalDialog.tsx.) The
// deterministic effect lifecycle reproduces StrictMode cleanup/setup without
// a browser, provider, DOM package, network, or a product service.
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const sourceDir=fileURLToPath(new URL('../src/',import.meta.url));
const temp=mkdtempSync(fileURLToPath(new URL('../.approval-component-fixture-',import.meta.url)));
const bringPath=join(temp,'bring-agent.mjs'),bringBuilt=await build({entryPoints:[join(sourceDir,'BringAgent.tsx')],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});writeFileSync(bringPath,bringBuilt.outputFiles[0].text);const {BringAgent}=await import(pathToFileURL(bringPath));
const cardPath=join(temp,'approval-card.mjs'),cardBuilt=await build({stdin:{contents:"export {ApprovalCard} from './god-ui/ApprovalDialog.tsx';export {publishSession} from './auth-session.ts';",resolveDir:sourceDir,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});writeFileSync(cardPath,cardBuilt.outputFiles[0].text);const {ApprovalCard,publishSession}=await import(pathToFileURL(cardPath));
process.once('exit',()=>rmSync(temp,{recursive:true,force:true}));
function mounted(props,Component){const values=[],effects=[];let index=0,element;
 const internal=React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
 const dispatcher={useRef(value){const i=index++;return values[i]??=( {current:value});},useState(value){const i=index++;if(!values[i])values[i]={value:typeof value==='function'?value():value};return [values[i].value,next=>{values[i].value=typeof next==='function'?next(values[i].value):next;}];},useCallback(fn,deps){const i=index++;const o=values[i];if(!o||deps.some((v,n)=>v!==o.deps[n]))values[i]={fn,deps};return values[i].fn;},useEffect(create,deps){const i=index++;const old=effects[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects[i]={create,deps,dirty:true,cleanup:old?.cleanup};}};
 const render=()=>{index=0;const old=internal.H;internal.H=dispatcher;try{element=Component(props);}finally{internal.H=old;}return element;};
 const setup=()=>{for(const e of effects)if(e?.dirty){e.cleanup?.();e.cleanup=e.create();e.dirty=false;}};
 const replay=()=>{for(const e of effects)e?.cleanup?.();for(const e of effects)if(e)e.cleanup=e.create();};
 const close=()=>{for(const e of effects)e?.cleanup?.();};render();setup();return {render,setup,replay,close};
}
function buttons(tree,out=[]){if(!tree||typeof tree!=='object')return out;if(tree.type==='button')out.push(tree);const c=tree.$$typeof===Symbol.for('react.portal')?tree.children:tree.props?.children;for(const value of Array.isArray(c)?c:[c])if(Array.isArray(value))value.forEach(x=>buttons(x,out));else buttons(value,out);return out;}
function withProp(tree,name){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const x of tree){const f=withProp(x,name);if(f)return f;}return null;}if(tree.props&&typeof tree.props[name]==='function')return tree;return withProp(tree.$$typeof===Symbol.for('react.portal')?tree.children:tree.props?.children,name);}
const portalDocument=()=>({body:{nodeType:1},activeElement:null,querySelector(){return null;}});
test('actual New Soul component gates signed-out UI, resumes after login/reload only in its world and copies a plain raw URL',async()=>{
 const names=['location','history','sessionStorage','addEventListener','removeEventListener','navigator','document'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)])),store=new Map(),copied=[];let logins=0;
 const loc={origin:'http://fixture',pathname:'/w/eden',search:'',hash:''};for(const [name,value]of Object.entries({location:loc,history:{replaceState(_a,_b,url){loc.hash=new URL(url,loc.origin).hash;}},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},addEventListener(){},removeEventListener(){},navigator:{clipboard:{writeText:async text=>copied.push(text)}},document:portalDocument()}))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 try{const signedOut=mounted({requireAuth:true,auth:{ready:true,authed:false,login:()=>logins++}},BringAgent);buttons(signedOut.render()).find(b=>b.props.className==='bring-agent-open').props.onClick();assert.equal(logins,0,'QA2 F8: the first click explains before sign-in');const explain=withProp(signedOut.render(),'onSignIn');assert.ok(explain,'signed-out New Soul shows the sign-in explanation');explain.props.onSignIn();assert.equal(logins,1);assert.equal(buttons(signedOut.render()).some(b=>b.props.children==='Copy prompt'),false);signedOut.close();loc.hash='';loc.pathname='/w/mars';const otherWorld=mounted({requireAuth:true,auth:{ready:true,authed:true,login(){}}},BringAgent);assert.equal(buttons(otherWorld.render()).some(b=>b.props.children==='Copy prompt'),false);otherWorld.close();loc.pathname='/w/eden';const resumed=mounted({requireAuth:true,auth:{ready:true,authed:true,login(){}}},BringAgent);const copy=buttons(resumed.render()).find(b=>b.props.children==='Copy prompt');assert.ok(copy,'login reload must resume same-world onboarding');await copy.props.onClick();await Promise.resolve();assert.equal(copied[0],'Read the instructions at http://fixture/w/eden/instructions.md to create a new soul in the world Eden.');buttons(resumed.render()).find(b=>b.props['aria-label']==='Close').props.onClick();assert.equal(buttons(resumed.render()).some(b=>b.props.children==='Copy prompt'),false);resumed.close();assert.equal(store.size,0);
 }finally{for(const name of names){const d=old.get(name);if(d)Object.defineProperty(globalThis,name,d);else delete globalThis[name];}}
});
test('auth-off legacy world opens ordinary instructions without invoking unconfigured sign-in',()=>{
 const names=['location','history','sessionStorage','addEventListener','removeEventListener','document'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));let logins=0;
 for(const [name,value]of Object.entries({location:{origin:'http://fixture',pathname:'/w/mars',search:'',hash:''},history:{replaceState(){}},sessionStorage:{getItem(){return null;},removeItem(){},setItem(){}},addEventListener(){},removeEventListener(){},document:portalDocument()}))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 try{const m=mounted({requireAuth:false,auth:{ready:true,authed:false,login:()=>logins++}},BringAgent);buttons(m.render()).find(b=>b.props.className==='bring-agent-open').props.onClick();assert.equal(logins,0);assert.ok(buttons(m.render()).some(b=>b.props.children==='Copy prompt'));m.close();}finally{for(const name of names){const d=old.get(name);if(d)Object.defineProperty(globalThis,name,d);else delete globalThis[name];}}
});

// Lane LAP (2026-10-21): the older worlds' AccountApproval view is gone; every world shows god-ui/ApprovalDialog.tsx's card.
// These keep the release gate's test ids from that view: the same contracts, held by the card (ApprovalCard) as rendered.
const id='ap_'+'a'.repeat(32),dto={id,worldId:'w',name:'Avery',description:'',agentLabel:'Fixture agent',mode:'create',status:'pending',soulId:null,expiresAt:100000};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=()=>new Promise(r=>setImmediate(r));
const answer=(data,status=200)=>({ok:status<300,status,json:async()=>data});
const said=(approval,world='w')=>answer({approval,world:{id:world}});
// the page's sign-in, the world's answers (one per call, in order) and the window the camera's follow request goes to
function card({replies,signedIn=true}){
 const calls=[],follows=[],old={fetch:globalThis.fetch,window:Object.getOwnPropertyDescriptor(globalThis,'window')};let done=0;
 publishSession({mode:'clerk',ready:true,authed:signedIn,label:'Fixture account',getToken:async()=>signedIn?'fixture-token':null,login(){},logout(){}});
 globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),method:init.method??'GET'});const next=replies.shift();return typeof next==='function'?next():next;};
 const win=new EventTarget();win.addEventListener('sim:follow-soul',e=>follows.push(e.detail.soulId));Object.defineProperty(globalThis,'window',{value:win,configurable:true,writable:true});
 const m=mounted({id,signedIn,onDone:()=>done++},ApprovalCard);
 const restore=()=>{m.close();globalThis.fetch=old.fetch;if(old.window)Object.defineProperty(globalThis,'window',old.window);else delete globalThis.window;};
 return {m,calls,follows,done:()=>done,restore,btn:attr=>buttons(m.render()).find(b=>b.props[attr]!==undefined)};
}
const text=tree=>{if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return text(tree.props?.children);};
test('StrictMode effect replay recovers a fresh read; stale finally cannot release newer inflight or leave busy forever',async()=>{
 const first=deferred(),second=deferred(),refuse=deferred(),stale=deferred();
 const c=card({replies:[()=>first.promise,()=>second.promise,()=>refuse.promise,()=>stale.promise]});
 try{
  await flush();c.m.replay();await flush();assert.equal(c.calls.length,2,'the replayed effect starts its own fresh read');
  first.resolve(said(dto));await flush();second.resolve(said(dto));await flush();c.m.render();c.m.setup();
  assert.equal(c.btn('data-approve-agent').props.disabled,false,'the reads hold nothing busy');
  c.btn('data-refuse-agent').props.onClick();await flush();assert.equal(c.calls.at(-1).method,'POST');
  assert.equal(c.btn('data-approve-agent').props.disabled,true,'the answer is in flight');
  c.m.replay();await flush();stale.resolve(said(dto));await flush();
  assert.equal(c.btn('data-approve-agent').props.disabled,true,'a read finishing meanwhile cannot release the answer in flight');
  refuse.resolve(said({...dto,status:'cancelled'}));await flush();
  assert.equal(c.btn('data-approve-agent'),undefined);assert.ok(c.btn('data-approval-done'),'answered: Close, nothing left busy');
  assert.deepEqual(c.follows,[]);assert.equal(c.done(),0);
 }finally{c.restore();}
 const failing=card({replies:[said(dto),answer({message:'nope'},500)]});
 try{await flush();failing.m.render();failing.m.setup();failing.btn('data-approve-agent').props.onClick();await flush();
  assert.equal(failing.btn('data-approve-agent').props.disabled,false,'a failed answer does not leave the card busy forever');}finally{failing.restore();}
});
test('unmounted account response cannot invoke ready selection; replacement account uses its own refusal',async()=>{
 const old=deferred();const gone=card({replies:[()=>old.promise]});
 try{await flush();gone.m.close();old.resolve(said({...dto,status:'ready',soulId:'s_old'}));await flush();
  assert.deepEqual(gone.follows,[],'a closed card never follows');assert.equal(gone.done(),0);}finally{gone.restore();}
 const other=card({replies:[answer({},403)]});
 try{await flush();const tree=other.m.render();other.m.setup();
  assert.match(text(tree),/belongs to another account/);assert.equal(other.btn('data-approve-agent'),undefined);assert.deepEqual(other.follows,[]);assert.equal(other.done(),0);}finally{other.restore();}
});
test('Not now is local dismissal with no approval/cancellation; wrong-world canonical response cannot select or Follow',async()=>{
 const c=card({replies:[said(dto)]});
 try{await flush();c.m.render();c.m.setup();c.btn('data-approval-close').props.onClick();
  assert.equal(c.done(),1);assert.deepEqual(c.calls.map(x=>x.method),['GET'],'closing asks nothing of the world');}finally{c.restore();}
 const wrong=card({replies:[said({...dto,status:'ready',soulId:'s_wrong'},'different-world')]});
 try{await flush();const tree=wrong.m.render();wrong.m.setup();
  assert.match(text(tree),/another world/);assert.deepEqual(wrong.follows,[]);assert.equal(wrong.done(),0);assert.equal(wrong.btn('data-approve-agent'),undefined);}finally{wrong.restore();}
 const right=card({replies:[said({...dto,status:'ready',soulId:'s_right'})]});
 try{await flush();right.m.render();right.m.setup();assert.deepEqual(right.follows,['s_right']);assert.equal(right.done(),1);}finally{right.restore();}
});
