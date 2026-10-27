#!/usr/bin/env node
// Only the two reviewed physical fixtures; credentials remain inside the God CLI.
import {readFileSync,writeFileSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {WorldModel,applyBatch,hashOf,buildLibrary,coreLibrary} from '../../packages/world-compiler/src/index.ts';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const APPROVED={
 'mars-two':{name:'campus-swimming-pond',sha:'696ba06214955f231e03db29774a1cfe8567b720cc8730e61315d6ad1604dcec'},
 'eden-2026':{name:'harbour-west-pier-bench',sha:'6738042879c9360b3c6619102169233e08a585a0a7d4d41ee8f90da3844dc9f7'},
};
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const same=(a,b)=>hashOf(a??null)===hashOf(b??null);
const body=e=>e.by==='engine'||/humanoid/.test(e.def);
const publicDef=d=>{const{by,...rest}=d;return rest;};
const physical=e=>{const{id,v,born,by,about,...rest}=e;return rest;};
const save=(p,value)=>{const tmp=`${p}.${randomUUID()}.tmp`;try{writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,p);}finally{if(existsSync(tmp))unlinkSync(tmp);}};
function target(s,id){if(typeof id!=='string'||!id.trim())throw Error('explicit expected world ID required');if(s.worldId!==id)throw Error('wrong live world');}
export function approvedFixture(key){
 const spec=APPROVED[key];if(!spec)throw Error('only mars-two and eden-2026 fixtures are approved');
 const batch=read(resolve(ROOT,`worlds/patches/unified-affordances-20261027/${key}.json`));
 if(hashOf(batch)!==spec.sha)throw Error('approved fixture changed; review required');
 return{...spec,batch};
}
export function existingPhysicalProblems(before,after){
 const B=new Map(after.entities.map(e=>[e.id,e]));
 return before.entities.filter(e=>!body(e)).flatMap(e=>{const b=B.get(e.id);return !b||!same(physical(e),physical(b))?[`existing physical change ${e.name??e.id}`]:[];});
}
const fixtureGround=(ground,id)=>{const out=structuredClone(ground);for(const key of ['landforms','waters'])out[key]=out[key].filter(e=>e.id!==id&&!e.id.startsWith(id+':'));return out;};
const fixtureGroundParts=(ground,id)=>Object.fromEntries(['landforms','waters'].map(key=>[key,ground[key].filter(e=>e.id===id||e.id.startsWith(id+':')).map(e=>({...e,id:'fixture'+e.id.slice(id.length)}))]));
function summary(diff){return{upserts:diff.upserts.length,removes:diff.removes.length,defs:diff.defs.map(d=>d.ref),tiles:diff.tiles.length,world:diff.world?Object.keys(diff.world):[],answers:diff.answers.length};}
export function planFixture(snapshot,key,expectedWorldId){
 target(snapshot,expectedWorldId);
 const spec=approvedFixture(key),matches=snapshot.entities.filter(e=>e.name===spec.name);
 if(matches.length>1)throw Error('ambiguous existing fixture name');
 const existing=matches[0];
 if(existing&&existing.in?.parent!=='world')throw Error('fixture name already used by nested entity');
 // Reconstruct the canonical place result privately when checking an existing
 // fixture. This never emits a remove operation to the service.
 const clean=structuredClone(snapshot);
 if(snapshot.contract==='world/1'){if(!Number.isSafeInteger(snapshot.counter))throw Error('public snapshot missing entity counter');clean.seq=snapshot.counter;clean.editSeq=snapshot.seq;}
 if(existing){clean.entities=clean.entities.filter(e=>e.id!==existing.id);clean.ground.landforms=clean.ground.landforms.filter(e=>e.id!==existing.id&&!e.id.startsWith(existing.id+':'));clean.ground.waters=clean.ground.waters.filter(e=>e.id!==existing.id&&!e.id.startsWith(existing.id+':'));}
 const model=WorldModel.fromSnapshot(clean,undefined,Array.isArray(clean.library)?buildLibrary('live-snapshot',clean.library):null);
 const ref=spec.batch.ops[0].def;if(model.def(ref)?.hash!==coreLibrary().get(ref)?.hash)throw Error('fixture definition differs from reviewed core kit');
 const prediction=applyBatch(model,spec.batch,'god',0,{trusted:true});
 if(!prediction.result.accepted)throw Error(`local fixture refused: ${JSON.stringify(prediction.result.failures)}`);
 if(prediction.result.warnings?.length)throw Error(`local fixture warnings: ${JSON.stringify(prediction.result.warnings)}`);
 const expected=[...model.entities.values()].find(e=>e.name===spec.name);
 if(!expected)throw Error('prediction missing fixture');
 const problems=existingPhysicalProblems({...snapshot,entities:snapshot.entities.filter(e=>e!==existing)},model.snapshot());
 if(problems.length)throw Error(problems.join('; '));
 if(!same(existing?fixtureGround(snapshot.ground,existing.id):snapshot.ground,fixtureGround(model.ground(),expected.id)))throw Error('prediction changes existing ground');
 const d=prediction.diff;
 if(d.upserts.length!==1||d.upserts[0].id!==expected.id||d.removes.length||d.defs.some(def=>def.ref!==expected.def)||d.world||d.answers.length)throw Error('prediction contains unplanned changes');
 if(existing&&!same(physical(existing),physical(expected)))throw Error('existing fixture differs from approved physical fixture');
 const planId=randomUUID();
 return{schema:'live-fixture/1',planId,key,worldId:snapshot.worldId,sourceSeq:snapshot.seq,beforeHash:hashOf(snapshot),fixtureHash:spec.sha,name:spec.name,expected:physical(expected),noop:!!existing,batch:{...spec.batch,group:`fixture-${key}-${planId}`,clientRef:`fixture-${key}-${planId}`},predictedSummary:summary(d),expectedDefs:d.defs,groundWithoutFixture:fixtureGround(model.ground(),expected.id),fixtureGround:fixtureGroundParts(model.ground(),expected.id)};
}
export function assertFixturePreview(preview,receipt){
 if(!preview.accepted)throw Error('fixture preview refused');
 if(preview.warnings?.length||preview.wouldMove?.length)throw Error('fixture preview warns or would move bodies');
 if(!same(preview.summary,receipt.predictedSummary))throw Error('fixture preview differs from exact predicted change');
 if(!preview.id||!preview.expect)throw Error('fixture preview missing sealed identity');
}
export function verifyFixture(before,after,receipt){
 target(after,receipt.worldId);
 const problems=existingPhysicalProblems(before,after);if(receipt.result?.warnings?.length)problems.push('fixture commit warnings require review');
 const old=new Set(before.entities.map(e=>e.id));
 const fixtures=after.entities.filter(e=>e.name===receipt.name&&e.in?.parent==='world');
 if(fixtures.length!==1||!same(physical(fixtures[0]),receipt.expected))problems.push('exact fixture mismatch');
 for(const e of after.entities)if(!old.has(e.id)&&!body(e)&&e.id!==fixtures[0]?.id)problems.push(`unplanned new entity ${e.name??e.id}`);
 if(fixtures.length===1&&!same(fixtureGround(after.ground,fixtures[0].id),receipt.groundWithoutFixture))problems.push('unplanned ground change');
 if(fixtures.length===1&&!same(fixtureGroundParts(after.ground,fixtures[0].id),receipt.fixtureGround))problems.push('fixture ground mismatch');
 const expectedDefs=new Map([...before.defs,...receipt.expectedDefs].map(d=>[d.hash,d]));
 const actualDefs=new Map(after.defs.map(d=>[d.hash,d]));
 if(expectedDefs.size!==actualDefs.size||[...expectedDefs].some(([hash,d])=>!same(publicDef(d),actualDefs.has(hash)?publicDef(actualDefs.get(hash)):null)))problems.push('unplanned definition change');
 return problems;
}
function cli(folder,args){
 if(args[0]==='act'){const ref=JSON.parse(args[1]).clientRef;if(!ref)throw Error('persisted act clientRef required');args=[...args,'--request-ref',ref];}return JSON.parse(execFileSync(process.execPath,[resolve(ROOT,'tools/god-skill/eden-god.mjs'),...args,'--json'],{cwd:resolve(folder),env:{...process.env,EDEN_GOD_WARM:'0'},encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024}));}
