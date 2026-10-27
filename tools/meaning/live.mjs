#!/usr/bin/env node
// Field-scoped live meaning patches. Credentials stay inside the existing God CLI.
// plan <overlay.json> <god-folder> <receipt.json> [source-snapshot.json] --expected-world-id <live-id>
// apply/rollback <overlay.json> <god-folder> <receipt.json>
import { readFileSync,writeFileSync,existsSync,renameSync,unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hashOf } from '../../packages/world-compiler/src/index.ts';
import { aboutSchema,worldAboutSchema } from '../../packages/world-compiler/src/schemas.ts';
import { indexWorld } from '../template-upgrade/upgrade.mjs';
import { materialize } from './materialize.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const save=(p,v)=>{const temp=`${p}.${randomUUID()}.tmp`;try{writeFileSync(temp,JSON.stringify(v,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,p);}finally{if(existsSync(temp))unlinkSync(temp);}};
const same=(a,b)=>hashOf(a??null)===hashOf(b??null);
const body=e=>e.by==='engine'||/humanoid/.test(e.def);
function physical(e,index){
 const {id,v,born,by,about,...out}=structuredClone(e);
 if(out.in?.parent&&out.in.parent!=='world')out.in.parent=index.pathOf(index.byId.get(out.in.parent));
 for(const c of out.constraints??[])if(c.ref&&index.byId.has(c.ref))c.ref=index.pathOf(index.byId.get(c.ref));
 return out;
}
export function assertLiveTarget(snapshot,overlay,source,expectedWorldId){
 if(typeof expectedWorldId!=='string'||!expectedWorldId.trim())throw Error('explicit expected live world ID required');
 if(snapshot.worldId!==expectedWorldId)throw Error(`wrong live world: expected ${expectedWorldId}, received ${snapshot.worldId??'missing'}`);
 // Snapshot-authored overlays describe a particular lived world. Template
 // overlays are portable across seeds and instead require the explicit target.
 if(overlay.source?.snapshotSha&&source?.worldId!==snapshot.worldId)throw Error('live source snapshot belongs to another world');
}
export function planLive(snapshot,overlay,source,{expectedWorldId}={}){
 assertLiveTarget(snapshot,overlay,source,expectedWorldId);
 const planId=randomUUID();
 if(overlay.schema!=='world-meaning/1')throw Error('overlay schema required');
 const W=indexWorld(snapshot),S=indexWorld(source),report={done:[],kept:[],skipped:[]},changes=[];
 const entity=ref=>{const e=W.byId.get(ref)??W.resolve(ref);if(!e||e.ambiguous)throw Error(`missing or ambiguous ${ref}`);return e;};
 const compatible=ref=>{
  const e=entity(ref),s=S.byId.get(ref)??S.resolve(ref);
  if(!s||s.ambiguous||!same(physical(e,W),physical(s,S)))throw Error(`physical source drift ${ref}`);
  return e;
 };
 for(const [ref,input]of Object.entries(overlay.about)){
  try{
   const e=compatible(ref),about=aboutSchema.parse(input),expect={[e.id]:{id:e.id,v:e.v}};
   if(!same(about,input))throw Error(`noncanonical fields ${ref}`);
   const bind=ref=>{const target=compatible(ref);expect[target.id]={id:target.id,v:target.v};return target.id;};
   if(about.in)about.in=bind(about.in);
   for(const part of about.parts??[])if(part.anchor?.kind==='entity')part.anchor.ref=bind(part.anchor.ref);
   if(same(e.about,about)){report.done.push(ref);continue;}
   if(e.about!==undefined){report.kept.push({ref,why:'existing custom meaning'});continue;}
   changes.push({ref,id:e.id,before:e.about??null,after:about,expect});
  }catch(error){report.skipped.push({ref,why:error.message});}
 }
 let worldChange;
 if(overlay.worldAbout){
  const about=worldAboutSchema.parse(overlay.worldAbout);
  if(!same(about,overlay.worldAbout))throw Error('noncanonical world meaning');
  const expect={};let missing=false;
  about.districts=about.districts?.map(ref=>{try{const e=compatible(ref);expect[e.id]={id:e.id,v:e.v};return e.id;}catch(error){report.skipped.push({ref:'world',why:error.message});missing=true;return ref;}});
  if(!missing){
   if(same(snapshot.state?.about,about))report.done.push('world');
   else if(snapshot.state?.about!==undefined)report.kept.push({ref:'world',why:'existing custom meaning'});
   else worldChange={ref:'world',before:snapshot.state?.about??null,after:about,expect};
  }
 }
 // A fresh plan is a new transaction, even after rollback. Reusing this receipt
 // still reuses its exact saved clientRef/submission for interrupted responses.
 const group=`meaning-${planId}`;
 const batches=[];let pending=[];
 function batch(items){const ops=items.map(c=>c.ref==='world'?{op:'world',state:{about:c.after}}:{op:'set',id:c.id,about:c.after});return{group,note:`Reviewed world meaning: ${overlay.worldId}`,ops,expect:Object.assign({},...items.map(c=>c.expect)),...(items.some(c=>c.ref==='world')?{expectWorldAbout:hashOf(worldChange.before)}:{})};}
 const flush=()=>{if(pending.length)batches.push({...batch(pending),clientRef:`${group}-${batches.length}`,changes:pending});pending=[];};
 for(const c of [...changes,...worldChange?[worldChange]:[]]){
  if(pending.length>=128||Buffer.byteLength(JSON.stringify(batch([...pending,c])))>52000)flush();
  if(Buffer.byteLength(JSON.stringify(batch([c])))>52000)throw Error(`meaning block too large ${c.ref}`);
  pending.push(c);
 }
 flush();return{schema:'live-meaning/1',planId,worldId:snapshot.worldId,sourceSeq:snapshot.seq,overlayHash:hashOf(overlay),group,report,batches};
}
export function verifyMeaning(before,after,receipt){
 const A=indexWorld(before),B=indexWorld(after),problems=[];
 for(const e of before.entities.filter(e=>!body(e))){const current=B.byId.get(e.id);if(!current||!same(physical(e,A),physical(current,B)))problems.push(`physical change ${A.pathOf(e)??e.id}`);}
 for(const b of receipt.batches)for(const c of b.changes){const now=c.ref==='world'?after.state?.about:B.byId.get(c.id)?.about;if(!same(now,c.after))problems.push(`meaning mismatch ${c.ref}`);}
 return problems;
}
function cli(folder,args){
 if(args[0]==='act'){const ref=JSON.parse(args[1]).clientRef;if(!ref)throw Error('persisted act clientRef required');args=[...args,'--request-ref',ref];}
 const out=execFileSync(process.execPath,[resolve(ROOT,'tools/god-skill/eden-god.mjs'),...args,'--json'],{cwd:resolve(folder),env:{...process.env,EDEN_GOD_WARM:'0'},encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
 return JSON.parse(out);
}
export function parseLiveArgs(args){
 const positional=[];let expectedWorldId;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--expected-world-id'){
   if(expectedWorldId!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error('--expected-world-id requires one live world ID');
   expectedWorldId=args[++i];
  }else if(args[i].startsWith('--'))throw Error(`unknown option ${args[i]}`);
  else positional.push(args[i]);
 }
 const[mode,overlayPath,folder,receiptPath,sourcePath]=positional;
 if(!['plan','apply','rollback'].includes(mode)||!receiptPath||positional.length>5)throw Error('plan|apply|rollback <overlay> <god-folder> <receipt> [source-snapshot] [--expected-world-id <live-id>]');
 if(mode==='plan'&&!expectedWorldId?.trim())throw Error('plan requires --expected-world-id <live-id>');
 return{mode,overlayPath,folder,receiptPath,sourcePath,expectedWorldId};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const{mode,overlayPath,folder,receiptPath,sourcePath,expectedWorldId}=parseLiveArgs(process.argv.slice(2));
 const current=cli(folder,['snapshot']);
 if(expectedWorldId&&current.worldId!==expectedWorldId)throw Error(`wrong live world: expected ${expectedWorldId}, received ${current.worldId}`);
 if(mode==='plan'){
  if(existsSync(receiptPath))throw Error('receipt exists; use a new path');
  const overlay=read(overlayPath),materialized=sourcePath?null:materialize(overlay.worldId),source=sourcePath?read(sourcePath):materialized.world.snapshot();
  if(sourcePath?overlay.source?.snapshotSha!==hashOf(source):overlay.source?.sha!==hashOf(materialized.template))throw Error('overlay source drift');
  const receipt=planLive(current,overlay,source,{expectedWorldId});save(receiptPath+'.before.json',current);save(receiptPath,receipt);
  console.log(JSON.stringify({worldId:receipt.worldId,batches:receipt.batches.length,changes:receipt.batches.reduce((n,b)=>n+b.changes.length,0),report:receipt.report}));
 }else{
  const receipt=read(receiptPath);if(current.worldId!==receipt.worldId)throw Error('wrong live world');
  if(mode==='apply'){
   if(hashOf(read(overlayPath))!==receipt.overlayHash)throw Error('overlay changed after planning');
   for(const b of receipt.batches){
    if(b.result?.accepted)continue;
    if(!b.submission){
     const{changes,result,preview,submission,...batch}=b;
     // Earlier batches may have changed a shared semantic parent. Refresh only
     // those versions, after proving our own exact meaning and unchanged shape.
     const now=cli(folder,['snapshot']),N=indexWorld(now),P=indexWorld(read(receiptPath+'.before.json'));
     for(const earlier of receipt.batches.filter(x=>x.result?.accepted))for(const c of earlier.changes){
      if(!c.id||!batch.expect[c.id])continue;
      const e=N.byId.get(c.id),pre=P.byId.get(c.id);
      if(!e||!same(e.about,c.after)||!same(physical(e,N),physical(pre,P)))throw Error(`concurrent edit ${c.ref}`);
      batch.expect[c.id]={id:e.id,v:e.v};
     }
     const pv=cli(folder,['preview',JSON.stringify(batch)]);
     if(!pv.accepted)throw Error(`preview refused: ${JSON.stringify(pv.failures)}`);
     b.preview={id:pv.id,expect:pv.expect};
     b.submission={preview:pv.id,clientRef:batch.clientRef,expect:batch.expect,...batch.expectWorldAbout?{expectWorldAbout:batch.expectWorldAbout}:{}};
     save(receiptPath,receipt);
    }
    // Reuse the exact envelope after an interrupted response. The server's
    // request journal answers a completed retry even if its preview has expired.
    b.result=cli(folder,['act',JSON.stringify(b.submission)]);
    save(receiptPath,receipt);if(!b.result.accepted)throw Error(`commit refused: ${JSON.stringify(b.result.failures)}`);
   }
   const after=cli(folder,['snapshot']);save(receiptPath+'.after.json',after);
   receipt.verification=verifyMeaning(read(receiptPath+'.before.json'),after,receipt);save(receiptPath,receipt);
   if(receipt.verification.length)throw Error(JSON.stringify(receipt.verification));
   console.log(JSON.stringify({worldId:receipt.worldId,applied:receipt.batches.length,verified:true}));
  }else{
   // Roll back only our fields, and only while they still hold our exact values.
   for(const b of [...receipt.batches].reverse()){
    if(!b.result?.accepted||b.rollback?.accepted)continue;
    if(b.rollbackSubmission){b.rollback=cli(folder,['act',JSON.stringify(b.rollbackSubmission)]);save(receiptPath,receipt);if(!b.rollback.accepted)throw Error(JSON.stringify(b.rollback.failures));continue;}
    const snap=cli(folder,['snapshot']),W=indexWorld(snap),expect={},ops=[];let expectWorldAbout;
    for(const c of b.changes){const e=c.ref==='world'?null:W.byId.get(c.id),now=c.ref==='world'?snap.state?.about:e?.about;if(!same(now,c.after))throw Error(`rollback conflict ${c.ref}`);
     if(e){expect[e.id]={id:e.id,v:e.v};ops.push({op:'set',id:e.id,about:c.before});}else{expectWorldAbout=hashOf(now??null);ops.push({op:'world',state:{about:c.before}});}}
    b.rollbackSubmission={ops,expect,expectWorldAbout,group:`${receipt.group}-rollback`,clientRef:`${b.clientRef}-rollback`};save(receiptPath,receipt);
    b.rollback=cli(folder,['act',JSON.stringify(b.rollbackSubmission)]);save(receiptPath,receipt);if(!b.rollback.accepted)throw Error(JSON.stringify(b.rollback.failures));
   }
   console.log(JSON.stringify({worldId:receipt.worldId,rolledBack:true}));
  }
 }
}
