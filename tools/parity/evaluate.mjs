#!/usr/bin/env node
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {loadRepoComparison,compareContent} from './content.mjs';
import {runBehaviour} from './behaviour.mjs';
import {captureVisual,safeLocalUrl} from './visual.mjs';
import {namedPoses} from './poses.mjs';
import {verdict} from './gate.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const {root,world,out,candidateUrl,oldUrl}=config;
for(const url of [candidateUrl,oldUrl,config.controlUrl])safeLocalUrl(url);
const save=(name,value)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n');
const gateSourceFiles=Object.fromEntries(readdirSync(resolve(root,'tools/parity')).filter(f=>/\.(mjs|py)$/.test(f)).sort().map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,'tools/parity',f))).digest('hex')]));
save('gate-source.json',gateSourceFiles);
const request=async(base,path,body,token)=>{
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});
  const data=await r.json();if(!r.ok)throw Error(`${path}: HTTP${r.status} ${data.code??''}`);return data;
};
let token;
const mint=await request(candidateUrl,'/v1/god/mint',{},'dev:admin');token=mint.token;if(!token)throw Error('fresh fixture owner could not mint runtime token');
const template=JSON.parse(readFileSync(config.template,'utf8'));
const initialContent=await loadRepoComparison(world,{root,oldMarsMap:world==='mars'});
save('content.json',initialContent);
const oldPlaces=initialContent.old.categories.places.records.map(p=>({id:p.id,name:p.name}));
const input={world,base:candidateUrl,freshWorld:true,oldPlaces,candidatePlaces:template.places??[],historyComplete:false,residents:[],
  fixtures:world==='mars'?[
    {id:'enter-mimos',kind:'enter',capability:'walk:mimos/floor',expect:{place:'mimos/floor'},timeoutMs:120000},
    {id:'sit-honey-sofa',kind:'sit',setup:[{kind:'enter',capability:'walk:mimos/floor',expect:{place:'mimos/floor'},timeoutMs:120000}],capabilityPattern:{verb:'sit',match:'honey.sofa',index:0},params:{seconds:30},expect:{activity:'sit'},timeoutMs:120000},
    {id:'use-mixing-bowl',kind:'use',setup:[{kind:'enter',capability:'walk:kitchen/working-kitchen',expect:{place:'kitchen/working-kitchen'},timeoutMs:120000}],
      capabilityPattern:{verb:'pick-up',match:'prep-mixing-bowl',index:0},expect:{entityParent:{entity:'$target',parent:'$resident'}},timeoutMs:120000}
  ]:[
    {id:'enter-minarete-arch',kind:'enter',capability:'walk:minarete-passage',expect:{place:'minarete-passage'},timeoutMs:120000},
    {id:'sit-old-tower-room',kind:'sit',capabilityPattern:{verb:'sit',match:'tower',index:0},expect:{activity:'sit'},timeoutMs:120000},
    {id:'enter-old-temple-room',kind:'enter',capability:'walk:temple-L0',expect:{place:'temple-L0'},timeoutMs:120000},
    {id:'use-old-glazed-room',kind:'use',capabilityPattern:{match:'^(use|play|read|work):.*temple',index:0},expect:{state:'using'},timeoutMs:120000}
  ]};
save('behaviour-input.json',input);
const setHour=async(hour)=>{
  const oldClock=await request(config.controlUrl.replace('/hour',''),'/hour',{hour});
  const changed=await request(candidateUrl,'/v1/god/env',{timeOfDay:hour,timeScale:0},token);
  if(!changed.accepted)throw Error('candidate clock calibration refused');
  await new Promise(r=>setTimeout(r,800));
  const current=await request(candidateUrl,'/v1/world/env');
  return {old:oldClock.datetime,candidate:current.time?.datetime};
};
const poses=namedPoses(root,world,template,initialContent.old.categories.places.records);save('poses.json',poses);
const visual=await captureVisual({root,oldUrl,candidateUrl,poses,outDir:resolve(out,'shots'),setHour});
save('visual.json',visual);
const completeHours=visual.hourly.length===24;
let content;
try{
  const snapshot=await request(candidateUrl,'/v1/god/snapshot',undefined,token);
  content=await loadRepoComparison(world,{root,oldMarsMap:world==='mars',date:'2026-10-03',
    candidateSnapshot:{snapshot,source:{kind:'fresh-local-runtime-snapshot',world,base:candidateUrl,seq:snapshot.seq}},
    ...(completeHours?{oldSkyHourly:visual.hourly.map(x=>({hour:x.hour,...x.old})),candidateSkyHourly:visual.hourly.map(x=>({hour:x.hour,...x.candidate}))}:{})});
}catch(e){
  content=initialContent;content.runtimeSnapshotError=String(e);content.diff.status=content.diff.status==='NOT_IDENTICAL'?'NOT_IDENTICAL':'UNKNOWN';
}
save('content.json',content);
const behaviour=await runBehaviour(input,{timeoutMs:120000});save('behaviour.json',behaviour);
console.log(`behaviour ${world}: ${behaviour.status} ${JSON.stringify(behaviour.counts)}`);
const result={schema:'sim-parity-gate/1',at:new Date().toISOString(),world,candidate:config.candidate,sourceCommit:config.sourceCommit,gateSourceFiles,
  provenance:config.provenance,content:{...content.diff,status:content.diff.status==='IDENTICAL'?'PASS':content.diff.status==='NOT_IDENTICAL'?'FAIL':'UNKNOWN'},visual,behaviour};
