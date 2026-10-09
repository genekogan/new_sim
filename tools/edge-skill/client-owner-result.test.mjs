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
