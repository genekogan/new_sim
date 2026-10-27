#!/usr/bin/env node
// Coordinator-invoked only. One local battery at a time; no automatic provider/model/review substitution or retries.
import{readFileSync,writeFileSync,mkdirSync,appendFileSync,existsSync}from'node:fs';
import{resolve,join}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{spawn,execFileSync}from'node:child_process';
import{assertMeasurementReady,providerPolicy}from'../../lib/provider-policy.mjs';import{assertFrozenGenesis}from'../../lib/physical-fixture.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
export function comparable(s){const c=structuredClone(s);delete c.freeze;delete c.world.genesis;for(const e of c.director.script)delete e.expect.journey.source;return c;}
export function assertPair(control,treatment){for(const s of[control,treatment]){assertMeasurementReady(s);const p=providerPolicy(s);if(!p.codexOnly||!p.deterministic)throw Error('unified run requires strict Codex and deterministic review');if(s.seats.some(x=>x.effort!==s.freeze.effort))throw Error('effort differs from frozen effort');}
 if(control.freeze.physicalSha256!==treatment.freeze.physicalSha256||control.freeze.physicalPoseSha256!==treatment.freeze.physicalPoseSha256)throw Error('paired physical fixtures differ');
 if(JSON.stringify(comparable(control))!==JSON.stringify(comparable(treatment)))throw Error('paired instructions, setup, model, budgets or oracles differ');
}
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
export async function overnight({baselineRoot,treatmentRoot,fixtures,out}){
 for(const[k,v]of Object.entries({baselineRoot,treatmentRoot,fixtures,out}))if(!v)throw Error(`missing ${k}`);
 const roots={control:resolve(baselineRoot),treatment:resolve(treatmentRoot)},heads=Object.fromEntries(Object.entries(roots).map(([arm,root])=>[arm,git(root,'rev-parse','HEAD')]));
 if(heads.control!=='db68679b747911f2546fc054345e96aa703090ea')throw Error('baseline changed from accepted release head');
 const plan=[];for(const world of['mars','eden','hamlet']){const paths=Object.fromEntries(['control','treatment'].map(arm=>[arm,resolve(fixtures,`${world}-${arm}.json`)])),pair={control:read(paths.control),treatment:read(paths.treatment)};assertPair(pair.control,pair.treatment);for(const arm of['control','treatment'])assertFrozenGenesis(pair[arm],roots[arm]);for(let repeat=1;repeat<=2;repeat++)for(const arm of['control','treatment'])plan.push({world,arm,repeat,scenario:paths[arm],serverRoot:roots[arm],out:resolve(out,`${world}-${arm}-r${repeat}`)});}
 if(existsSync(out))throw Error('output directory already exists; never overwrite or silently resume a measurement');mkdirSync(out,{recursive:true});
 writeFileSync(join(out,'manifest.json'),JSON.stringify({version:1,startedAt:new Date().toISOString(),heads,roots,plan,provider:'codex',model:'gpt-6-astra',effort:'high',automaticRetries:0,comparison:'old code/old meaning vs final code/new meaning; two serial repeats'},null,2)+'\n');
 const runner=fileURLToPath(new URL('../../playtest.mjs',import.meta.url));
 for(const run of plan){for(const[arm,root]of Object.entries(roots))if(git(root,'rev-parse','HEAD')!==heads[arm]||git(root,'status','--porcelain'))throw Error(`${arm} source changed or has uncommitted edits; stop before inference`);
  const startedAt=new Date().toISOString();console.log(`Starting ${run.world} ${run.arm} repeat${run.repeat}`);
  const child=spawn(process.execPath,[runner,'run',run.scenario,'--server-root',run.serverRoot,'--out',run.out],{stdio:'inherit'});const exit=await new Promise((yes,no)=>{child.once('error',no);child.once('exit',(code,signal)=>yes({code,signal}));});
  appendFileSync(join(out,'runs.jsonl'),JSON.stringify({...run,startedAt,endedAt:new Date().toISOString(),...exit})+'\n');
  if(exit.code!==0)throw Error(`battery infrastructure exited ${exit.code}/${exit.signal}; inspect recorded run, no automatic retry`);
 }
 return{out:resolve(out),runs:plan.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){let args=process.argv.slice(2),f={};for(let i=0;i<args.length;i+=2)f[args[i].replace(/^--/,'')]=args[i+1];console.log(await overnight({baselineRoot:f['baseline-root'],treatmentRoot:f['treatment-root'],fixtures:f.fixtures,out:f.out}));}