export function parseFixtureArgs(args){
 const positional=[];let expectedWorldId;
 for(let i=0;i<args.length;i++)if(args[i]==='--expected-world-id'){if(expectedWorldId||!args[i+1]||args[i+1].startsWith('--'))throw Error('--expected-world-id requires one ID');expectedWorldId=args[++i];}else if(args[i].startsWith('--'))throw Error('unknown option');else positional.push(args[i]);
 const[mode,key,folder,receiptPath]=positional;
 if(!['plan','apply'].includes(mode)||positional.length!==4||!expectedWorldId?.trim()||!APPROVED[key])throw Error('plan|apply <mars-two|eden-2026> <god-folder> <receipt> --expected-world-id <live-id>');
 return{mode,key,folder,receiptPath,expectedWorldId};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const{mode,key,folder,receiptPath,expectedWorldId}=parseFixtureArgs(process.argv.slice(2));
 const current=cli(folder,['snapshot']);target(current,expectedWorldId);
 if(mode==='plan'){
  if(existsSync(receiptPath)||existsSync(receiptPath+'.before.json'))throw Error('receipt exists; choose a new path');
  const receipt=planFixture(current,key,expectedWorldId);save(receiptPath+'.before.json',current);save(receiptPath,receipt);
  console.log(JSON.stringify({worldId:receipt.worldId,planId:receipt.planId,noop:receipt.noop,summary:receipt.predictedSummary}));
 }else{
  const receipt=read(receiptPath),before=read(receiptPath+'.before.json');
  if(receipt.schema!=='live-fixture/1'||receipt.key!==key||receipt.worldId!==expectedWorldId||receipt.beforeHash!==hashOf(before)||receipt.fixtureHash!==approvedFixture(key).sha)throw Error('fixture receipt/source mismatch');
  // Recreate all planned operation and physical expectations from the immutable
  // preimage. No receipt can expand this tool into a general God writer.
  const check=planFixture(before,key,expectedWorldId);
  if(!same(receipt.batch.ops,check.batch.ops)||!same(receipt.expected,check.expected)||!same(receipt.predictedSummary,check.predictedSummary)||!same(receipt.expectedDefs,check.expectedDefs)||!same(receipt.groundWithoutFixture,check.groundWithoutFixture)||!same(receipt.fixtureGround,check.fixtureGround)||receipt.noop!==check.noop)throw Error('fixture receipt changed');
  if(!receipt.noop&&!receipt.result?.accepted){
   if(!receipt.submission){
    const drift=existingPhysicalProblems(before,current);
    const ids=new Set(before.entities.map(e=>e.id));if(current.entities.some(e=>!body(e)&&!ids.has(e.id)))drift.push('new nonbody entity since plan');
    if(!same(before.ground,current.ground)||!same(before.defs,current.defs))drift.push('ground or definitions changed since plan');
    if(drift.length)throw Error(drift.join('; '));
    const fresh=planFixture(current,key,expectedWorldId);if(fresh.noop)throw Error('fixture appeared after plan; inspect and create a new plan');
    if(!same(fresh.expected,receipt.expected)||!same(fresh.predictedSummary,receipt.predictedSummary))throw Error('fixture prediction changed since plan');
    const preview=cli(folder,['preview',JSON.stringify(receipt.batch)]);assertFixturePreview(preview,receipt);
    receipt.preview=preview;receipt.submission={preview:preview.id,clientRef:receipt.batch.clientRef,expect:preview.expect};save(receiptPath,receipt);
   }
   // Journal retry must precede any stale-preimage check after a lost response.
   if(receipt.submission.preview!==receipt.preview?.id||receipt.submission.clientRef!==receipt.batch.clientRef||!same(receipt.submission.expect,receipt.preview?.expect)||Object.keys(receipt.submission).some(k=>!['preview','clientRef','expect'].includes(k)))throw Error('fixture retry envelope changed');
   receipt.result=cli(folder,['act',JSON.stringify(receipt.submission)]);save(receiptPath,receipt);
   if(!receipt.result.accepted)throw Error('fixture commit refused');
  }
  const after=cli(folder,['snapshot']);save(receiptPath+'.after.json',after);
  receipt.verification=verifyFixture(before,after,receipt);save(receiptPath,receipt);
  if(receipt.verification.length)throw Error(receipt.verification.join('; '));
  console.log(JSON.stringify({worldId:receipt.worldId,verified:true,noop:receipt.noop}));
 }
}
