// A coordinator's explicit qualification selection. No automatic retry or implicit reuse of old measurements.
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {sha256} from '../../lib/hash.mjs';
import {correctedScenario} from '../../review/rescore-qualified.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const key=r=>`${r.world}/${r.arm}/${r.repeat}`;
export function verifyRetained(ref,planned){
 const runDir=resolve(ref.runDir),rescoreDir=resolve(ref.rescoreDir),annotation=read(join(rescoreDir,'annotation.json'));
 if(ref.arm!=='control')throw Error('only qualified controls may be retained across a treatment source change');
 if(!ref.reason?.trim())throw Error('retained control requires coordinator reason');
 if(annotation.schema!=='qualified-rescore/1'||resolve(annotation.runDir)!==runDir||annotation.rawEvidenceModified!==false||annotation.deadlineChange!==0)throw Error('invalid corrected evidence annotation');
 const original=read(join(runDir,'scenario.json')),current=read(planned.scenario);
 if(annotation.originalScenarioSha256!==sha256(readFileSync(join(runDir,'scenario.json')))||annotation.originalOraclesSha256!==sha256(readFileSync(join(runDir,'oracles.jsonl'))))throw Error('retained original evidence changed');
 if(annotation.correctedScenarioSha256!==sha256(readFileSync(planned.scenario)))throw Error('retained correction targets a different frozen scenario');
 if(JSON.stringify(canonical(correctedScenario(original,current)))!==JSON.stringify(canonical(read(join(rescoreDir,'scenario.json')))))throw Error('retained corrected measurement conditions differ');
 for(const file of ['journey-oracles.mjs','oracles.mjs'])if(annotation.scorerFiles?.[file]!==sha256(readFileSync(new URL('../../review/'+file,import.meta.url))))throw Error('retained control needs offline rescore with current oracles');
 const manifest=read(annotation.sourceManifest),source=manifest.plan.find(r=>resolve(r.out)===runDir&&key(r)===key(ref));
 if(!source||manifest.heads?.control!=='db68679b747911f2546fc054345e96aa703090ea'||annotation.sourceHeads?.control!==manifest.heads.control)throw Error('retained control source head/provenance mismatch');
 if(!existsSync(join(runDir,'close.json'))||read(join(runDir,'preflight.json')).ok!==true)throw Error('retained battery did not finish infrastructure');
 const invalid=join(runDir,'infrastructure-invalid.jsonl');if(existsSync(invalid)&&readFileSync(invalid,'utf8').trim())throw Error('retained battery has infrastructure-invalid requests');
 const evidence=readdirSync(join(runDir,'evidence')).filter(f=>/^sol-\d+\.json$/.test(f)).map(f=>read(join(runDir,'evidence',f)));
 if(evidence.length!==current.director.script.length||evidence.some(e=>!e.cutoffAt||!e.sentAt||!e.samples?.length))throw Error('retained battery lacks complete request evidence');
 return{...ref,runDir,rescoreDir,sourceManifest:annotation.sourceManifest,sourceHeads:manifest.heads,scorerRevision:annotation.scorerRevision,scorerFiles:annotation.scorerFiles,originalOraclesSha256:annotation.originalOraclesSha256};
}
export function selectManualPlan(selection,fullPlan,{verify=verifyRetained}={}){
 if(selection?.schema!=='unified-manual-plan/1'||!selection.reason?.trim()||!Array.isArray(selection.run)||!Array.isArray(selection.retain))throw Error('explicit manual plan, reason, run[] and retain[] required');
 const available=new Map(fullPlan.map(r=>[key(r),r])),seen=new Set(),runs=[],retained=[];
 for(const[items,kind]of[[selection.run,'run'],[selection.retain,'retain']])for(const r of items){const k=key(r),p=available.get(k);if(!p||seen.has(k))throw Error(`unknown or duplicate qualification slot: ${k}`);seen.add(k);if(kind==='run')runs.push(p);else retained.push(verify(r,p));}
 if(seen.size!==available.size)throw Error('manual plan must account for all twelve qualification slots');
 return{runs,retained,reason:selection.reason};
}
