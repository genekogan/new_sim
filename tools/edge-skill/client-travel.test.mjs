import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {travelCommand,travelledState,travelReport,TRAVEL_PATH} from './client-travel.mjs';

const ALDER='http://127.0.0.1:6110/w/alder',BIRCH='http://127.0.0.1:6110/w/birch',CEDAR='http://127.0.0.1:6110/w/cedar';
/** A folder (in memory) and a fake site: routes[`${base} ${method}`] → (body, token) → {status, data}. */
function rig(state,routes){
 let s={...state};const calls=[];
 const load=()=>s,save=p=>{s=JSON.parse(JSON.stringify({...s,...p}));return s;};
 const fetchImpl=async(url,init)=>{
  const base=url.slice(0,-TRAVEL_PATH.length),token=init.headers.authorization?.slice(7),body=init.body?JSON.parse(init.body):undefined;
  calls.push({base,method:init.method,token,body});
  const h=routes[`${base} ${init.method}`];if(!h)throw new Error('connect ECONNREFUSED');
  const r=h(body,token);return {status:r.status,text:async()=>JSON.stringify(r.data)};
 };
 return {deps:{load,save,fetchImpl},calls,state:()=>s};
}
const atAlder={world:ALDER,soul:'s_ana',token:'sim_alder',identity:'agent-x',mode:'edge',lastReceipt:'r_1'};
const toBirch={status:200,data:{contract:'travel/1',ok:true,traveller:'alder/s_ana',from:'alder',fromName:'Alder',to:'birch',toName:'Birch',soulId:'s_birch1',name:'Ana',token:'sim_birch',returned:false,created:true,atHome:false,home:'alder',log:[],base:BIRCH}};

test('travel <world>: the folder follows the Soul and keeps the home grant; the token never prints',async()=>{
 const r=rig(atAlder,{[`${ALDER} POST`]:()=>toBirch});
 const out=await travelCommand(['Birch'],r.deps);
 assert.deepEqual(r.calls[0],{base:ALDER,method:'POST',token:'sim_alder',body:{to:'Birch'}});
 const s=r.state();
 assert.equal(s.world,BIRCH);assert.equal(s.soul,'s_birch1');assert.equal(s.token,'sim_birch');
 assert.deepEqual(s.travel.home,{world:ALDER,soul:'s_ana',token:'sim_alder'});
 assert.equal(s.travel.homeSlug,'alder');assert.equal(s.travel.at,'birch');
 assert.equal('mode' in s,false,'edge/legacy mode is re-detected in the new world');assert.equal('lastReceipt' in s,false);
 assert.equal(s.identity,'agent-x','the owner identity is the same person everywhere');
 assert.equal(out.to,'birch');assert.equal(out.folder.world,BIRCH);assert.equal(out.folder.homeKept,true);
 assert.equal(JSON.stringify(out).includes('sim_'),false);
});

test('travel onward keeps the original home; travel home from there restores home and refreshes its grant',async()=>{
 const r=rig(atAlder,{[`${ALDER} POST`]:()=>toBirch,
  [`${BIRCH} POST`]:b=>b.to==='cedar'?{status:200,data:{...toBirch.data,from:'birch',to:'cedar',toName:'Cedar',soulId:'s_cedar1',token:'sim_cedar',base:CEDAR}}
   :{status:200,data:{...toBirch.data,from:'birch',to:'alder',toName:'Alder',soulId:'s_ana',token:'sim_alder2',returned:true,created:false,atHome:true,base:ALDER}},
  [`${CEDAR} POST`]:()=>({status:200,data:{...toBirch.data,from:'cedar',to:'alder',toName:'Alder',soulId:'s_ana',token:'sim_alder3',returned:true,atHome:true,base:ALDER}})});
 await travelCommand(['birch'],r.deps);await travelCommand(['cedar'],r.deps);
 assert.equal(r.state().world,CEDAR);assert.deepEqual(r.state().travel.home,{world:ALDER,soul:'s_ana',token:'sim_alder'});
 const back=await travelCommand(['home'],r.deps);
 assert.equal(back.atHome,true);assert.match(back.next,/You are home/);
 assert.equal(r.state().world,ALDER);assert.equal(r.state().token,'sim_alder3');assert.deepEqual(r.state().travel.home,{world:ALDER,soul:'s_ana',token:'sim_alder3'});
});

