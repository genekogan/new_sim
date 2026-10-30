import test from 'node:test';
import assert from 'node:assert/strict';
import {reportArmDimensions} from './arm-score.mjs';
const scope={actor:'reader-b',setupId:'run-1',worldId:'world-1',soulId:'s_b'};
const score={schema:'continuity-score/1',scenarioId:'eden-reading-duo',status:'unknown',rows:[{id:'native-hold',status:'pass'},{id:'notification:c_1:visible-response',status:'pass'},{id:'notification:c_1:receive',status:'unknown'},{id:'notification:c_1:host-delivery',status:'unknown'},{id:'disturbance:controller-restart',status:'unknown'},{id:'whole-controller-recovery',status:'unknown'}]};
test('baseline unsupported client stages do not hide native behavior or manufacture restart success',()=>{
 const r=reportArmDimensions({score,arm:'existing-headless-seat'});
 assert.equal(r.commonBehavior.status,'pass');assert.equal(r.clientIntake.status,'unsupported');assert.equal(r.automaticRestart.status,'fail');assert.equal(r.automaticRestart.triggerExercised,false);assert.equal(r.realizedRestart.status,'unknown');assert.equal(r.originalStatus,'unknown');assert.equal(r.qualification,'not assessed');assert.equal(score.rows.length,6);
 const failed=structuredClone(score);failed.rows[1].status='fail';assert.equal(reportArmDimensions({score:failed,arm:'existing-headless-seat'}).commonBehavior.status,'fail');
});
test('managed stages remain required and readiness cannot imply native completion',()=>{
 const r=reportArmDimensions({score,arm:'managed-continuity-runtime',expectedRestart:scope,restartEvidence:['restart-proof.json'],restartObservation:{...scope,schema:'sim-continuity-managed-restart/1',state:'ready',triggerExercised:true,threadResumed:true,recoveryLatencyMs:12000}});
 assert.equal(reportArmDimensions({score,arm:'managed-continuity-runtime',restartObservation:{...scope,schema:'sim-continuity-managed-restart/1',state:'ready',triggerExercised:true,threadResumed:true,recoveryLatencyMs:12000}}).automaticRestart.status,'unknown');
 assert.equal(r.clientIntake.status,'unknown');assert.equal(r.automaticRestart.status,'pass');assert.equal(r.realizedRestart.status,'unknown');assert.equal(r.qualification,'not assessed');
 for(const change of [{threadResumed:false},{triggerExercised:false},{state:'unexercised'}])assert.equal(reportArmDimensions({score,arm:'managed-continuity-runtime',expectedRestart:scope,restartEvidence:['restart-proof.json'],restartObservation:{...scope,schema:'sim-continuity-managed-restart/1',state:'ready',triggerExercised:true,threadResumed:true,recoveryLatencyMs:12000,...change}}).automaticRestart.status,'unknown');
});
test('per-recipient duplicate row IDs stay distinct; unknown arms and invalid statuses are refused',()=>{
 assert.throws(()=>reportArmDimensions({score,arm:'invented'}));
 const duplicated=reportArmDimensions({score:{...score,rows:[...score.rows,score.rows[0]]},arm:'managed-continuity-runtime'});assert.deepEqual(duplicated.commonBehavior.rows,[{id:'native-hold',rowIndex:0},{id:'notification:c_1:visible-response',rowIndex:1},{id:'native-hold',rowIndex:6}]);
 assert.throws(()=>reportArmDimensions({score:{...score,rows:[{id:'x',status:'unsupported'}]},arm:'managed-continuity-runtime'}));
});

test('cited measured lateness and explicit failure outrank ready labels',()=>{
 for(const change of [{recoveryLatencyMs:26000},{recoveryLatencyMs:-1},{failure:{status:'fail',code:'RESTART_STARTUP_PROOF_CONTRADICTION'}}]){
  const r=reportArmDimensions({score,arm:'managed-continuity-runtime',expectedRestart:scope,restartEvidence:['restart-proof.json'],restartObservation:{...scope,schema:'sim-continuity-managed-restart/1',state:'ready',triggerExercised:true,threadResumed:true,recoveryLatencyMs:12000,...change}});assert.equal(r.automaticRestart.status,'fail');
 }
});

test('a valid cited restart for another run or Soul cannot supply this target readiness',()=>{
 const observation={...scope,schema:'sim-continuity-managed-restart/1',state:'ready',triggerExercised:true,threadResumed:true,recoveryLatencyMs:12000};
 for(const expectedRestart of [null,{...scope,actor:'reader-a'},{...scope,setupId:'run-2'},{...scope,worldId:'world-2'},{...scope,soulId:'s_other'}])assert.equal(reportArmDimensions({score,arm:'managed-continuity-runtime',expectedRestart,restartEvidence:['restart-proof.json'],restartObservation:observation}).automaticRestart.status,'unknown');
});

 test('runner integration failure cannot inherit raw observer readiness',()=>{
 const observation={...scope,schema:'sim-continuity-managed-restart/1',state:'ready',triggerExercised:true,threadResumed:true,recoveryLatencyMs:12000};
 for(const integration of [{status:'unknown',failureCode:'RESTART_EVIDENCE_UNKNOWN'},null,{status:'ready'}]){
 const r=reportArmDimensions({score,arm:'managed-continuity-runtime',expectedRestart:scope,restartEvidence:['restart-proof.json'],restartObservation:{...observation,integration}});
 assert.equal(r.automaticRestart.status,integration?.status==='ready'?'pass':'unknown');
 }
});
