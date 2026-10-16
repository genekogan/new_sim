// Actual component rendered through React's installed hook dispatcher. The
// deterministic effect lifecycle reproduces StrictMode cleanup/setup without
// a browser, provider, DOM package, network, or a product service.
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import {build} from 'esbuild';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const sourceDir=fileURLToPath(new URL('../src/',import.meta.url));
const temp=mkdtempSync(fileURLToPath(new URL('../.approval-component-fixture-',import.meta.url))),modulePath=join(temp,'component.mjs');
const input=process.env.ACCOUNT_APPROVAL_BASELINE_FILE?{stdin:{contents:readFileSync(process.env.ACCOUNT_APPROVAL_BASELINE_FILE,'utf8'),resolveDir:sourceDir,loader:'tsx'}}:{entryPoints:[join(sourceDir,'AccountApproval.tsx')]};
const built=await build({...input,bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic'});writeFileSync(modulePath,built.outputFiles[0].text);const {AccountApproval}=await import(pathToFileURL(modulePath));
const bringPath=join(temp,'bring-agent.mjs'),bringBuilt=await build({entryPoints:[join(sourceDir,'BringAgent.tsx')],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});writeFileSync(bringPath,bringBuilt.outputFiles[0].text);const {BringAgent}=await import(pathToFileURL(bringPath));
process.once('exit',()=>rmSync(temp,{recursive:true,force:true}));
const id='ap_'+'a'.repeat(32),dto={approval:{id,worldId:'w',name:'Avery',description:'',agentLabel:'Fixture agent',mode:'create',status:'pending',soulId:null,expiresAt:100000}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function mounted(props,Component=AccountApproval){const values=[],effects=[];let index=0,element;
 const internal=React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
 const dispatcher={useRef(value){const i=index++;return values[i]??=( {current:value});},useState(value){const i=index++;if(!values[i])values[i]={value:typeof value==='function'?value():value};return [values[i].value,next=>{values[i].value=typeof next==='function'?next(values[i].value):next;}];},useEffect(create,deps){const i=index++;const old=effects[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects[i]={create,deps,dirty:true,cleanup:old?.cleanup};}};
 const render=()=>{index=0;const old=internal.H;internal.H=dispatcher;try{element=Component(props);}finally{internal.H=old;}return element;};
 const setup=()=>{for(const e of effects)if(e?.dirty){e.cleanup?.();e.cleanup=e.create();e.dirty=false;}};
 const replay=()=>{for(const e of effects)e?.cleanup?.();for(const e of effects)if(e)e.cleanup=e.create();};
 const close=()=>{for(const e of effects)e?.cleanup?.();};render();setup();return {render,replay,close};
}
function buttons(tree,out=[]){if(!tree||typeof tree!=='object')return out;if(tree.type==='button')out.push(tree);const c=tree.$$typeof===Symbol.for('react.portal')?tree.children:tree.props?.children;for(const value of Array.isArray(c)?c:[c])if(Array.isArray(value))value.forEach(x=>buttons(x,out));else buttons(value,out);return out;}
const portalDocument=()=>({body:{nodeType:1},activeElement:null,querySelector(){return null;}});
const props=api=>({id,worldId:'w',worldUrl:'http://fixture/w/eden',worldName:'Fixture',auth:{authed:true,ready:true,label:'Fixture account',login(){}},api,onReady(){},onClose(){}});
test('StrictMode effect replay recovers a fresh read; stale finally cannot release newer inflight or leave busy forever',async()=>{
 const first=deferred(),second=deferred();let calls=0;const m=mounted(props(()=>++calls===1?first.promise:second.promise));m.replay();assert.equal(calls,2,'replayed authenticated effect must start its own fresh read');
 first.resolve({status:200,data:dto});await Promise.resolve();await Promise.resolve();assert.equal(buttons(m.render()).find(b=>b.props.children==='Check same request').props.disabled,true,'stale completion must not clear newer inflight');
 second.resolve({status:200,data:dto});await Promise.resolve();await Promise.resolve();assert.equal(buttons(m.render()).find(b=>b.props.children==='Check same request').props.disabled,false);assert.ok(buttons(m.render()).some(b=>b.props.children?.[0]==='Approve '));m.close();
});
test('unmounted account response cannot invoke ready selection; replacement account uses its own refusal',async()=>{
 const old=deferred();let selected=0;const p=props(()=>old.promise);p.onReady=()=>selected++;const original=mounted(p);original.close();const current=mounted(props(async()=>({status:403,data:{}})));await Promise.resolve();await Promise.resolve();old.resolve({status:200,data:{approval:{...dto.approval,status:'ready',soulId:'s_old'}}});await Promise.resolve();await Promise.resolve();assert.equal(selected,0);assert.equal(buttons(current.render()).find(b=>b.props.children==='Check same request').props.disabled,false);current.close();
});
test('actual New Soul component gates signed-out UI, resumes after login/reload only in its world and copies a plain raw URL',async()=>{
 const names=['location','history','sessionStorage','addEventListener','removeEventListener','navigator','document'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)])),store=new Map(),copied=[];let logins=0;
 const loc={origin:'http://fixture',pathname:'/w/eden',search:'',hash:''};for(const [name,value]of Object.entries({location:loc,history:{replaceState(_a,_b,url){loc.hash=new URL(url,loc.origin).hash;}},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},addEventListener(){},removeEventListener(){},navigator:{clipboard:{writeText:async text=>copied.push(text)}},document:portalDocument()}))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 try{const signedOut=mounted({requireAuth:true,auth:{ready:true,authed:false,login:()=>logins++}},BringAgent);buttons(signedOut.render()).find(b=>b.props.className==='bring-agent-open').props.onClick();assert.equal(logins,1);assert.equal(buttons(signedOut.render()).some(b=>b.props.children==='Copy prompt'),false);signedOut.close();loc.hash='';loc.pathname='/w/mars';const otherWorld=mounted({requireAuth:true,auth:{ready:true,authed:true,login(){}}},BringAgent);assert.equal(buttons(otherWorld.render()).some(b=>b.props.children==='Copy prompt'),false);otherWorld.close();loc.pathname='/w/eden';const resumed=mounted({requireAuth:true,auth:{ready:true,authed:true,login(){}}},BringAgent);const copy=buttons(resumed.render()).find(b=>b.props.children==='Copy prompt');assert.ok(copy,'login reload must resume same-world onboarding');await copy.props.onClick();await Promise.resolve();assert.equal(copied[0],'Read the instructions at http://fixture/w/eden/instructions.md to create a new soul in the world Eden.');buttons(resumed.render()).find(b=>b.props['aria-label']==='Close').props.onClick();assert.equal(buttons(resumed.render()).some(b=>b.props.children==='Copy prompt'),false);resumed.close();assert.equal(store.size,0);
 }finally{for(const name of names){const d=old.get(name);if(d)Object.defineProperty(globalThis,name,d);else delete globalThis[name];}}
});
test('auth-off legacy world opens ordinary instructions without invoking unconfigured sign-in',()=>{
 const names=['location','history','sessionStorage','addEventListener','removeEventListener','document'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));let logins=0;
 for(const [name,value]of Object.entries({location:{origin:'http://fixture',pathname:'/w/mars',search:'',hash:''},history:{replaceState(){}},sessionStorage:{getItem(){return null;},removeItem(){},setItem(){}},addEventListener(){},removeEventListener(){},document:portalDocument()}))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 try{const m=mounted({requireAuth:false,auth:{ready:true,authed:false,login:()=>logins++}},BringAgent);buttons(m.render()).find(b=>b.props.className==='bring-agent-open').props.onClick();assert.equal(logins,0);assert.ok(buttons(m.render()).some(b=>b.props.children==='Copy prompt'));m.close();}finally{for(const name of names){const d=old.get(name);if(d)Object.defineProperty(globalThis,name,d);else delete globalThis[name];}}
});
test('Not now is local dismissal with no approval/cancellation; wrong-world canonical response cannot select or Follow',async()=>{
 let dismissed=0,selected=0,calls=0;const p=props(async()=>{calls++;return {status:200,data:dto};});p.onClose=()=>dismissed++;const m=mounted(p);await Promise.resolve();await Promise.resolve();buttons(m.render()).find(b=>b.props.children==='Not now').props.onClick();assert.equal(dismissed,1);assert.equal(calls,1);m.close();
 const next=props(async()=>({status:200,data:{approval:{...dto.approval,worldId:'different-world',status:'ready',soulId:'s_wrong'}}}));next.onReady=()=>selected++;const other=mounted(next);await Promise.resolve();await Promise.resolve();assert.equal(selected,0);other.close();
});
