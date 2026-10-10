import test from 'node:test';
import assert from 'node:assert/strict';
import {completedOwnerResult} from './client-owner-result.mjs';
test('initial walking acknowledgement is historical; completed sit and fresh body become the final owner answer without a model call',()=>{
 const initial={id:'req',t:'2026-10-09T12:00:00Z',answer:'I am walking to tea.',receipt:'r-walk'},queue={id:'req',steps:[{act:'walk:tea',status:'completed',receiptId:'r-walk',receipt:{id:'r-walk',phase:'completed',capability:'walk:tea'}},{act:'sit:here',status:'completed',receiptId:'r-sit',receipt:{id:'r-sit',phase:'completed',capability:'sit:here',endedAt:{place:'tea'}}}]};
 const result=completedOwnerResult(initial,queue,{at:'2026-10-09T12:03:00Z',here:{tick:50,me:{place:'tea',placePath:['Tea house'],posture:'standing',activity:{kind:'idle'},pos:[1,2]}}});assert.equal(result.answerSource,'queue-and-receipt-evidence');assert.equal(result.initialAnswer.text,'I am walking to tea.');assert.equal(result.initialAnswer.at,initial.t);assert.ok(!result.answer.includes('I am walking'));assert.match(result.answer,/Finished 2 ordered steps/);assert.match(result.answer,/standing \(idle\) at tea/);assert.equal(result.receipt,'r-sit');assert.equal(result.finalReceipt.phase,'completed');assert.equal(result.finalObservation.place,'tea');assert.throws(()=>completedOwnerResult(initial,{steps:[{status:'running'}]}),/not actually complete/);
});
test('an elapsed conditional step is reported as skipped while the last physical receipt keeps its actual phase',()=>{
 const q={steps:[{act:'walk:tea',status:'completed',receiptId:'r',receipt:{id:'r',capability:'walk:tea',phase:'completed'}},{act:'sit:here',status:'skipped',reason:'World deadline elapsed before activity start'}]};
 const result=completedOwnerResult({answer:'I will sit.'},q);
 assert.match(result.answer,/sit:here: skipped.*deadline elapsed/);
 assert.equal(result.results[1],'sit:here: skipped');
 assert.equal(result.finalReceipt.id,'r');
 const hold=completedOwnerResult({}, {steps:[{act:'sit:here',status:'completed',receiptId:'hold',receipt:{id:'hold',capability:'sit:here',phase:'replaced'}}]});
 assert.match(hold.answer,/native replaced/);assert.equal(hold.finalReceipt.phase,'replaced');
});

test('actual sit refusal followed by lie completion reports facts without proving the original owner intent',()=>{
 const q={id:'owner',source:'owner',steps:[{id:'lie-fix',act:'lie:here',params:{},status:'completed',receiptId:'r-lie',receipt:{id:'r-lie',capability:'lie:here',phase:'completed',endedAt:{place:'tables'},outcome:{summary:'lie completed at tables.'}}}],repairs:[{failedStep:{id:'sit-original',act:'sit down',params:{seconds:30},status:'failed',code:'slot.none-free'},replacementStepId:'lie-fix'}]};
 const r=completedOwnerResult({id:'owner',text:'Sit for 30 seconds.',answer:'Finished.'},q);
 assert.equal(r.queueComplete,true);assert.equal(r.ownerIntentFulfillment.status,'unproven');
 assert.deepEqual(r.repairs[0].failedParams,{seconds:30});assert.equal(r.repairs[0].replacement.act,'lie:here');assert.equal(r.repairs[0].replacement.phase,'completed');
 assert.match(r.answer,/original owner intent is unproven/i);assert.match(r.answer,/sit down.*seconds.*30.*lie:here.*completed/);
 assert.ok(!r.answer.startsWith('Finished'),'repaired execution must not imply the original request was fulfilled');
});

test('legitimate offered-ID correction remains completed evidence, not an automatic intent failure',()=>{
 const q={id:'owner',source:'owner',steps:[{id:'sit-fix',act:'sit:offered-bench',params:{seconds:30},status:'completed',receiptId:'r-sit',receipt:{id:'r-sit',capability:'sit:offered-bench',phase:'completed',outcome:{summary:'Completed a 30-second sit.'}}}],repairs:[{failedStep:{id:'original',act:'sit on the offered bench',params:{seconds:30},code:'capability.unknown'},replacementStepId:'sit-fix'}]};
 const r=completedOwnerResult({id:'owner',text:'Sit on the offered bench for 30 seconds.'},q);
 assert.equal(r.queueComplete,true);assert.equal(r.repairs[0].replacement.phase,'completed');assert.deepEqual(r.repairs[0].replacement.params,{seconds:30});
 assert.equal(r.ownerIntentFulfillment.status,'unproven');assert.notEqual(r.ownerIntentFulfillment.status,'failed');assert.match(r.results[0],/Completed a 30-second sit/);
 assert.match(r.answer,/semantic judgment/,'code cannot resolve arbitrary original wording from an offered ID alone');
});

test('successive repairs retain intermediate refused replacements separately from the actual terminal replacement',()=>{
 const q={id:'owner',steps:[{id:'lie',act:'lie:here',status:'completed',receiptId:'r',receipt:{id:'r',phase:'completed',capability:'lie:here'}}],repairs:[{failedStep:{id:'sit1',act:'sit down',params:{seconds:30},code:'slot.none-free'},replacementStepId:'sit2'},{failedStep:{id:'sit2',act:'sit:here',params:{},status:'failed',code:'slot.none-free'},replacementStepId:'lie'}]};
 const r=completedOwnerResult({id:'owner'},q);
 assert.equal(r.repairs[0].replacement.act,'sit:here');assert.equal(r.repairs[0].replacement.status,'failed');assert.equal(r.repairs[0].receiptId,null);
 assert.equal(r.repairs[1].replacement.act,'lie:here');assert.equal(r.repairs[1].receiptId,'r');assert.match(r.answer,/sit:here.*failed/);
});
