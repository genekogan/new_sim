import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const dir=await mkdtemp(join(tmpdir(),'sim-soul-context-'));
globalThis.location={origin:'https://sim.eden.art',pathname:'/w/eden/',hash:''};
globalThis.sessionStorage={getItem:()=>null};
const outfile=join(dir,'context.cjs');
await build({stdin:{contents:`export {SoulFocus} from './SoulFocus.tsx';export {SoulAccount} from './SoulAccount.tsx';export {connectionSetupPrompt} from './connection-prompt.ts';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:new URL('.',import.meta.url).pathname,loader:'tsx'},outfile,bundle:true,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const {SoulFocus,SoulAccount,connectionSetupPrompt,createElement:h,renderToStaticMarkup:render}=require(outfile);
const soul={id:'s_A',entityId:'h_A',name:'Mutable Name',description:'Curious artist',doing:'',energy:'fine'};
const auth=(id=null)=>({authed:!!id,ready:true,label:id,debug:{accountIdentity:id,privyUserId:null},login(){},logout(){}});
const me={userId:'acct_A',souls:['s_A'],role:'user',invited:true};
const sim={me,privateAuthorityGeneration:1,conn:{welcome:{worldId:'eden',epoch:1},replica:{souls:new Map([[soul.id,soul]]),entities:{},tick:0}},plays:[],talk:[]};
let calls=0;const api=async()=>{calls++;throw Error('Rendering must not write');};
const base={sim,api,selected:'s_A',select(){},manage(){},camera:{following:false,follow(){},stop(){}}};
const forbidden=/Give .* direction|Send direction|standing rules|reconsiders in|recent thinking|intent-v2|mandate|public download and setup/;
for(const [name,identity,owner] of [['signed out',null,false],['current owner','acct_A',true],['different account','acct_B',false]])test(`modern context for ${name}`,()=>{
 const html=render(h(SoulFocus,{...base,auth:auth(identity)}));
 assert.match(html,/class="soul-card"/);assert.match(html,/Curious artist/);assert.equal(/>Follow</.test(html),!owner,'LINK: the owner card offers Follow only once its agent is known to be connected');assert.match(html,/class="soul-share" aria-label="Copy a link to Mutable Name"/);assert.doesNotMatch(html,/>Share<|>Pin<|Pin this Soul|Travel to/,'CARD-TRIM: Share is a paperclip by the name; no Pin, no Travel to');assert.doesNotMatch(html,/>Activity|This mind|Agent access/,'LINK: the Activity view, This mind and the Agent access panel are gone');if(owner)assert.match(html,/data-status="checking"/,'LINK: the owner card claims no state before its inbox answers');assert.doesNotMatch(html,forbidden);
});
test('account switching suppresses stale owned roster until matching server identity',()=>{
 const props={sim,api,select(){},pairCode:null,clearPair(){}};
 const owner=render(h(SoulAccount,{...props,auth:auth('acct_A')}));assert.match(owner,/Mutable Name/);assert.match(owner,/New Soul/);assert.doesNotMatch(owner,forbidden);
 const switched=render(h(SoulAccount,{...props,auth:auth('acct_B')}));assert.match(switched,/Checking current account/);assert.doesNotMatch(switched,/Mutable Name|Agent access/);
 const unsigned=render(h(SoulAccount,{...props,auth:auth()}));assert.match(unsigned,/Sign in/);assert.doesNotMatch(unsigned,/Mutable Name/);
});
test('multiple stable Soul IDs remain selectable despite mutable duplicate names',()=>{
 const s2={...soul,id:'s_B',entityId:'h_B'};const state={...sim,me:{...me,souls:['s_A','s_B']},conn:{...sim.conn,replica:{...sim.conn.replica,souls:new Map([['s_A',soul],['s_B',s2]])}}};
 const html=render(h(SoulAccount,{sim:state,auth:auth('acct_A'),api,select(){},pairCode:null,clearPair(){}}));assert.equal((html.match(/Mutable Name/g)??[]).length,2);assert.equal(calls,0);
});
test('published reconnect prompt preserves exact ID/world and accepts names only as data',()=>{
 const prompt=connectionSetupPrompt('https://sim.eden.art/w/mars','s_A','Changed name');assert.match(prompt,/pair-soul/);assert.match(prompt,/approval wait/);assert.match(prompt,/instructions.md/);assert.match(prompt,/"soulId":"s_A"/);assert.match(prompt,/"currentName":"Changed name"/);assert.doesNotMatch(prompt,/Start connect|OS store|plaintext|skill.md/);assert.match(prompt,/Do not create another/);
 for(const base of ['https://evil.example/w/unknown','https://sim.eden.art/w/mars?secret=x','https://user:pass@sim.eden.art/w/eden'])assert.equal(connectionSetupPrompt(base,'s_A'),null);
 assert.equal(connectionSetupPrompt('https://sim.eden.art/w/eden','bad ID'),null);
});
test.after(async()=>rm(dir,{recursive:true,force:true}));
