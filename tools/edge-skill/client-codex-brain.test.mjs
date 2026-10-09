import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexExecBrain,codexExecArgs} from './client-codex-brain.mjs';
function fixture(t,body){const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-fake-codex-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const exe=join(root,'fake-codex');writeFileSync(exe,`#!${process.execPath}\n${body}\n`);chmodSync(exe,0o700);return {root,exe};}
test('supported argv placement and exact thread resume retain usage, never credentials or last-thread shortcuts',async t=>{
 const f=fixture(t,`let x='';process.stdin.on('data',d=>x+=d);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"do":[]}'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:40,output_tokens:5}}));});`);
 const brain=codexExecBrain({model:'fixture',system:'Synthetic',executable:f.exe});t.after(()=>brain.close());await brain.ask('one');assert.equal(brain.id,'fixture-thread');const second=await brain.ask('two');assert.equal(second.usage.in,60);assert.equal(second.usage.read,40);assert.equal(second.billing.usd,null);
 const args=codexExecArgs({model:'fixture',resumeId:brain.id});assert.equal(args[args.indexOf('exec')+1],'resume');assert.ok(args.indexOf('--ignore-user-config')>args.indexOf('resume'));assert.ok(args.includes('shell_tool'));assert.ok(args.includes('--skip-git-repo-check'));assert.ok(codexExecArgs({model:'fixture'}).includes('--skip-git-repo-check'));assert.ok(!args.includes('--last'));assert.ok(!args.some(v=>v.includes('auth.json')));
});
test('unknown token usage stays null and unexpected tool items fail closed',async t=>{
 const empty=fixture(t,`process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"do":[]}'}})));`);
 const brain=codexExecBrain({model:'fixture',executable:empty.exe});t.after(()=>brain.close());const result=await brain.ask('one');assert.equal(result.usage.in,null);assert.equal(result.usage.out,null);
 const tool=fixture(t,`process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.started',item:{type:'command_execution',command:'never-run'}}));setTimeout(()=>{},10000);});`);
 const guarded=codexExecBrain({model:'fixture',executable:tool.exe});t.after(()=>guarded.close());await assert.rejects(guarded.ask('one'),/Unexpected.*command_execution/);
});
test('fresh supersedes old turn and byte/wall limits terminate the owned child',async t=>{
 const slow=fixture(t,`process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>console.log(JSON.stringify({type:'thread.started',thread_id:'late-old-thread'})),100));`);
 const brain=codexExecBrain({model:'fixture',executable:slow.exe,timeoutMs:500});t.after(()=>brain.close());const pending=brain.ask('one');brain.fresh();await assert.rejects(pending,/superseded/);await new Promise(r=>setTimeout(r,120));assert.equal(brain.id,null);
 const bounded=codexExecBrain({model:'fixture',executable:slow.exe,timeoutMs:30});t.after(()=>bounded.close());await assert.rejects(bounded.ask('one'),/wall deadline/);
 const large=fixture(t,`process.stdin.resume();process.stdin.on('end',()=>console.log('x'.repeat(2000)));`);const limited=codexExecBrain({model:'fixture',executable:large.exe,maxBytes:100});t.after(()=>limited.close());await assert.rejects(limited.ask('one'),/byte bound/);
});

test('owned model-process lifecycle reports PID/group/generation and close without auth or stdout',async t=>{
 const f=fixture(t,`process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"do":[]}'}})));`),events=[];const brain=codexExecBrain({model:'fixture',executable:f.exe,onProcess:e=>events.push(e)});t.after(()=>brain.close());await brain.ask('one');assert.equal(events[0].status,'started');assert.equal(events[1].status,'exited');assert.ok(Number.isSafeInteger(events[0].pid));assert.equal(events[0].pid,events[1].pid);if(process.platform!=='win32')assert.equal(events[0].pgid,events[0].pid);assert.equal(events[1].code,0);assert.ok(events.every(e=>Object.keys(e).every(k=>['pid','pgid','generation','session','status','code','signal'].includes(k))));
});
