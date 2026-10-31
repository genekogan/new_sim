#!/usr/bin/env node
// Human comparison delivery. Exact-diff scores remain in scratch evidence only.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {scratchDir} from '../lib/paths.mjs';
import {captureVisual,safeLocalUrl} from './visual.mjs';
import {comparisonPoses} from './comparison-poses.mjs';
import {runComparisonBehaviour} from './compare-behaviour.mjs';
import {loadRepoComparison} from './content.mjs';
import {writeComparisonPage} from './comparison-page.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const {root,world,out,oldUrl,candidateUrl}=config;
for(const url of [oldUrl,candidateUrl,config.controlUrl])safeLocalUrl(url);
const save=(name,value)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n');
const request=async(base,path,body,token)=>{
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});
  const d=await r.json();if(!r.ok)throw Error(`${path}: HTTP ${r.status}`);return d;
};
const token=(await request(candidateUrl,'/v1/god/mint',{},'dev:admin')).token;
if(!token)throw Error('fixture token not minted');
const template=JSON.parse(readFileSync(config.template,'utf8'));
const allPoses=comparisonPoses(root,world,template);
const poses=config.views?.length?allPoses.filter(p=>config.views.includes(p.name)):allPoses;
if(!poses.length||config.views?.some(name=>!poses.some(p=>p.name===name)))throw Error('Unknown or empty requested view set');
save('comparison-poses.json',poses);
const setHour=async hour=>{
  const old=await request(config.controlUrl.replace('/hour',''),'/hour',{hour});
  const changed=await request(candidateUrl,'/v1/god/env',{timeOfDay:hour,timeScale:0},token);
  if(!changed.accepted)throw Error('candidate clock calibration refused');
  await new Promise(r=>setTimeout(r,800));
  const fresh=await request(candidateUrl,'/v1/world/env');return{old:old.datetime,candidate:fresh.time?.datetime};
};
const visual=await captureVisual({root,oldUrl,candidateUrl,poses,outDir:resolve(out,'shots'),setHour,timeout:120000,sampleHours:!config.captureOnly});
save('visual-internal.json',visual);
console.log(`${world}: ${visual.pairs.filter(p=>p.old&&p.candidate).length} paired views captured; ${visual.errors.length} capture issues`);
const behaviour=config.captureOnly?{rows:[],limits:['Camera retake only; resident evidence is retained separately.']}:await runComparisonBehaviour({world,oldBase:oldUrl,newBase:candidateUrl,freshWorld:true,timeoutMs:45000});
save('resident-comparison.json',behaviour);
let content;
if(!config.captureOnly)try{content=await loadRepoComparison(world,{root,oldMarsMap:world==='mars'});save('content-internal.json',content);}catch(e){content={error:String(e)};}
const review=config.captureOnly||config.views?.length?resolve(out,'retake-review'):(process.env.PARITY_REVIEW_DIR??scratchDir('parity/review'));
const page=writeComparisonPage({review,config,visual,behaviour,poses});
save('comparison.json',{schema:'sim-human-comparison/1',world,candidate:config.candidate,at:new Date().toISOString(),page,
  viewCount:visual.pairs.length,renderedViewPairs:visual.pairs.filter(p=>p.old&&p.candidate).length,errors:visual.errors,provenance:config.provenance});
console.log(`Comparison for Gene: ${page}`);
process.exitCode=visual.errors.length===0&&visual.pairs.length===poses.length*2&&visual.pairs.every(p=>p.old&&p.candidate)?0:2;
