#!/usr/bin/env node
import{readFileSync,writeFileSync}from'node:fs';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';
import{hashOf}from'../../packages/world-compiler/src/index.ts';
import{aboutSchema,worldAboutSchema}from'../../packages/world-compiler/src/schemas.ts';
import{materialize,applyOps}from'./materialize.mjs';
import{physicalGenesisSha256}from'../playtest/lib/physical-fixture.mjs';
import{lintMeaning}from'./lint.mjs';
// Leave room for the protocol envelope beneath the live batch byte limit.
export function meaningBatches(ops,name){
 const batches=[];let pending=[];
 const flush=()=>{if(pending.length)batches.push({note:`World meaning v1: ${name} ${batches.length+1}`,ops:pending});pending=[];};
 for(const op of ops){
  if(Buffer.byteLength(JSON.stringify({ops:[op]}))>48000)throw Error('single meaning operation exceeds safe batch size');
  if(pending.length>=128||Buffer.byteLength(JSON.stringify({ops:[...pending,op]}))>48000)flush();
  pending.push(op);
 }
 flush();return batches;
}
export function enrich(name,overlay){
 if(overlay.schema!=='world-meaning/1'||overlay.worldId!==name)throw Error('overlay schema/world mismatch');
 const m=materialize(name),{world,template}=m,sha=hashOf(template);
 if(overlay.source?.template!==`worlds/templates/${name}.json`||overlay.source.sha!==sha)throw Error(`source drift: expected ${sha}; review and refresh overlay provenance`);
 if(!overlay.about||typeof overlay.about!=='object'||Array.isArray(overlay.about))throw Error('about must map stable refs to blocks');
 const warnings=[],diagnostics=[],ops=[];
 for(const[ref,block]of Object.entries(overlay.about)){
  if(!world.get(ref))throw Error(`unknown entity ${ref}`);
  const about=aboutSchema.parse(block);
  if(hashOf(about)!==hashOf(block))throw Error(`${ref}: unknown or noncanonical about fields`);
  if((about.salience??0)>=2&&!about.what)throw Error(`${ref}: salient place needs purpose`);
  const issues=lintMeaning(ref,about);diagnostics.push(...issues);
  warnings.push(...issues.map(d=>`${d.ref}.${d.field}: ${d.message} ${d.suggestion}`));
  ops.push({op:'set',id:ref,about});
 }
 if(overlay.worldAbout){
  const about=worldAboutSchema.parse(overlay.worldAbout);
  if(hashOf(about)!==hashOf(overlay.worldAbout))throw Error('unknown or noncanonical worldAbout fields');
  ops.push({op:'world',state:{about}});
 }
 const structural=()=>hashOf([...world.entities.values()].map(({about,v,...e})=>e));
 const physical=physicalGenesisSha256(template),before=structural();
 for(const batch of meaningBatches(ops,name)){
  const r=applyOps(world,batch.ops,batch.note);
  if(r.diff.tiles.length||r.diff.removes.length||r.diff.defines?.length)throw Error('meaning unexpectedly changes geometry/definitions');
  template.batches.push(batch);
 }
 if(structural()!==before)throw Error('unexpected structural mutation');
 if(physicalGenesisSha256(template)!==physical)throw Error('meaning changed physical fixture hash');
 return{...m,report:{name,entities:Object.keys(overlay.about).length,parts:Object.values(overlay.about).reduce((n,a)=>n+(a.parts?.length??0),0),warnings,diagnostics,sourceSha:sha,physicalSha256:physical}};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const[command,name,out]=process.argv.slice(2);if(!['lint','apply'].includes(command)||!name)throw Error('overlay.mjs lint <name> | apply <name> <output.json>');
 const o=JSON.parse(readFileSync(new URL(`../../worlds/meaning/${name}.json`,import.meta.url),'utf8')),r=enrich(name,o);
 if(command==='apply'){if(!out)throw Error('explicit output path required');writeFileSync(out,JSON.stringify(r.template,null,2)+'\n');}
 console.log(JSON.stringify(r.report,null,2));
}
