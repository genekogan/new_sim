import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJournal} from './journal.mjs';
import {main,claimStartupLease} from './run.mjs';
test('different task-state directories cannot start two controllers for the same paired folder',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'sim-run-'));
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:1/w/test',soul:'test-soul',token:'synthetic-test-only'}),{mode:0o600});
 const lock=openJournal(join(folder,'.soul-runtime-owner'),{worldId:'test-world',soulId:'test-soul'}),owner=lock.control.claim();t.after(()=>{lock.control.release(owner);lock.close();rmSync(folder,{recursive:true,force:true});});
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({worldId:'test-world'});t.after(()=>{globalThis.fetch=original;});
 await assert.rejects(main(['--folder',folder,'--state',join(folder,'different-state'),'--seconds','1'],{leaseWaitMs:20}),{code:'CONTROLLER_BUSY_TIMEOUT'});
 lock.control.assertOwner(owner);assert.equal(existsSync(join(folder,'different-state','host')),false);
 assert.equal(JSON.parse(readFileSync(join(folder,'different-state','status.json'),'utf8')).state,'blocked');
});
test('startup waits for an abandoned lease to expire before acquiring the next generation',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-startup-'));let time=1000;
 const journal=openJournal(directory,{worldId:'w',soulId:'s',now:()=>time});t.after(()=>{journal.close();rmSync(directory,{recursive:true,force:true});});
 const old=journal.control.claim('dead',1000),waits=[];
 const owner=await claimStartupLease(journal.control,{now:()=>time,maxWaitMs:2000,sleep:async ms=>{time+=ms;},onWait:s=>waits.push(s)});
 assert.equal(time,old.expiresAt);assert.equal(owner.generation,old.generation+1);journal.control.assertOwner(owner);assert.equal(waits.length,1);
});
test('startup retry is bounded while an existing controller continues renewing',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-startup-'));let time=1000;
 const journal=openJournal(directory,{worldId:'w',soulId:'s',now:()=>time});t.after(()=>{journal.close();rmSync(directory,{recursive:true,force:true});});
 let owner=journal.control.claim('live',1000);
 await assert.rejects(claimStartupLease(journal.control,{now:()=>time,maxWaitMs:2000,sleep:async ms=>{time+=ms;owner=journal.control.renew(owner,1000);}}),{code:'CONTROLLER_BUSY_TIMEOUT'});
 assert.equal(time,3000);journal.control.assertOwner(owner);assert.equal(owner.generation,1);
});
test('abort during startup lease waiting closes setup and leaves the live owner untouched',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'sim-run-')),state=join(folder,'different-state');
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:1/w/test',soul:'test-soul',token:'synthetic-test-only'}),{mode:0o600});
 const lock=openJournal(join(folder,'.soul-runtime-owner'),{worldId:'test-world',soulId:'test-soul'}),owner=lock.control.claim();t.after(()=>{lock.control.release(owner);lock.close();rmSync(folder,{recursive:true,force:true});});
 const stop=new AbortController(),original=globalThis.fetch;let timer;
 globalThis.fetch=async()=>{timer=setTimeout(()=>stop.abort(),10);return Response.json({worldId:'test-world'});};t.after(()=>{clearTimeout(timer);globalThis.fetch=original;});
 const listeners=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s));
 await main(['--folder',folder,'--state',state],{signal:stop.signal});
 assert.equal(stop.signal.aborted,true);lock.control.assertOwner(owner);assert.equal(existsSync(join(state,'host')),false);
 assert.equal(JSON.parse(readFileSync(join(state,'status.json'),'utf8')).state,'stopped');
 assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),listeners);
 const reopened=openJournal(state,{worldId:'test-world',soulId:'test-soul'});reopened.close();
});
test('startup setup failure removes signal handlers and releases an acquired ownership lease',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'sim-run-')),state=join(folder,'state');
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:1/w/test',soul:'test-soul',token:'synthetic-test-only'}),{mode:0o600});
 const journal=openJournal(state,{worldId:'test-world',soulId:'test-soul'});journal.close();writeFileSync(join(state,'host'),'not a directory');
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({worldId:'test-world'});t.after(()=>{globalThis.fetch=original;rmSync(folder,{recursive:true,force:true});});
 const listeners=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s));
 await assert.rejects(main(['--folder',folder,'--state',state]),{code:'EEXIST'});
 assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),listeners);
 const ownership=openJournal(join(folder,'.soul-runtime-owner'),{worldId:'test-world',soulId:'test-soul'}),owner=ownership.control.claim('after-failure');ownership.control.release(owner);ownership.close();
});