test('travel home falls back to home when this world let the Soul go or is down',async()=>{
 for(const where of [{status:409,data:{ok:false,code:'travel.away',message:'Ana is in alder'}},null]){
  const st={...atAlder,world:BIRCH,soul:'s_birch1',token:'sim_birch',travel:{home:{world:ALDER,soul:'s_ana',token:'sim_alder'},homeSlug:'alder',at:'birch'}};
  const r=rig(st,{...(where?{[`${BIRCH} POST`]:()=>where}:{}),
   [`${ALDER} POST`]:(b,t)=>t==='sim_alder'&&b.to==='home'?{status:200,data:{contract:'travel/1',ok:true,from:'birch',fromName:'birch',to:'alder',toName:'Alder',soulId:'s_ana',name:'Ana',recalled:true,released:'released',atHome:true,home:'alder',log:[],base:ALDER}}:{status:400,data:{}}});
  const out=await travelCommand(['home'],r.deps);
  assert.equal(r.calls.at(-1).base,ALDER);assert.equal(out.recalled,true);assert.equal(out.viaHome,where?'travel.away':'unreachable');
  assert.equal(r.state().world,ALDER);assert.equal(r.state().soul,'s_ana');assert.equal(r.state().token,'sim_alder','the kept home token stays when home mints none');
 }
});

test('refusals change nothing in the folder and say why',async()=>{
 const r=rig(atAlder,{[`${ALDER} POST`]:()=>({status:403,data:{ok:false,code:'travel.closed',message:'Birch is closed to visitors.'}})});
 await assert.rejects(travelCommand(['birch'],r.deps),e=>e.code==='travel.closed'&&/closed to visitors/.test(e.message));
 assert.deepEqual(r.state(),atAlder);
 // a non-home refusal never asks home
 const r2=rig({...atAlder,world:BIRCH,travel:{home:{world:ALDER,soul:'s_ana',token:'sim_alder'}}},{[`${BIRCH} POST`]:()=>({status:409,data:{ok:false,code:'travel.away'}})});
 await assert.rejects(travelCommand(['cedar'],r2.deps),/travel.away/);assert.equal(r2.calls.length,1);
});

test('usage, missing pairing and a running mind are refused before any call',async()=>{
 const r=rig(atAlder,{});
 await assert.rejects(travelCommand(['a','b'],r.deps),/usage: travel/);
 await assert.rejects(travelCommand(['--x'],r.deps),/usage: travel/);
 await assert.rejects(travelCommand(['birch'],{...r.deps,live:()=>true}),/Stop this folder/);
 await assert.rejects(travelCommand(['birch'],rig({world:ALDER},{}).deps),/No paired Soul/);
 await assert.rejects(travelCommand([],rig({},{}).deps),/register/);
 assert.equal(r.calls.length,0);
});

test('travel (no argument) reads status; when this world is down it shows home\'s view',async()=>{
 const st={...atAlder,world:BIRCH,token:'sim_birch',travel:{home:{world:ALDER,soul:'s_ana',token:'sim_alder'}}};
 const up=rig(st,{[`${BIRCH} GET`]:()=>({status:200,data:{here:'birch',state:'present'}})});
 assert.deepEqual(await travelCommand([],up.deps),{here:'birch',state:'present',folder:{world:BIRCH,soul:'s_ana',homeKept:true}});
 const down=rig(st,{[`${ALDER} GET`]:(_b,t)=>({status:t==='sim_alder'?200:401,data:{here:'alder',state:'away',at:'birch'}})});
 const v=await travelCommand([],down.deps);assert.equal(v.here,'alder');assert.match(v.note,/unreachable/);
});

test('travelledState refuses an answer without a destination or token; account folders record the new grant',()=>{
 assert.throws(()=>travelledState(atAlder,{ok:true,soulId:'s_x'}),/without a destination/);
 assert.throws(()=>travelledState(atAlder,{ok:true,soulId:'s_x',base:BIRCH,from:'alder',home:'alder'}),/without a Soul token/);
 const s=travelledState({...atAlder,accountAuth:true,delegations:{s_ana:{world:ALDER,token:'sim_alder'}}},toBirch.data);
 assert.deepEqual(s.delegations,{s_ana:{world:ALDER,token:'sim_alder'},s_birch1:{world:BIRCH,token:'sim_birch'}});
 assert.equal(travelReport(toBirch.data,s).token,undefined);
});

test('the CLI lists travel and refuses it without a world (no network)',t=>{
 const dir=mkdtempSync(join(tmpdir(),'soul-travel-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const cli=fileURLToPath(new URL('./eden-agent.mjs',import.meta.url));
 const list=spawnSync(process.execPath,[cli,'nope'],{cwd:dir,encoding:'utf8',timeout:10000});assert.match(list.stdout,/\|travel\|/);
 const r=spawnSync(process.execPath,[cli,'travel','birch'],{cwd:dir,encoding:'utf8',timeout:10000});
 assert.equal(r.status,1);assert.match(r.stderr,/register <world-url>/);
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:ALDER}));
 const r2=spawnSync(process.execPath,[cli,'travel'],{cwd:dir,encoding:'utf8',timeout:10000});
 assert.match(r2.stderr,/No paired Soul/);assert.deepEqual(JSON.parse(readFileSync(join(dir,'.eden-agent.json'),'utf8')),{world:ALDER});
});
