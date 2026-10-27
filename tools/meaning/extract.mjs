#!/usr/bin/env node
import{writeFileSync}from'node:fs';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';
import{hashOf}from'../../packages/world-compiler/src/index.ts';
import{materialize}from'./materialize.mjs';
export function extract(name){
 const{world:w,template,provenance}=materialize(name),candidates=[];
 for(const e of w.entities.values()){
  if(!e.name)continue;const d=w.resolvedDef(e.def);if(!d)continue;
  const slots=w.slotsOf(e),rooms=slots.filter(s=>s.kind==='room'),gen=d.make.kind==='gen'?d.make.gen:null;
  const kind=d.components.place?.kind??(gen==='lake/1'?'water':rooms.length?'building':gen==='pier/1'?'pier':d.form==='area'?'area':null);
  if(!kind)continue;
  const pose=w.worldPose(e),children=[...(w.children.get(e.id)??[])].map(id=>w.entities.get(id)).filter(e=>e?.name);
  candidates.push({ref:w.pathOf(e.id),kind,def:d.ref,description:d.description,tags:d.tags,pose,
   ...(e.shape?{shape:e.shape}:{}),rooms:rooms.map(s=>({id:s.id,label:s.label,p:s.p,level:s.floor})),
   seatSlots:slots.filter(s=>s.kind==='seat').map(s=>s.id),children:children.slice(0,24).map(c=>({ref:w.pathOf(c.id),def:w.resolvedDef(c.def)?.ref})),moreChildren:Math.max(0,children.length-24)});
 }
 return{schema:'meaning-candidates/1',worldId:name,source:{template:`worlds/templates/${name}.json`,sha:hashOf(template),provenance},candidates};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const[name,out]=process.argv.slice(2);if(!name||!out)throw Error('extract.mjs <template> <output.json>');const result=extract(name);writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({name,candidates:result.candidates.length,out}));}
