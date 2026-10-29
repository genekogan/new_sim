import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {probeSessions} from './probe-sessions.mjs';

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
