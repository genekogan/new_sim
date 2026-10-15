import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {BringAgent,NewSoulLink} from './BringAgent.tsx';
Object.assign(globalThis,{location:{origin:'https://sim.eden.art',pathname:'/w/eden/',search:'',hash:'#join'},document:{body:{nodeType:1}},sessionStorage:{getItem:()=>null}});
const {SoulAccount}=await import('./SoulAccount.tsx');
const auth={ready:true,authed:true,label:'Owner',debug:{accountIdentity:'account'},login(){},logout(){}};const sim={me:{userId:'account',souls:[]},conn:{replica:{souls:new Map()}}};
// React's server renderer rejects portals. Inspect the real portal produced by
// the component, then render its children for the static structure assertion.
function initialBringAgent(showButton:boolean){
 const internals=(React as unknown as {__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE:{H:unknown}}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,previous=internals.H;
 internals.H={useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,()=>{}],useRef:(current:unknown)=>({current}),useEffect(){}};
 try{return BringAgent({auth,requireAuth:true,showButton});}finally{internals.H=previous;}
}
function withoutPortals(node:React.ReactNode,portals:React.ReactPortal[]):React.ReactNode{
 if(Array.isArray(node))return node.map(child=>withoutPortals(child,portals));
 if(node&&typeof node==='object'&&'$$typeof'in node&&node.$$typeof===Symbol.for('react.portal')){const portal=node as React.ReactPortal;portals.push(portal);return withoutPortals(portal.children,portals);}
 if(React.isValidElement<{children?:React.ReactNode}>(node))return React.cloneElement(node,undefined,withoutPortals(node.props.children,portals));
 return node;
}
test('deepjoin has one actual portal/dialog with header and accountCTA together, includingadvancedhiddenheaderbutton',()=>{for(const showButton of [true,false]){const portals:React.ReactPortal[]=[],entry=withoutPortals(initialBringAgent(showButton),portals);assert.equal(portals.length,1);assert.equal((portals[0] as React.ReactPortal&{containerInfo:unknown}).containerInfo,document.body);const html=renderToStaticMarkup(<>{entry}<SoulAccount auth={auth as never} sim={sim as never} api={{} as never} select={()=>{}} pairCode={null} clearPair={()=>{}}/></>);assert.equal((html.match(/role="dialog"/g)??[]).length,1);assert.match(html,/href="#join"/);}});
test('watch has no modal and secondarylink contains no controller, preservingcanonicalprivateoriginjoin',()=>{location.hash='#watch';const html=renderToStaticMarkup(<><BringAgent auth={auth} requireAuth/><NewSoulLink auth={{}}/></>);assert.doesNotMatch(html,/role="dialog"/);assert.match(html,/href="#join"/);const canonical=renderToStaticMarkup(<NewSoulLink auth={{signInUrl:'https://sim.eden.art/w/mars#watch'}}/>);assert.match(canonical,/href="https:\/\/sim\.eden\.art\/w\/mars#join"/);});
