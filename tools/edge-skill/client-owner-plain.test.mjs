// 1.9.10 (ACCEPT2 brief 8, 12 rows): owners were shown "Retained 1 ordered steps in queue req-...; actual receipt r_... is
// started". Bar: no req-/r_/"queue" tokens in any owner-facing answer; plain words from the same receipt facts.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {ownerPlainLine,ownerReplyWithLocalResults} from './client-owner-reply.mjs';import {completedOwnerResult} from './client-owner-result.mjs';
const JARGON=/\breq-|\br_[A-Za-z0-9]|\bqueue/i;
const retained='Retained 1 ordered steps in queue req-7f3a-01; actual receipt r_9c2e41 is started. Future steps are pending, not already accepted or completed.';
test('the retained-queue line becomes plain words that keep the receipt phase',()=>{
 assert.equal(ownerPlainLine(retained),"I've started it; it is under way.");
 const three=ownerPlainLine('Retained 3 ordered steps in queue req-x; physical admission not yet confirmed. Future steps are pending, not already accepted or completed.');
 assert.match(three,/first of 3 steps.*not begun yet.*rest follow in order/);assert.doesNotMatch(three,JARGON);
 assert.match(ownerPlainLine(retained.replace('is started','is completed')),/it is done/);
});
test('stray ids and the word queue never reach the owner; ordinary text is untouched',()=>{
 for(const l of ['walk:place_bakery: completed (receipt r_77)','Queue req-5 was replaced; queued 2 steps','I asked the queue for a nap (final receipt: r_ab12).'])assert.doesNotMatch(ownerPlainLine(l),JARGON,l);
 assert.equal(ownerPlainLine('Queue req-d8527a5d retained, but go play on the swings blocked: protected-action. Dependent public steps have not run.'),"I couldn't go play on the swings (protected action). Nothing after it ran.");
 assert.equal(ownerPlainLine('I sat on the bench by the pond.'),'I sat on the bench by the pond.');
 assert.equal(ownerPlainLine(null),null);
});
test('an execution verdict built from raw result lines reads plainly once passed through the owner seam',()=>{
 const raw=ownerReplyWithLocalResults({source:'execution-verdict',results:[retained,'walk:place_bakery: started (receipt r_1)']}).answer;
 assert.doesNotMatch(ownerPlainLine(raw),JARGON);
});
test('the finished-queue owner result carries no queue bookkeeping even when a step only has its retained line',()=>{
 const q={id:'req-7f3a-01',steps:[{act:'walk:tea',status:'completed',receiptId:'r_walk',receipt:{id:'r_walk',phase:'completed',capability:'walk:tea'}},{act:'say',publicStep:true,status:'completed',result:{line:retained}}]};
 const r=completedOwnerResult({id:'req-7f3a-01',answer:'Walking.'},q);assert.doesNotMatch(r.answer,JARGON,r.answer);assert.match(r.answer,/Finished 2 ordered steps/);
});
test('every owner-answer write in the CLI goes through the plain-words seam',()=>{
 const src=readFileSync(new URL('./eden-agent.mjs',import.meta.url),'utf8');
 assert.match(src,/answer:ownerPlainLine\(own\.answer\?\?null\)/);assert.match(src,/\?ownerPlainLine\(ownerAnswerText\(plan\.owner\)\):null/);assert.match(src,/answer:ownerPlainLine\(r\.answer\)/);
});

test('canonical waiting refusal failure and cancellation never claim an action started',()=>{
 for(const phase of ['waiting','refused','failed','cancelled','replaced']){
  const line=ownerPlainLine(retained.replace('is started','is '+phase));
  assert.doesNotMatch(line,/I(?:'ve| have)? started|I started/i,phase+': '+line);
  assert.doesNotMatch(line,/\breceipt\b|\bretained\b.*\bsteps?\b|\bqueue|\breq-|\br_[A-Za-z0-9]/i);
  assert.match(line,phase==='waiting'?/waiting|not begun/:new RegExp(phase==='refused'?'refused|couldn.t':phase));
 }
});
