// One reviewed null-interior repair. This is not a general waiver for old treatment runs.
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256} from '../../lib/hash.mjs';
import {assertFrozenGenesis} from '../../lib/physical-fixture.mjs';
export const CLOSED_ENTRY_FROM='3095f1ce83de87d1f5618a1a5940606c03edf801';
const runtime='apps/server/src/god/nav.ts';
const reviewedRuntimeHash='fde9979f4155826800073374af22864c92ff6d0c46dcc247c6c40fff756f57f8';
const allowed=new Set([runtime,'apps/server/src/god/closed-entry.test.ts','tools/playtest/scenarios/unified/manual-plan.mjs','tools/playtest/scenarios/unified/closed-entry-retention.mjs','tools/playtest/scenarios/unified/closed-entry-retention.test.mjs']);
const read=p=>JSON.parse(readFileSync(p));
export function validateClosedEntryDiff(proof,{changed,diff,runtimeDiff}){
 if(changed.some(p=>!allowed.has(p))||JSON.stringify(changed)!==JSON.stringify(proof.changedFiles))throw Error('closed-entry scope includes unreviewed source changes');
 if(sha256(runtimeDiff)!==reviewedRuntimeHash||proof.runtimeDiffSha256!==reviewedRuntimeHash||sha256(diff)!==proof.fullDiffSha256)throw Error('closed-entry reviewed patch changed');
}
export function normalizedBindingProof(rows){
 const out=structuredClone(rows);
 for(const row of out)for(const plan of Object.values(row.plans))for(const step of plan.steps??[])if(step.verb==='mars:campfire_circle'){
  if(step.params?.actors?.length!==1||!/^h_/.test(step.params.actors[0]))throw Error('unexpected native parity actor shape');
  step.params.actors[0]='OWN_TEST_ACTOR';
 }
 return out;
}
export function verifyClosedEntryRetention(ref,planned,manifest,proof){
 if(!['mars','eden'].includes(ref.world)||ref.arm!=='treatment'||proof.schema!=='closed-single-room-retention/1')throw Error('closed-entry scope only permits reviewed Mars/Eden treatment');
 const git=(...args)=>execFileSync('git',['-C',planned.serverRoot,...args],{encoding:'utf8'});
 if(proof.fromHead!==CLOSED_ENTRY_FROM||manifest.heads?.treatment!==CLOSED_ENTRY_FROM||proof.toHead!==git('rev-parse','HEAD').trim())throw Error('closed-entry source heads mismatch');
 if(!['coordinator','meaning','physics','harness'].every(r=>proof.reviewedBy?.includes(r))||!proof.rationale?.trim())throw Error('closed-entry independent scope reviews required');
 const changed=git('diff','--name-only',CLOSED_ENTRY_FROM,proof.toHead).trim().split('\n').filter(Boolean).sort();
 validateClosedEntryDiff(proof,{changed,diff:git('diff',CLOSED_ENTRY_FROM,proof.toHead),runtimeDiff:git('diff',CLOSED_ENTRY_FROM,proof.toHead,'--',runtime)});
 assertFrozenGenesis(read(planned.scenario),planned.serverRoot);
 if(proof.nativePairs?.length!==2)throw Error('both world native parity pairs required');
 for(const world of ['mars','eden']){
  const pair=proof.nativePairs.find(p=>p.world===world);if(!pair)throw Error('missing native world parity');
  const data=[];for(const name of ['before','after']){const f=pair[name],bytes=readFileSync(f.path);if(sha256(bytes)!==f.sha256)throw Error('native parity evidence changed');data.push(JSON.parse(bytes));}
  const expected=world==='mars'?[[0,0],[-32.9,-17.5]]:[[0,0],[-122,26]];
  if(data.some(d=>JSON.stringify(d.map(r=>r.to))!==JSON.stringify(expected))||JSON.stringify(normalizedBindingProof(data[0]))!==JSON.stringify(normalizedBindingProof(data[1])))throw Error('native capabilities or plans changed');
 }
 if(!proof.sourceArtifacts?.length)throw Error('native source provenance required');
 for(const f of proof.sourceArtifacts)if(sha256(readFileSync(f.path))!==f.sha256)throw Error('native source provenance changed');
 const witness=proof.runs?.find(r=>resolve(r.runDir)===resolve(ref.runDir));if(!witness?.pathReview?.trim()||!witness.timingReview?.trim())throw Error('reviewed retained path/timing witness required');
 const files=['scenario.json','seats/sol/transcript.jsonl','server/data/sim.db',...readdirSync(join(ref.runDir,'evidence')).filter(f=>/^sol-\d+\.json$/.test(f)).map(f=>'evidence/'+f)];
 for(const file of files)if(witness.files?.[file]!==sha256(readFileSync(join(ref.runDir,file))))throw Error('retained closed-entry action evidence changed');
 const rows=readFileSync(join(ref.rescoreDir,'oracles.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.id.startsWith('journey-'));
 if(rows.length!==12||rows.some(r=>r.status!=='pass'))throw Error('closed-entry reuse requires all original journey predicates passed');
 return{kind:'source-scoped-retention',originalHead:CLOSED_ENTRY_FROM,reviewedFinalHead:proof.toHead,proofPath:resolve(ref.scopeProof),proofSha256:sha256(readFileSync(ref.scopeProof)),fullDiffSha256:proof.fullDiffSha256,runtimeDiffSha256:proof.runtimeDiffSha256,pathReview:witness.pathReview,timingReview:witness.timingReview};
}
