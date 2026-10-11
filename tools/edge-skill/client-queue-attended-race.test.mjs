import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openClientQueue} from './client-queue.mjs';
function fixture(t){const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-attended-race-')),path=join(root,'mind.json');t.after(()=>rmSync(root,{recursive:true,force:true}));const hold=()=>writeFileSync(path,JSON.stringify({mode:'attended',leaseUntil:new Date(Date.now()+60000).toISOString()})),release=()=>writeFileSync(path,JSON.stringify({mode:'unattended'}));release();return {root,hold,release,isPaused:()=>{const l=JSON.parse(readFileSync(path,'utf8'));return l.mode==='attended'&&Date.parse(l.leaseUntil)>Date.now();}};}
test('attended takeover during awaited canonical receipt reconciles completed protected work but retains the next action unsent',async t=>{
 const f=fixture(t),sent=[],folded=[];let finishRead,enteredRead;
 const entered=new Promise(r=>enteredRead=r),q=openClientQueue(f.root,{scope:'fixture',isPaused:f.isPaused,onReceipt:r=>folded.push(r.id),adapter:{send:async body=>{sent.push(body);return {accepted:true,receipt:{id:'r'+sent.length,phase:'started'}};},readReceipt:()=>{enteredRead();return new Promise(r=>finishRead=r);},context:async()=>({busy:null})}});t.after(()=>q.close());
 q.enqueue([{act:'read:library',protected:true},{act:'walk:tea'}]);await q.pump();const pending=q.pump({},false);await entered;f.hold();finishRead({id:'r1',phase:'completed',outcome:{summary:'Canonical completed reading'}});await pending;
 assert.deepEqual(sent.map(b=>b.capability),['read:library']);assert.deepEqual(folded,['r1']);assert.equal(q.snapshot().steps[0].status,'completed');assert.equal(q.snapshot().steps[0].protected,true);assert.equal(q.snapshot().steps[1].status,'pending');assert.equal(q.snapshot().steps[1].attempts,0);
 f.release();await q.pump();assert.deepEqual(sent.map(b=>b.capability),['read:library','walk:tea']);assert.equal(q.snapshot().steps[1].attempts,1);
});
test('attended takeover during hold qualification dispatches neither native hold nor condition stop until explicit release',async t=>{
 const f=fixture(t),sent=[];let finishProfile,enteredProfile;
 const entered=new Promise(r=>enteredProfile=r),q=openClientQueue(f.root,{scope:'fixture',isPaused:f.isPaused,adapter:{send:async body=>{sent.push(body);return {accepted:true,receipt:{id:'r'+sent.length,phase:'started'}};},holdProfile:()=>{enteredProfile();return new Promise(r=>finishProfile=r);},readReceipt:async id=>({id,phase:'started'})}});t.after(()=>q.close());
 q.enqueue([{act:'read:library',until:{worldMinutes:200},protected:true}]);const pending=q.pump({worldMinutes:100},false);await entered;f.hold();finishProfile({seconds:60});await pending;assert.deepEqual(sent,[]);assert.equal(q.snapshot().steps[0].status,'pending');assert.equal(q.snapshot().steps[0].attempts,0);
 f.release();await q.pump({worldMinutes:100});assert.equal(sent.length,1);f.hold();await q.pump({worldMinutes:201},false);assert.equal(sent.length,1,'no stand/stop while attended');assert.equal(q.snapshot().steps[0].receiptId,'r1');
});
test('takeover at saved dispatch boundary rolls back unsent intent without false uncertainty or public effects',async t=>{
 const f=fixture(t),sent=[],said=[];let takeover=true;
 const q=openClientQueue(f.root,{scope:'fixture',isPaused:f.isPaused,onChange:state=>{if(takeover&&state.steps[0]?.status==='dispatching'){takeover=false;f.hold();}},adapter:{readReceipt:async id=>({id,phase:'completed'}),send:async body=>{sent.push(body);return {accepted:true,receipt:{id:'r1',phase:'started'}};},runPublic:async step=>{said.push(step);return {accepted:true};}}});t.after(()=>q.close());
 q.enqueue([{act:'walk:tea'}]);await q.pump();assert.equal(sent.length,0);assert.equal(q.snapshot().steps[0].status,'pending');assert.equal(q.snapshot().steps[0].attempts,0);assert.equal(Object.hasOwn(q.snapshot().steps[0],'clientRef'),false);
 f.release();await q.pump();assert.equal(sent.length,1);
 q.enqueue([{say:'Hello'}],{replace:true});takeover=true;await q.pump();assert.equal(said.length,0);assert.equal(q.snapshot().steps[0].status,'pending');f.release();await q.pump();assert.equal(said.length,1);
});
test('transport-adapter lease refusal restores unsent stable intent without falsely marking uncertain dispatch',async t=>{
 const {assertLiveDispatch}=await import('./client-dispatch-authority.mjs'),f=fixture(t),sent=[];
 const q=openClientQueue(f.root,{scope:'fixture',isPaused:f.isPaused,adapter:{send:async body=>{await Promise.resolve();f.hold();assertLiveDispatch(true,f.isPaused);sent.push(body);return {accepted:true,receipt:{id:'r1',phase:'started'}};}}});t.after(()=>q.close());q.enqueue([{act:'walk:tea'}]);await q.pump();assert.equal(sent.length,0);assert.equal(q.snapshot().steps[0].status,'pending');assert.equal(q.snapshot().steps[0].attempts,0);assert.equal(q.snapshot().notice,null);assert.equal(Object.hasOwn(q.snapshot().steps[0],'clientRef'),false);
});
