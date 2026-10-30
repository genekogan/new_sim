import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {probeSessions,verifyOwnedProbeExit} from './probe-sessions.mjs';

test('separately opened registries preserve each others registrations',()=>{
 const root=mkdtempSync(join(tmpdir(),'sim-probes-'));
 try{const first=probeSessions(root),second=probeSessions(root);
  for(const [registry,id] of [[first,'a'],[second,'b']])registry.register({threadId:id,cwd:join(root,id),name:'Sim probe '+id,recoveryMechanism:'durable'});
  first.complete('a',{outcome:'passed',ownedProcessesExited:true,evidence:'a.json'});
  assert.deepEqual(second.snapshot().sessions.map(x=>[x.threadId,x.terminal]),[['a',true],['b',false]]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('cleanup preserves unfinished/ephemeral sessions and refuses active or mismatched durable threads',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sim-probes-')),calls=[];let closed=false;
 const host={send(){},close:async()=>{closed=true},request:async(method,args)=>{
  calls.push({method,args});if(method==='thread/read')return {thread:{cwd:args.threadId==='foreign'?'/unrelated':join(root,args.threadId),status:{type:args.threadId==='busy'?'active':'notLoaded'}}};return {};
 }};
 try{
  const registry=probeSessions(root,{createHost:()=>host});
  for(const id of ['done','unfinished','busy','foreign','ephemeral']){
   registry.register({threadId:id,cwd:join(root,id),name:'Sim probe '+id,ephemeral:id==='ephemeral',recoveryMechanism:'same durable host and Soul journal'});
   if(id!=='unfinished')registry.complete(id,{outcome:'failed',ownedProcessesExited:true,evidence:'summary.json'});
  }
  assert.throws(()=>registry.complete('unfinished',{outcome:'passed',ownedProcessesExited:false,evidence:'summary.json'}));
  const rows=await registry.archiveCompleted();
  assert.deepEqual(rows.map(x=>[x.threadId,x.archived]),[['done',true],['busy',false],['foreign',false]]);
  assert.deepEqual(calls.filter(x=>x.method==='thread/archive').map(x=>x.args.threadId),['done']);
  assert.equal(calls.some(x=>['thread/start','thread/resume'].includes(x.method)),false);
  assert.equal(closed,true);
  assert.equal(probeSessions(root).snapshot().sessions.find(x=>x.threadId==='done').outcome,'failed');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('failed archival remains retryable without deleting probe evidence',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sim-probes-'));let blocked=true;
 try{
  const registry=probeSessions(root,{createHost:()=>({send(){},close:async()=>{},request:async(method)=>{
   if(method==='thread/read')return {thread:{cwd:join(root,'host'),status:{type:'notLoaded'}}};
   if(method==='thread/archive'&&blocked)throw Error('active writer');return {};
  }})});
  registry.register({threadId:'owned',cwd:join(root,'host'),name:'Sim probe',recoveryMechanism:'same durable host and Soul journal'});
  registry.complete('owned',{outcome:'bounded-end',ownedProcessesExited:true,evidence:'local-summary.json'});
  assert.equal((await registry.archiveCompleted())[0].archived,false);blocked=false;
  assert.equal((await registry.archiveCompleted())[0].archived,true);
  assert.equal(registry.snapshot().sessions[0].evidence,'local-summary.json');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('archive RPC cannot overwrite a concurrent completion audit or another registration',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sim-probe-race-'));let finishRead;
 try{
  const first=probeSessions(root,{createHost:()=>({send(){},close:async()=>{},request:async(method)=>{
   if(method==='thread/read')return new Promise(resolve=>{finishRead=()=>resolve({thread:{cwd:join(root,'host'),status:{type:'idle'}}});});return {};
  }})}),second=probeSessions(root);
  first.register({threadId:'owned',cwd:join(root,'host'),name:'Sim owned',recoveryMechanism:'durable'});first.complete('owned',{outcome:'passed',ownedProcessesExited:true,evidence:'old-audit.json'});
  const archiving=first.archiveCompleted();for(let i=0;i<20&&!finishRead;i++)await new Promise(setImmediate);assert.ok(finishRead);
  second.complete('owned',{outcome:'failed',ownedProcessesExited:true,evidence:'new-complete-audit.json'});second.register({threadId:'other',cwd:join(root,'other'),name:'Sim other',recoveryMechanism:'durable'});
  finishRead();assert.equal((await archiving)[0].archived,true);
  const sessions=second.snapshot().sessions,owned=sessions.find(s=>s.threadId==='owned');assert.equal(owned.outcome,'failed');assert.equal(owned.evidence,'new-complete-audit.json');assert.ok(owned.archivedAt);assert.equal(sessions.find(s=>s.threadId==='other').terminal,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('explicit failed exit is archivable only with every controller certificate and absent owned group',()=>{
 const host={hostPid:222,threadId:'owned',groupClosed:true,groupVerification:'absent'},controller={pid:111,started:true,hostPids:new Set([222]),closed:{controllerPid:111,ownedProcessesExited:true,ownedHosts:[host]}},input={exit:{code:1,signal:null},controllers:[controller]},absent=()=>{throw Object.assign(Error('absent'),{code:'ESRCH'});};
 assert.equal(verifyOwnedProbeExit(input,absent),true,'code1 can be terminal after actual cleanup proof');
 assert.equal(verifyOwnedProbeExit({...input,exit:{code:0,signal:null},controllers:[{...controller,closed:null}]},absent),false,'code0 does not substitute for a missing final certificate');
 assert.equal(verifyOwnedProbeExit({...input,controllers:[controller,{pid:333,started:true,hostPids:new Set(),closed:null}]},absent),false,'every controller restart must close');
 assert.equal(verifyOwnedProbeExit(input,()=>{}),false,'a live process group blocks archival');
 assert.equal(verifyOwnedProbeExit(input,()=>{throw Object.assign(Error('unknown'),{code:'EPERM'});}),false);
 assert.equal(verifyOwnedProbeExit({...input,controllers:[{...controller,hostPids:new Set([222,444])}]},absent),false,'a missing owned host cannot disappear from the certificate');
 assert.equal(verifyOwnedProbeExit({...input,exit:{code:null,signal:'SIGKILL'}},absent),false);
});
function restartFixture(){
 const ownership={actorId:'reader-b',setupId:'setup-1',worldId:'world-1',soulId:'s_reader',controller:{pid:111,ppid:100,pgid:100,startToken:'birth-controller'},launcher:{pid:100,ppid:99,pgid:100,startToken:'birth-launcher'},descendantsComplete:true,evidence:['restart.json#ownership'],groups:[{pgid:222,members:[{pid:222,ppid:111,pgid:222,startToken:'birth-host'},{pid:223,ppid:222,pgid:222,startToken:'birth-child'}]}]};
 const controller={pid:111,started:true,hostPids:new Set([222]),closed:null,restartOwnership:structuredClone(ownership)};
 const proof={schema:'sim-continuity-managed-restart/1',actor:'reader-b',setupId:'setup-1',worldId:'world-1',soulId:'s_reader',dispatchAttempted:true,triggerExercised:true,deathAt:100,controllerExitAt:110,oldGroupsAbsentAt:120,signals:[{target:111,role:'controller',signal:'SIGKILL',delivered:true,at:100}],oldOwnership:structuredClone(ownership)};
 return {controller,proof,input:{exit:{code:0,signal:null},controllers:[controller],restartProofs:[proof]}};
}
const absent=()=>{throw Object.assign(Error('absent'),{code:'ESRCH'});};

test('declared controller death uses exact external absence proof without inventing a close event',()=>{
 const {controller,proof,input}=restartFixture(),checked=[];
 const checkAbsent=(pid,signal)=>{checked.push([pid,signal]);return absent();};
 assert.equal(verifyOwnedProbeExit(input,checkAbsent),true);assert.deepEqual(checked,[[111,0],[222,0],[223,0],[-222,0]]);assert.equal(controller.closed,null);
 for(const change of [{oldGroupsAbsentAt:null},{controllerExitAt:99},{dispatchAttempted:false},{signals:[]},{oldOwnership:{...proof.oldOwnership,descendantsComplete:false}}])assert.equal(verifyOwnedProbeExit({...input,restartProofs:[{...proof,...change}]},absent),false);
 assert.equal(verifyOwnedProbeExit({...input,controllers:[{...controller,pid:333}]},absent),false);
 assert.equal(verifyOwnedProbeExit({...input,controllers:[{...controller,hostPids:new Set([222,444])}]},absent),false);
 assert.equal(verifyOwnedProbeExit(input,(pid)=>{if(pid===223)return;return absent();}),false,'a surviving escaped tool child blocks archival');
 assert.equal(verifyOwnedProbeExit(input,(pid)=>{if(pid===-222)return;return absent();}),false,'a reused or live group blocks archival');
 assert.equal(verifyOwnedProbeExit(input,()=>{throw Object.assign(Error('unknown'),{code:'EPERM'});}),false);
 assert.equal(verifyOwnedProbeExit({...input,controllers:[controller,{pid:444,started:true,hostPids:new Set(),closed:null}]},absent),false,'proof for old controller never closes a new one');
 const later={pid:444,started:true,hostPids:new Set(),closed:{controllerPid:444,ownedProcessesExited:true,ownedHosts:[]}};
 assert.equal(verifyOwnedProbeExit({...input,exit:{code:1,signal:null},controllers:[controller,later]},absent),true,'later controllers require their own normal close certificate');
});

test('normal certificates require controller PID absence as well as absent host groups',()=>{
 const controller={pid:111,started:true,hostPids:new Set([222]),closed:{controllerPid:111,ownedProcessesExited:true,ownedHosts:[{hostPid:222,groupClosed:true,groupVerification:'absent'}]}};
 const input={exit:{code:0,signal:null},controllers:[controller]};
 assert.equal(verifyOwnedProbeExit(input,pid=>{if(pid===111)return;return absent();}),false,'still-live controller cannot be archived after emitting closure');
 assert.equal(verifyOwnedProbeExit(input,pid=>{if(pid===111)throw Object.assign(Error('unknown'),{code:'EPERM'});return absent();}),false);
 assert.equal(verifyOwnedProbeExit(input,absent),true);
});

test('duplicate or ambiguous controller births never reuse a death or normal certificate',()=>{
 const {controller,input}=restartFixture();
 assert.equal(verifyOwnedProbeExit({...input,controllers:[controller,{...controller}]},absent),false,'one death proof cannot close two launches with the same numeric PID');
 assert.equal(verifyOwnedProbeExit({...input,controllers:[{...controller,identityAmbiguous:true}]},absent),false);
 const closed={...controller,identityAmbiguous:true,closed:{controllerPid:111,ownedProcessesExited:true,ownedHosts:[]},hostPids:new Set()};
 assert.equal(verifyOwnedProbeExit({...input,controllers:[closed]},absent),false,'a later closure cannot erase a reused-PID marker');
});

test('external certificate binds the trusted complete birth identity, inventory and actor scope',()=>{
 for(const mutate of [
  c=>delete c.restartOwnership,
  c=>c.restartOwnership.controller.startToken='replacement-controller',
  c=>c.restartOwnership.controller.pgid=101,
  c=>c.restartOwnership.launcher.startToken='replacement-launcher',
  c=>c.restartOwnership.actorId='another-actor',
  c=>c.restartOwnership.setupId='another-setup',
  c=>c.restartOwnership.worldId='another-world',
  c=>c.restartOwnership.soulId='another-soul',
  c=>c.restartOwnership.groups[0].members[1].startToken='replacement-child',
  c=>c.restartOwnership.groups[0].members.pop(),
 ]){
  const {controller,input}=restartFixture();mutate(controller);assert.equal(verifyOwnedProbeExit(input,absent),false);
 }
 for(const key of ['actor','setupId','worldId','soulId']){const {input,proof}=restartFixture();proof[key]='other';assert.equal(verifyOwnedProbeExit(input,absent),false);}
});

test('external ownership must be a bounded complete ancestry graph even when expected data agrees',()=>{
 for(const mutate of [
  o=>o.groups[0].members[0].ppid=999,
  o=>o.groups[0].members[0].ppid=223,
  o=>o.groups[0].members.push({...o.groups[0].members[0]}),
  o=>o.groups[0].pgid=o.launcher.pgid,
  o=>delete o.controller.startToken,
  o=>o.controller.startToken='bad\nidentity',
  o=>o.evidence=[],
  o=>o.groups[0].members=Array.from({length:129},(_,i)=>({pid:300+i,ppid:111,pgid:222,startToken:'child-'+i})),
 ]){
  const {controller,proof,input}=restartFixture();mutate(proof.oldOwnership);controller.restartOwnership=structuredClone(proof.oldOwnership);assert.equal(verifyOwnedProbeExit(input,absent),false);
 }
 const {controller,proof,input}=restartFixture();proof.oldOwnership.groups[0].members.reverse();assert.equal(verifyOwnedProbeExit(input,absent),true,'inventory ordering is not process identity');assert.equal(controller.closed,null);
});
