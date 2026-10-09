import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Together,type TogetherPort,type Invite} from './edge/ledger/together.ts';
import type {EdgeSoul,EdgeCapability} from './edge/contract.ts';
import {emptyWorld,human,addAll} from '../../../mars/viewer/engine/world/factory.ts';
import {provingGround} from '../../../mars/viewer/engine/scenes/proving-ground.ts';
function fixture(t:{after(fn:()=>void):void}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const world=addAll(emptyWorld('proving-ground',provingGround()),human('a',-6,-6),human('b',-5.4,-6));
 const a={soulId:'s_a',entityId:'a',name:'A',owner:'synthetic:a'},b={soulId:'s_b',entityId:'b',name:'B',owner:'synthetic:b'},host={worldId:'pair-policy-fixture',engine:{world},minds:new Map([['s_a',a],['s_b',b]])};
 const together=new Together({host,db:{db},places:{byId:new Map()},spots:{spots:[],shelves:[]},body:(id:string)=>world.entities[id],faded:()=>false,receipt:()=>null,aboard:()=>null,deliver:()=>{},spectate:()=>{},touch:()=>{}} as unknown as TogetherPort);
 const make=()=>{const steps=[{verb:'mars:pose_v1',params:{activity:'hug',seconds:5,gap:.52,clear:true,waitSeconds:45,alone:'fail'}}];const prepared=together.prepare(a,{id:'hug:s_b'} as EdgeCapability,{label:'Hug B',steps,together:{kind:'paired',what:'hug',guest:'s_b'}},{},steps);assert.ok('steps'in prepared);prepared.commit!('r_host');const inv=JSON.parse((db.prepare('SELECT body FROM edge_invites_v1').get() as {body:string}).body) as Invite;return {prepared,inv};};
 const write=(inv:Invite)=>db.prepare('UPDATE edge_invites_v1 SET body=? WHERE invite_id=?').run(JSON.stringify(inv),inv.id);
 return {together,a:a as EdgeSoul,b:b as EdgeSoul,make,write};
}
test('new paired offer freezes ready-v1 on both program and persisted invitation',t=>{const f=fixture(t),{prepared,inv}=f.make();assert.equal(inv.pairedPolicy,'ready-v1');assert.equal(prepared.steps.find(s=>s.verb==='mars:pose_v1')!.params.pairedPolicy,'ready-v1');const accept=f.together.acceptPlan(f.b,inv.id,[],new Map());assert.ok('steps'in accept);assert.equal(accept.steps.find(s=>s.verb==='mars:pose_v1')!.params.pairedPolicy,'ready-v1');});
test('accepting an old persisted invitation keeps legacy steps despite current new-offer policy',t=>{const f=fixture(t),{inv}=f.make();delete inv.pairedPolicy;f.write(inv);const accept=f.together.acceptPlan(f.b,inv.id,[],new Map());assert.ok('steps'in accept);assert.equal('pairedPolicy'in accept.steps.find(s=>s.verb==='mars:pose_v1')!.params,false);});
test('unsupported persisted invitation policy refuses rather than falling back to legacy',t=>{const f=fixture(t),{inv}=f.make();(inv as {pairedPolicy?:string}).pairedPolicy='future-v99';f.write(inv);const accept=f.together.acceptPlan(f.b,inv.id,[],new Map());assert.ok('code'in accept);assert.equal(accept.code,'gesture.policy-unsupported');});
