// A coordinator's explicit qualification selection. No automatic retry or implicit reuse of old measurements.
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadRun} from '../../review/run.mjs';
import {sha256} from '../../lib/hash.mjs';
import {correctedScenario} from '../../review/rescore-qualified.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const key=r=>`${r.world}/${r.arm}/${r.repeat}`;
export function verifyRetained(ref,planned){
 const runDir=resolve(ref.runDir),rescoreDir=resolve(ref.rescoreDir),annotation=read(join(rescoreDir,'annotation.json'));
 if(!['control','treatment'].includes(ref.arm))throw Error('invalid retained arm');
 if(!ref.reason?.trim())throw Error('retained control requires coordinator reason');
 if(annotation.schema!=='qualified-rescore/1'||resolve(annotation.runDir)!==runDir||annotation.rawEvidenceModified!==false||annotation.deadlineChange!==0)throw Error('invalid corrected evidence annotation');
 const original=read(join(runDir,'scenario.json')),current=read(planned.scenario);
 if(annotation.originalScenarioSha256!==sha256(readFileSync(join(runDir,'scenario.json')))||annotation.originalOraclesSha256!==sha256(readFileSync(join(runDir,'oracles.jsonl'))))throw Error('retained original evidence changed');
 if(annotation.correctedScenarioSha256!==sha256(readFileSync(planned.scenario)))throw Error('retained correction targets a different frozen scenario');
 if(JSON.stringify(canonical(correctedScenario(original,current)))!==JSON.stringify(canonical(read(join(rescoreDir,'scenario.json')))))throw Error('retained corrected measurement conditions differ');
 for(const file of ['journey-oracles.mjs','oracles.mjs'])if(annotation.scorerFiles?.[file]!==sha256(readFileSync(new URL('../../review/'+file,import.meta.url))))throw Error('retained control needs offline rescore with current oracles');
 const manifest=read(annotation.sourceManifest),source=manifest.plan.find(r=>resolve(r.out)===runDir&&key(r)===key(ref));
 if(annotation.sourceHeads?.treatment!==manifest.heads?.treatment)throw Error('retained treatment source annotation mismatch');
 if(!source||manifest.heads?.control!=='db68679b747911f2546fc054345e96aa703090ea'||annotation.sourceHeads?.control!==manifest.heads.control)throw Error('retained control source head/provenance mismatch');
 if(!existsSync(join(runDir,'close.json'))||read(join(runDir,'preflight.json')).ok!==true)throw Error('retained battery did not finish infrastructure');
 const invalid=join(runDir,'infrastructure-invalid.jsonl');if(existsSync(invalid)&&readFileSync(invalid,'utf8').trim())throw Error('retained battery has infrastructure-invalid requests');
 const evidence=readdirSync(join(runDir,'evidence')).filter(f=>/^sol-\d+\.json$/.test(f)).map(f=>read(join(runDir,'evidence',f)));
 if(evidence.length!==current.director.script.length||evidence.some(e=>!e.cutoffAt||!e.sentAt||!e.samples?.length))throw Error('retained battery lacks complete request evidence');
 const scopedRetention=ref.arm==='treatment'?verifyTreatmentScope(ref,planned,manifest):undefined;
 return{...ref,runDir,rescoreDir,scopedRetention,sourceManifest:annotation.sourceManifest,sourceHeads:manifest.heads,scorerRevision:annotation.scorerRevision,scorerFiles:annotation.scorerFiles,originalOraclesSha256:annotation.originalOraclesSha256};
}
export function selectManualPlan(selection,fullPlan,{verify=verifyRetained}={}){
 if(selection?.schema!=='unified-manual-plan/1'||!selection.reason?.trim()||!Array.isArray(selection.run)||!Array.isArray(selection.retain))throw Error('explicit manual plan, reason, run[] and retain[] required');
 const available=new Map(fullPlan.map(r=>[key(r),r])),seen=new Set(),runs=[],retained=[];
 for(const[items,kind]of[[selection.run,'run'],[selection.retain,'retain']])for(const r of items){const k=key(r),p=available.get(k);if(!p||seen.has(k))throw Error(`unknown or duplicate qualification slot: ${k}`);seen.add(k);if(kind==='run')runs.push(p);else retained.push(verify(r,p));}
 if(seen.size!==available.size)throw Error('manual plan must account for all twelve qualification slots');
 return{runs,retained,reason:selection.reason};
}


