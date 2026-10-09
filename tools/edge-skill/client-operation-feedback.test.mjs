import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalOperationFeedback,rememberSelector} from './client-operation-feedback.mjs';
test('refused selector writes expose flat schema without altering or coercing judgments',()=>{
 const input={goal:{horizon:'today',metric:'placeholder',next:'placeholder'}},original=structuredClone(input),feedback=openLocalOperationFeedback();feedback.record({operation:'remember',accepted:false,reason:'memory: invalid bounded text',selector:rememberSelector(input)});assert.deepEqual(input,original);const context=feedback.context();assert.match(context,/local\.remember-refused/);assert.match(context,/goal:string/);assert.match(context,/no nested goal object/);assert.match(context,/Exactly one selector/);assert.match(context,/place:string.*note:string/);
});
test('current schedule ID feedback updates with actual state, not stale cached IDs',()=>{
 const feedback=openLocalOperationFeedback();feedback.record({operation:'compile',accepted:false,reason:'unknown schedule binding'});assert.match(feedback.context([{id:'routine:old'}]),/routine:old/);const current=feedback.context([{id:'routine:new'}]);assert.match(current,/routine:new/);assert.doesNotMatch(current,/routine:old/);assert.match(current,/compilation is not execution/);
});
test('repeated errors stay bounded and persisted verdicts strip arbitrary payloads',()=>{
 let saved;const feedback=openLocalOperationFeedback({initial:[{operation:'shell',accepted:true,token:'secret'}],onChange:rows=>saved=rows});for(let i=0;i<1000;i++)feedback.record({operation:'remember',accepted:false,selector:'place',reason:'x'.repeat(500),token:'secret',payload:{private:'unrelated'}});assert.equal(saved.length,6);assert.ok(saved.every(r=>r.reason.length===240));assert.doesNotMatch(feedback.context(),/secret|unrelated|payload|token/);const copy=feedback.snapshot();copy[0].reason='changed';assert.equal(feedback.snapshot()[0].reason.length,240);assert.equal(openLocalOperationFeedback({initial:saved}).snapshot().length,6);assert.throws(()=>feedback.record({operation:'shell',accepted:true}));
});
test('saved and refused results remain distinct and omitted current IDs are explicit',()=>{
 const feedback=openLocalOperationFeedback();feedback.record({operation:'compile',accepted:false,reason:'unknown schedule binding'});feedback.record({operation:'compile',accepted:true,reason:'Bindings saved; they have not run.'});const context=feedback.context(Array.from({length:20},(_,i)=>({id:'routine:'+i})));assert.match(context,/local\.compile-refused/);assert.match(context,/local\.compile-saved/);assert.match(context,/"omittedIDs":12/);assert.match(context,/have not run/);
});
