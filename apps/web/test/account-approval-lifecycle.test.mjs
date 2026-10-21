// Actual component (New Soul, BringAgent) rendered through React's installed hook dispatcher. (Lane LAP: the older
// worlds' AccountApproval view is gone; every world shows god-ui/ApprovalDialog.tsx.) The
// deterministic effect lifecycle reproduces StrictMode cleanup/setup without
// a browser, provider, DOM package, network, or a product service.
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const sourceDir=fileURLToPath(new URL('../src/',import.meta.url));
const temp=mkdtempSync(fileURLToPath(new URL('../.approval-component-fixture-',import.meta.url)));
const bringPath=join(temp,'bring-agent.mjs'),bringBuilt=await build({entryPoints:[join(sourceDir,'BringAgent.tsx')],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});writeFileSync(bringPath,bringBuilt.outputFiles[0].text);const {BringAgent}=await import(pathToFileURL(bringPath));
process.once('exit',()=>rmSync(temp,{recursive:true,force:true}));
function mounted(props,Component){const values=[],effects=[];let index=0,element;
 const internal=React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
 const dispatcher={useRef(value){const i=index++;return values[i]??=( {current:value});},useState(value){const i=index++;if(!values[i])values[i]={value:typeof value==='function'?value():value};return [values[i].value,next=>{values[i].value=typeof next==='function'?next(values[i].value):next;}];},useEffect(create,deps){const i=index++;const old=effects[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects[i]={create,deps,dirty:true,cleanup:old?.cleanup};}};
 const render=()=>{index=0;const old=internal.H;internal.H=dispatcher;try{element=Component(props);}finally{internal.H=old;}return element;};
 const setup=()=>{for(const e of effects)if(e?.dirty){e.cleanup?.();e.cleanup=e.create();e.dirty=false;}};
 const replay=()=>{for(const e of effects)e?.cleanup?.();for(const e of effects)if(e)e.cleanup=e.create();};
 const close=()=>{for(const e of effects)e?.cleanup?.();};render();setup();return {render,replay,close};
}
function buttons(tree,out=[]){if(!tree||typeof tree!=='object')return out;if(tree.type==='button')out.push(tree);const c=tree.$$typeof===Symbol.for('react.portal')?tree.children:tree.props?.children;for(const value of Array.isArray(c)?c:[c])if(Array.isArray(value))value.forEach(x=>buttons(x,out));else buttons(value,out);return out;}
const portalDocument=()=>({body:{nodeType:1},activeElement:null,querySelector(){return null;}});
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
