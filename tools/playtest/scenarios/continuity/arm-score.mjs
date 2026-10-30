// Prospective reporting dimensions. Keep the original scorer and every row;
// unsupported client internals must not hide native behavior in either arm.
const ARMS=['existing-headless-seat','managed-continuity-runtime'];
const aggregate=rows=>!rows.length?'unknown':rows.some(r=>r.status==='fail')?'fail':rows.every(r=>r.status==='pass')?'pass':'unknown';
export function reportArmDimensions({score,arm,restartObservation=null,restartEvidence=[],expectedRestart=null}){
 if(!ARMS.includes(arm)||score?.schema!=='continuity-score/1'||!Array.isArray(score.rows)||score.rows.some(r=>typeof r.id!=='string'||!['pass','fail','unknown'].includes(r.status)))throw Error('Invalid arm score');
 const managed=arm===ARMS[1],client=[],restart=[],common=[];
 for(const [rowIndex,value] of score.rows.entries()){
  const r={...value,rowIndex};
  if(/^notification:.+:(receive|host-delivery)$/.test(r.id))client.push(r);
  else if(['disturbance:controller-restart','whole-controller-recovery'].includes(r.id))restart.push(r);
  else common.push(r);
 }
 const dimension=rows=>({status:aggregate(rows),rows:rows.map(r=>({id:r.id,rowIndex:r.rowIndex}))});
 let automatic={status:'not-applicable',triggerExercised:false};
 if(restart.length){
  if(!managed)automatic={status:'fail',supported:false,triggerExercised:false,reason:'The frozen one-exec baseline has no automatic controller restart. No death probe or assisted resume is inferred.'};
  else {
   const r=restartObservation,typed=r?.schema==='sim-continuity-managed-restart/1'&&['actor','setupId','worldId','soulId'].every(k=>typeof expectedRestart?.[k]==='string'&&expectedRestart[k].length>0&&r[k]===expectedRestart[k])&&Array.isArray(restartEvidence)&&restartEvidence.length>0&&restartEvidence.every(s=>typeof s==='string'&&s.trim());
   automatic={status:typed&&r.failure?.status==='fail'?'fail':typed&&r.state==='ready'&&r.triggerExercised===true&&r.threadResumed===true&&Number.isFinite(r.recoveryLatencyMs)?r.recoveryLatencyMs>=0&&r.recoveryLatencyMs<=25000?'pass':'fail':'unknown',triggerExercised:typed&&r.triggerExercised===true,evidence:typed?restartEvidence:[],reason:'Readiness is separate from retained intent, native task completion and duplicate-effect review.'};
  }
 }
 return {schema:'continuity-arm-dimensions/1',arm,scenarioId:score.scenarioId,originalStatus:score.status,
  commonBehavior:dimension(common),clientIntake:managed?dimension(client):{status:'unsupported',rows:client.map(r=>({id:r.id,rowIndex:r.rowIndex})),reason:'No managed journal/host-notification stages in the frozen one-exec baseline; native visible-response rows remain common.'},
  automaticRestart:automatic,realizedRestart:dimension(restart),
  qualification:'not assessed',limits:'Additive prospective report; original rows/status remain intact. Unsupported client internals are not passes. Baseline missing automatic restart remains an explicit capability failure. No trial replacement, source coverage or release acceptance inferred.'};
}
