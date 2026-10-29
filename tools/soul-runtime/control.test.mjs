import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'sim-control-'));let time=1000;const handles=[];t.after(()=>{for(const h of handles)h.close();rmSync(directory,{recursive:true,force:true})});return {advance(ms){time+=ms},open(){const j=openJournal(directory,{worldId:'w',soulId:'s',now:()=>time});handles.push(j);return j.control;}};}
test('expired owner cannot renew, write checkpoint or release a successor',t=>{
 const f=fixture(t),a=f.open(),b=f.open(),old=a.claim('old',1000);assert.throws(()=>b.claim('other'),/already active/);f.advance(1001);const fresh=b.claim('new');assert.equal(fresh.generation,2);assert.throws(()=>a.renew(old),/lease lost/);assert.throws(()=>a.save(old,0,{}),/lease lost/);assert.throws(()=>a.release(old),/lease lost/);b.assertOwner(fresh);
});
test('checkpoint survives connection restart with constraints and suspended task intact',t=>{
 const f=fixture(t),a=f.open(),owner=a.claim('one');const state={intent:'Attend reading',constraints:['return book'],suspended:[{intent:'Talk briefly'}],threadId:'thread-1',next:'read'};a.save(owner,0,state);a.release(owner);const b=f.open(),next=b.claim('two');assert.deepEqual(b.checkpoint().value,state);assert.throws(()=>b.save(next,0,{next:'wrong'}),/revision/);assert.equal(b.save(next,1,{...state,next:'return book'}),2);
});
test('restart after dispatch cannot replay or bypass an uncertain public effect',t=>{
 const f=fixture(t),a=f.open(),owner=a.claim('one',1000);a.prepare(owner,'op-1',{method:'say',text:'Hello'});a.dispatch(owner,'op-1');f.advance(1001);const b=f.open(),next=b.claim('two');assert.equal(b.operations()[0].status,'dispatching');assert.throws(()=>b.dispatch(next,'op-1'),/not safely/);assert.throws(()=>b.prepare(next,'op-2',{method:'say',text:'again'}),/reconciliation/);assert.throws(()=>a.settle(owner,'op-1',{ok:true}),/lease lost/);b.settle(next,'op-1',{confirmed:true,evidence:'existing server idempotency response'});assert.equal(b.prepare(next,'op-2',{method:'say',text:'new'}).status,'prepared');
});
test('stable operation identity rejects changed payload and concurrent reserved dispatch',t=>{
 const a=fixture(t).open(),owner=a.claim('one');a.prepare(owner,'op-1',{method:'act',capability:'sit:chair'});assert.throws(()=>a.prepare(owner,'op-1',{method:'act',capability:'stand:here'}),/reused/);a.prepare(owner,'op-2',{method:'say'});a.dispatch(owner,'op-1');assert.throws(()=>a.dispatch(owner,'op-2'),/requires reconciliation/);a.uncertain(owner,'op-1');assert.equal(a.operation('op-1').status,'uncertain');
});
