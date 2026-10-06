import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test/native-owner-fixture.ts';
import {installEdenSteeringModeV1} from './eden-steering-mode.ts';
const registered={closedGoalsV1:true,registeredActivitiesV1:true};
test('recall-aware keeper refuses missing voluntary-contribution policy without appending',async t=>{
 const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
 for(const promise of [f.host.enableIntentExecutionRetentionV1(),f.host.enableIntentNativeSequenceCompletionV1(),f.host.enableIntentHumanSleepTransitionV1(),f.host.enableIntentPurposeEvidenceV1()]){f.host.drainInputs();await promise;}const recall=f.host.enableIntentPurposeRecallV1();f.host.drainInputs();await recall;
 const before=JSON.stringify(f.db.events(f.host.worldId)),hash=f.host.engine.stateHash();await assert.rejects(()=>installEdenSteeringModeV1(f.host,registered,true),/retained-execution-policy-required/);assert.equal(f.host.extra.intentRetainedChoiceV1,undefined);assert.equal(JSON.stringify(f.db.events(f.host.worldId)),before);assert.equal(f.host.engine.stateHash(),hash);
});
test('evidence-aware keeper cannot silently install bounded-recall choice policy',async t=>{
 const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
 for(const promise of [f.host.enableIntentExecutionRetentionV1(),f.host.enableIntentNativeSequenceCompletionV1(),f.host.enableIntentHumanSleepTransitionV1(),f.host.enableIntentPurposeEvidenceV1()]){f.host.drainInputs();await promise;}
 const before=JSON.stringify(f.db.events(f.host.worldId)),hash=f.host.engine.stateHash();await assert.rejects(()=>installEdenSteeringModeV1(f.host,registered,true),/retained-execution-policy-required/);assert.equal(f.host.extra.intentPurposeRecallV1,undefined);assert.equal(JSON.stringify(f.db.events(f.host.worldId)),before);assert.equal(f.host.engine.stateHash(),hash);
});
test('older safe-sleep keeper refuses missing private context policy without appending',async t=>{
 const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
 for(const promise of [f.host.enableIntentExecutionRetentionV1(),f.host.enableIntentNativeSequenceCompletionV1(),f.host.enableIntentHumanSleepTransitionV1()]){f.host.drainInputs();await promise;}
 const before=JSON.stringify(f.db.events(f.host.worldId)),hash=f.host.engine.stateHash();await assert.rejects(()=>installEdenSteeringModeV1(f.host,registered,true),/retained-execution-policy-required/);assert.equal(f.host.extra.intentPurposeEvidenceV1,undefined);assert.equal(JSON.stringify(f.db.events(f.host.worldId)),before);assert.equal(f.host.engine.stateHash(),hash);
});
test('older completion-aware keeper cannot silently adopt safe-sleep semantics',async t=>{
 const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
 for(const promise of [f.host.enableIntentExecutionRetentionV1(),f.host.enableIntentNativeSequenceCompletionV1()]){f.host.drainInputs();await promise;}
 const before=JSON.stringify(f.db.events(f.host.worldId)),hash=f.host.engine.stateHash();
 await assert.rejects(()=>installEdenSteeringModeV1(f.host,registered,true),/retained-execution-policy-required/);
 assert.equal(f.host.extra.intentHumanSleepTransitionV1,undefined);assert.equal(JSON.stringify(f.db.events(f.host.worldId)),before);assert.equal(f.host.engine.stateHash(),hash);
});
test('execution-only historical keeper refuses new completion semantics before any append',async t=>{
 const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
 const install=f.host.enableIntentExecutionRetentionV1();f.host.drainInputs();await install;
 const before=JSON.stringify(f.db.events(f.host.worldId)),hash=f.host.engine.stateHash();
 await assert.rejects(()=>installEdenSteeringModeV1(f.host,registered,true),/retained-execution-policy-required/);
 assert.equal(f.host.extra.intentExecutionRetentionV1,true);
 assert.equal(f.host.extra.intentNativeSequenceCompletionV1,undefined);
 assert.equal(JSON.stringify(f.db.events(f.host.worldId)),before);assert.equal(f.host.engine.stateHash(),hash);
});
test('retained reader refuses a missing execution policy without appending or changing state',async t=>{const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});const before=JSON.stringify(f.db.events(f.host.worldId)),hash=f.host.engine.stateHash();await assert.rejects(()=>installEdenSteeringModeV1(f.host,registered,true),/retained-execution-policy-required/);assert.equal(JSON.stringify(f.db.events(f.host.worldId)),before);assert.equal(f.host.engine.stateHash(),hash);assert.equal(f.host.extra.intentExecutionRetentionV1,undefined);});
test('ordinary mode records policy once and retained reader keeps that exact policy without duplicate facts',async t=>{const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await installEdenSteeringModeV1(f.host,registered);assert.equal(f.host.extra.intentExecutionRetentionV1,true);const prefix=JSON.stringify(f.db.events(f.host.worldId)),hash=f.host.engine.stateHash();await installEdenSteeringModeV1(f.host,registered,true);await installEdenSteeringModeV1(f.host,registered);assert.equal(JSON.stringify(f.db.events(f.host.worldId)),prefix);assert.equal(f.host.engine.stateHash(),hash);});
