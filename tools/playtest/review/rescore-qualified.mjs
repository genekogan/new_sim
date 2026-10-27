// Explicit offline correction sidecar. Raw evidence, scenarios and original reports are never overwritten.
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha256} from '../lib/hash.mjs';
import {loadRun} from './run.mjs';
import {runOracles} from './oracles.mjs';
import {computeMetrics,readLedger} from './metrics.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function correctedScenario(original,corrected){
 const measured=s=>{const c=structuredClone(s);for(const k of ['freeze','serverRoot','scenarioPath','scenarioSha256'])delete c[k];delete c.world.genesis;delete c.world.snapshot;for(const e of c.director.script)delete e.expect;return JSON.stringify(canonical(c));};
 if(measured(original)!==measured(corrected))throw Error('rescore cannot change measured asks, setup, budgets, provider or model');
 for(const k of ['physicalSha256','physicalPoseSha256','physicalSnapshotSha256'])if(original.freeze[k]!==corrected.freeze[k])throw Error('rescore cannot change physical fixture');
 const bindings=new Map();for(const e of original.director.script)for(const phase of e.expect.journey.phases)for(const p of phase.anyOf??[phase])for(const[at,ref]of(p.receipt?.targetRefs??[]).entries())if(p.receipt.targetIds?.[at])bindings.set(ref,p.receipt.targetIds[at]);
 const result=structuredClone(corrected);
 for(const e of result.director.script)for(const phase of e.expect.journey.phases)for(const p of phase.anyOf??[phase])if(p.receipt?.targetRefs)p.receipt.targetIds=p.receipt.targetRefs.map(ref=>{const id=bindings.get(ref);if(!id)throw Error(`missing original physical binding: ${ref}`);return id;});
 return result;
}
export function rescoreQualified({runDir,scenarioPath,out}){
 runDir=resolve(runDir);scenarioPath=resolve(scenarioPath);out=resolve(out);
 if(existsSync(out))throw Error('rescore output already exists; preserve prior correction');
 const run=loadRun(runDir),originalScenario=run.scenario;run.scenario=correctedScenario(originalScenario,read(scenarioPath));
 const rows=run.evidence.flatMap(ev=>runOracles(ev,{run}));
 const originalPath=join(runDir,'oracles.jsonl'),originalRows=readFileSync(originalPath,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const changes=rows.flatMap(r=>{const before=originalRows.find(o=>o.requestId===r.requestId&&o.id===r.id);return before?.status===r.status?[]:[{requestId:r.requestId,id:r.id,before:before?.status??null,after:r.status,detail:r.detail}];});
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const sourceManifest=join(dirname(runDir),'manifest.json');
 const annotation={schema:'qualified-rescore/1',createdAt:new Date().toISOString(),runDir,scenarioPath,originalScenarioSha256:sha256(readFileSync(join(runDir,'scenario.json'))),correctedScenarioSha256:sha256(readFileSync(scenarioPath)),originalOraclesSha256:sha256(readFileSync(originalPath)),sourceManifest:existsSync(sourceManifest)?sourceManifest:null,sourceHeads:existsSync(sourceManifest)?read(sourceManifest).heads:null,scorerRevision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),scorerFiles:Object.fromEntries(['journey-oracles.mjs','oracles.mjs'].map(f=>[f,sha256(readFileSync(new URL(f,import.meta.url)))])),correction:run.scenario.freeze?.oracleCorrection??null,deadlineChange:0,rawEvidenceModified:false,changes};
 mkdirSync(out,{recursive:true});copyFileSync(originalPath,join(out,'original-oracles.jsonl'));copyFileSync(join(runDir,'metrics.json'),join(out,'original-metrics.json'));
 writeFileSync(join(out,'scenario.json'),JSON.stringify(run.scenario,null,2)+'\n');writeFileSync(join(out,'oracles.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 writeFileSync(join(out,'metrics.json'),JSON.stringify(computeMetrics(run,{ledger:readLedger(join(runDir,'ledger.tsv')),oracles:rows}),null,2)+'\n');writeFileSync(join(out,'annotation.json'),JSON.stringify(annotation,null,2)+'\n');
 return{out,changes};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const f={};for(let i=2;i<process.argv.length;i+=2)f[process.argv[i].replace(/^--/,'')]=process.argv[i+1];console.log(JSON.stringify(rescoreQualified({runDir:f.run,scenarioPath:f.scenario,out:f.out}),null,2));}
