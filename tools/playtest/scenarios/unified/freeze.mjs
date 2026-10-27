#!/usr/bin/env node
// Freeze reviewed physical fixtures before any inference. No process or provider launches.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {physicalGenesisSha256,physicalSnapshotSha256} from '../../lib/physical-fixture.mjs';
import {bindJourneyFixtures} from '../../arena/fixture-bindings.mjs';
import {validateJourney} from '../../review/journey-oracles.mjs';
import {sha256} from '../../lib/hash.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function physicalPoses(snapshot){
 const entities=new Map((snapshot.entities??[]).map(e=>[e.id,e]));
 const path=(e,seen=new Set())=>{if(seen.has(e.id))throw Error('physical parent cycle');seen.add(e.id);const name=e.name??`@unnamed:${sha256(JSON.stringify(canonical({def:e.def,p:e.p,r:e.r,s:e.s,shape:e.shape,params:e.params})))}`;return entities.has(e.in?.parent)?path(entities.get(e.in.parent),seen)+'/'+name:name;};
 const portable=v=>typeof v==='string'&&entities.has(v)?path(entities.get(v)):Array.isArray(v)?v.map(portable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,portable(x)])):v;
 const rows=new Map();
 for(const e of entities.values()){
  if(e.id.startsWith('h_'))continue;
  const ref=path(e);if(!ref||rows.has(ref))throw Error('nonunique physical entity path');
  rows.set(ref,canonical({ref,def:e.def,p:e.p,r:e.r??0,s:e.s??1,shape:e.shape,params:portable(e.params),in:e.in?{...e.in,parent:entities.has(e.in.parent)?path(entities.get(e.in.parent)):e.in.parent}:undefined}));
 }
 return [...rows].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v);
}
export function comparePhysicalPoses(a,b){
 const before=physicalPoses(a),after=physicalPoses(b);
 const left=new Map(before.map(v=>[v.ref,v])),right=new Map(after.map(v=>[v.ref,v]));
 const differences=[...new Set([...left.keys(),...right.keys()])].filter(k=>JSON.stringify(left.get(k))!==JSON.stringify(right.get(k)));
 return{same:!differences.length,count:before.length,otherCount:after.length,sha256:sha256(JSON.stringify(before)),differences};
}
export function freeze({world,genesis,snapshot,baselineSnapshot,seedSnapshot,output}){
 if(!['mars','eden','hamlet'].includes(world))throw Error('--world mars|eden|hamlet required');
 for(const [key,value]of Object.entries({genesis,snapshot,baselineSnapshot,output}))if(!value)throw Error(`missing ${key}`);
 const scenario=read(fileURLToPath(new URL(`./${world}.json`,import.meta.url)));
 if(scenario.fixtureStatus!=='verified')throw Error('physical scenario not yet verified');
 const g=read(genesis),s=read(snapshot),b=read(baselineSnapshot),parity=comparePhysicalPoses(s,b);
 if(!parity.same)throw Error(`baseline physical poses differ: ${parity.differences.join(', ')}`);
 for(const e of scenario.director.script){const errors=validateJourney(e.expect.journey);if(errors.length)throw Error(`${e.id}: ${errors.join('; ')}`);}
 // Validate every stable target, without retaining this probe world's generated IDs.
 bindJourneyFixtures(structuredClone(scenario),s);
 scenario.world.genesis=resolve(genesis);
 if(seedSnapshot){const seed=read(seedSnapshot);if(physicalSnapshotSha256(seed)!==physicalSnapshotSha256(s)||physicalSnapshotSha256(seed)!==physicalSnapshotSha256(b))throw Error("seed snapshot does not match both actual boots");scenario.world.snapshot=resolve(seedSnapshot);}
 scenario.freeze={...(seedSnapshot?{snapshotSha256:sha256(readFileSync(seedSnapshot)),physicalSnapshotSha256:physicalSnapshotSha256(read(seedSnapshot))}:{}),status:'ready',model:'gpt-6-astra',effort:'high',physicalSha256:physicalGenesisSha256(g),physicalPoseSha256:parity.sha256,entities:parity.count,source:{genesis:resolve(genesis),snapshot:resolve(snapshot),baselineSnapshot:resolve(baselineSnapshot)},setupTransport:'harness CLI, same both arms; measured agent uses server-root served CLI and skill'};
 for(const seat of scenario.seats){seat.model=scenario.freeze.model;seat.effort=scenario.freeze.effort;}
 for(const e of scenario.director.script){e.expect.journey.readiness='ready';e.expect.journey.source=`physical:${scenario.freeze.physicalSha256};poses:${parity.sha256}`;}
 mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(scenario,null,2)+'\n');return{output:resolve(output),world,freeze:scenario.freeze};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args=process.argv.slice(2),flags={};for(let i=0;i<args.length;i+=2)flags[args[i].replace(/^--/,'')]=args[i+1];console.log(JSON.stringify(freeze({world:flags.world,genesis:flags.genesis,snapshot:flags.snapshot,baselineSnapshot:flags['baseline-snapshot'],seedSnapshot:flags['seed-snapshot'],output:flags.out}),null,2));}