// One reviewed repair can retain demonstrably unaffected Mars paths. This is deliberately
// narrower than a general treatment reuse mechanism; source identity stays the original head.
export function verifyTreatmentScope(ref,planned,manifest){
 if(ref.world!=='mars'||!ref.scopeProof)throw Error('treatment retention requires a Mars source-scoped proof');
 const proof=read(resolve(ref.scopeProof)),root=planned.serverRoot;
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'});
 const original='c887defd1c083e899057dc6df338adb166ffa7ce';
 if(proof.schema!=='mars-far-part-walk-retention/1'||proof.fromHead!==original||manifest.heads?.treatment!==original||proof.toHead!==git('rev-parse','HEAD').trim())throw Error('scoped treatment source heads mismatch');
 if(!proof.reviewedBy?.includes('coordinator')||!proof.reviewedBy?.includes('physics')||!proof.rationale?.trim())throw Error('independent source scope review required');
 const runtime='apps/server/src/edge/boot/world-places.ts';
 const changed=git('diff','--name-only',original,proof.toHead).trim().split('\n').filter(Boolean).sort();
 validateScopeDiff(proof,{changed,diff:git('diff','--binary',original,proof.toHead),runtimeDiff:git('diff','--binary',original,proof.toHead,'--',runtime)});
 const witness=proof.runs?.find(r=>resolve(r.runDir)===resolve(ref.runDir));if(!witness)throw Error('retained run lacks reviewed path witness');
 for(const file of ['seats/sol/transcript.jsonl','server/data/sim.db',...readdirSync(join(ref.runDir,'evidence')).filter(f=>/^sol-\d+\.json$/.test(f)).map(f=>'evidence/'+f)])if(witness.files?.[file]!==sha256(readFileSync(join(ref.runDir,file))))throw Error('reviewed action/refusal evidence changed');
 const run=loadRun(ref.runDir),qualified=[];
 for(const e of run.evidence){
  if(!Array.isArray(e.refusals))throw Error('structured refusal evidence unavailable');
  if(e.refusals.some(r=>/^walk:[^ ]+\//.test(r.capability)))throw Error('retained path includes a qualified walk refusal touched by repair');
  for(const r of e.receipts??[])if(/^walk:[^ ]+\//.test(r.capability)){
   if(!['started','running','completed'].includes(r.phase)||!r.chosen?.target)throw Error('retained qualified walk lacks accepted physical binding');
   qualified.push({requestId:e.requestId,capability:r.capability,target:r.chosen.target});
  }
 }
 if(!qualified.length||JSON.stringify(qualified)!==JSON.stringify(witness.acceptedQualifiedWalks))throw Error('reviewed accepted paths differ');
 for(const item of proof.nativeProofs??[])if(item.sha256!==sha256(readFileSync(item.path)))throw Error('native regression proof changed');
 if(!proof.nativeProofs?.length||!witness.timingReview?.trim())throw Error('native regression and timing review required');
 return{kind:'source-scoped-retention',originalHead:original,reviewedFinalHead:proof.toHead,proofPath:resolve(ref.scopeProof),proofSha256:sha256(readFileSync(ref.scopeProof)),fullDiffSha256:proof.fullDiffSha256,runtimeDiffSha256:proof.runtimeDiffSha256,acceptedQualifiedWalks:qualified};
}

export function validateScopeDiff(proof,{changed,diff,runtimeDiff}){
 const runtime='apps/server/src/edge/boot/world-places.ts';
 const scorerFiles=['tools/playtest/review/journey-oracles.mjs','tools/playtest/scenarios/unified/manual-plan.mjs','tools/playtest/scenarios/unified/README.md'];
 const allowed=p=>p===runtime||p==='packages/engine-mars/src/ground.test.ts'||scorerFiles.includes(p)||(/^(apps\/server\/src\/|tools\/playtest\/).+\.test\.(ts|mjs)$/.test(p));
 if(changed.some(p=>!allowed(p))||JSON.stringify(changed)!==JSON.stringify(proof.changedFiles))throw Error('source diff includes unreviewed runtime, CLI, skill, fixture, provider or content changes');
 if(!runtimeDiff||sha256(diff)!==proof.fullDiffSha256||sha256(runtimeDiff)!==proof.runtimeDiffSha256)throw Error('reviewed source diff changed');
}
