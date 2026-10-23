// ACCEPT2 (2026-10-23) classes 1 + 2. Owner > self: a later owner request pre-empts whatever the Soul is doing (an
// owner-asked nap or stroll, its own read/sit/lift) instead of being refused locally `protected-action` /
// "local protected step requires explicit owner force". The server still refuses hard physical holds honestly.
// First names: "wave to Wren" finds "Wren Halloway" when that first name is unique; ambiguous ones list full names.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openClientQueue} from './client-queue.mjs';import {executeReplySteps,bindLiveSoulReferences} from './client-execution.mjs';import {resolveSoulReferences} from './client-soul-references.mjs';
const ctx={placeId:'land-park',busy:null};
function world(t){
 const dir=mkdtempSync(join(tmpdir(),'owner-first-')),sent=[],receipts=new Map();let n=0;
 const runPublic=async()=>({accepted:true,line:'said'});
 const queue=openClientQueue(dir,{scope:'world|s_soul',adapter:{
  async send(body){sent.push(body.capability);const id='r_'+(++n);const r={id,capability:body.capability,phase:'started'};receipts.set(id,r);return {accepted:true,receipt:r};},
  readReceipt:async id=>receipts.get(id),runPublic}});
 t.after(()=>{queue.close();rmSync(dir,{recursive:true,force:true});});
 const run=(steps,o,context=ctx)=>executeReplySteps(steps,{queue,pump:()=>queue.pump(context),runPublic,...o});
 return {queue,sent,run};
}
test('A13->A19: a later owner request pre-empts the owner-asked (protected) nap without --force',async t=>{
 const w=world(t);await w.run([{act:'nap:here',protected:true}],{id:'req-nap',source:'owner',replace:true});
 const nap=w.queue.snapshot().steps[0];assert.equal(nap.status,'running');
 const r=await w.run([{act:'pushups:here'}],{id:'req-pushups',source:'owner',replace:true,force:false},{...ctx,busy:{id:nap.receiptId,capability:'nap:here'}});
 assert.ok(r.results.every(x=>x.accepted!==false),r.results.map(x=>x.line).join(' | '));
 assert.deepEqual(w.sent,['nap:here','pushups:here']);assert.equal(w.queue.snapshot().steps[0].status,'running');
});
test('C2: the Soul\'s own read running outside the owner queue never blocks a new owner request',async t=>{
 const w=world(t);
 const r=await w.run([{act:'pushups:here'}],{id:'req-exercise',source:'owner',replace:true},{...ctx,busy:{id:'r_own_read',capability:'read:here'}});
 assert.ok(r.results.every(x=>x.accepted!==false),r.results.map(x=>x.line).join(' | '));
 assert.deepEqual(w.sent,['pushups:here']);assert.notEqual(w.queue.snapshot().steps[0].status,'blocked');
});
test('A6: an earlier owner stroll whose queue step already finished locally does not block the next owner request',async t=>{
 const w=world(t);await w.run([{act:'stroll:land-park'}],{id:'req-stroll',source:'owner',replace:true});
 const stroll=w.queue.snapshot().steps[0];w.queue.snapshot();
 // the stroll is still the body's current activity on the server; the next owner request arrives
 const r=await w.run([{act:'ride:balloon'}],{id:'req-balloon',source:'owner',replace:true},{...ctx,busy:{id:stroll.receiptId,capability:'stroll:land-park'}});
 assert.ok(r.results.every(x=>x.accepted!==false));assert.deepEqual(w.sent,['stroll:land-park','ride:balloon']);
});
test('self stays below owner: the Soul\'s own whim is still held back by its current activity',async t=>{
 const w=world(t);await w.run([{act:'sit:here'}],{id:'wake-1',source:'mind'},{...ctx,busy:{id:'r_owner_nap',capability:'nap:here'}});
 assert.deepEqual(w.sent,[]);assert.equal(w.queue.snapshot().steps[0].status,'blocked');
});
const rows=[{id:'s_wren',name:'Wren Halloway'},{id:'s_adam',name:'Adam'},{id:'s_sage',name:'Sage Ito'},{id:'s_sage2',name:'Sage Morrow'}];
const resolve=refs=>resolveSoulReferences(refs,{worldId:'w',rosters:[{worldId:'w',kind:'perceived',rows}]});
const bind=(refs,ownerText)=>bindLiveSoulReferences(refs,{ownerText,resolve,social:true});
test('B6: "wave to Wren" binds Wren Halloway, whether the model passes the full name, the ID or the first name',()=>{
 for(const ref of ['Wren Halloway','s_wren','Wren']){const r=bind([ref],'wave to Wren');assert.equal(r.ok,true,ref+' '+JSON.stringify(r));assert.equal(r.chosen[0].id,'s_wren');}
 assert.equal(bind(['Wren Halloway'],'walk with wren to the fire').ok,true,'case-insensitive first name');
});
test('ambiguous first names ask with the full names; a different surname never binds',()=>{
 const r=bind(['Sage'],'wave to Sage');assert.equal(r.ok,false);assert.equal(r.code,'soul.name-ambiguous');
 assert.deepEqual(r.did_you_mean.map(x=>x.label).sort(),['Sage Ito','Sage Morrow']);
 const s=bind(['Sage Ito'],'wave to Sage');assert.equal(s.ok,false);assert.equal(s.code,'soul.name-ambiguous');
 assert.equal(bind(['Wren Halloway'],'wave to Wren Other').ok,false,'Wren Other is someone else');
 assert.equal(bind(['Wren Halloway'],'wave to Adam').ok,false,'nobody named Wren was asked for');
});