Object.assign(result,verdict(result));save('report.json',result);
const rows=Object.entries(content.diff.categories).map(([k,v])=>`| ${k} | ${v.oldCount} | ${v.candidateCount} | ${v.status} |`);
const best=['overview','old-ceramic-tower','candidate-mimos','interior-kitchen','interior-tower-ground','night'].map(name=>visual.pairs.find(p=>p.name===name&&p.dpr===1&&p.sideBySide)).filter(Boolean).slice(0,3);
const lines=[`# ${world==='mars'?'Mars':'Little Martians'}: ${result.verdict.toUpperCase()}`,'',`**Gate closed; keep the old world.** Tested ${result.at} on source \`${config.sourceCommit.slice(0,8)}\`. Candidate identity: \`${config.candidate}\`.`,
  '',`Scope: disposable old repo fixture versus a fresh candidate from \`${config.template.replace(root+'/','')}\`; both use the same built viewer. This is not a dump or a visit of the live mutable worlds. No sign-in or production action, no copied database, no LLMs.`,
  '', '| Content | Old | Candidate | Verdict |','|---|---:|---:|---|',...rows,'',
  `Visual: ${visual.pairs.length}/${poses.length*2} camera/DPR pairs; ${visual.pairs.filter(p=>p.status==='FAIL').length} differ, ${visual.pairs.filter(p=>p.status==='UNKNOWN').length} unproved. Raw RGB MAE is normalized to 0–1; exact identity requires 0. Fixed 960×640 CSS viewport, DPR 1 and 2, 45° FOV, same eye/target, roofs unchanged. Hourly lighting samples: ${visual.hourly.length}/24.`,
  ...best.map(p=>`- [${p.name} comparison](${p.sideBySide}) — MAE ${p.meanAbsoluteError.toFixed(4)}, ${(100*p.changedFraction).toFixed(1)}% pixels differ.`),
  '',`Behaviour: ${behaviour.counts.PASS} pass, ${behaviour.counts.FAIL} fail, ${behaviour.counts.UNKNOWN} unproved. ${oldPlaces.length} old named places checked by ID and exact name. Missing sourced resident roster/last activities stays UNKNOWN; scripted mechanics are separate. Full cases: [behaviour.json](${resolve(out,'behaviour.json')}).`,
  '', 'What closes the gate:',
  ...(world==='mars'?[
    '- Preserve the old camp’s building/place identities and interiors in the campus candidate, or keep this as a separate world; additions and moved halls fail exact identity.',
    '- Reconcile named places and action targets, including the lookout construction behaviour; then rerun the same calibrated frames.'
  ]:[
    '- Preserve the old tower/temple, all seven glazed-room identities and floater access at their original poses. The Arium rebuild adds a different map; it does not preserve the old garden 1:1.',
    '- Reconcile old place aliases, room use and body abilities; keep the Arium world separate while any identity check differs.'
  ]),
  '- Supply an authorized, minimal complete resident roster with last activity and initial body state; run on disposable data with observable effects. No token files belong in evidence.',
  '- Measure unexposed old decorative terrain/path content and rerun against sealed, current source exports. Both live identity/history coverage and every UNKNOWN must be closed before moving.',
  '',`Machine evidence: [report.json](${resolve(out,'report.json')}) · [content.json](${resolve(out,'content.json')}) · [visual.json](${resolve(out,'visual.json')}).`];
writeFileSync(resolve(out,'VERDICT.md'),lines.join('\n')+'\n');console.log(`${world}: ${result.verdict}; mayMove=${result.mayMove}; ${resolve(out,'VERDICT.md')}`);
process.exitCode=result.mayMove?0:1;
