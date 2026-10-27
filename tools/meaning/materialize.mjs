#!/usr/bin/env node
// Replay source templates and the reviewed patches into an isolated compiler model.
// No service, credentials or live writes. Portable name paths keep the same genesis
// usable with a different world seed; no copied live IDs or generated-child loss.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {WorldModel,CORE_KIT,applyBatch,hashOf,correctKitDefines} from '../../packages/world-compiler/src/index.ts';
import {AssetStore} from '../../apps/server/src/god/assets.ts';
import {makePatch as fidelity,originalDefs} from '../mars-fidelity/patch.mjs';
import {makePatch as rotate} from '../mars-rotation/patch.mjs';
import {makePatch as add,loadSpec} from '../mars-rotation/add-patch.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(readFileSync(resolve(ROOT,p),'utf8'));
export function applyOps(world,ops,note='meaning batch'){
  const result=applyBatch(world,correctKitDefines({ops}).batch,'god',0,{trusted:true});
  if(!result.result.accepted)throw Error(`${note}: ${JSON.stringify(result.result.failures).slice(0,1400)}`);
  return result;
}
export function replay(template,{seed='meaning-replay'}={}){
  const assets=new AssetStore({dir:resolve(ROOT,'.lane/meaning-assets-readonly')});
  const world=new WorldModel({constants:{ground:'land',extent:1000,...template.constants},seed,assets:assets.lookup});
  for(const def of CORE_KIT)world.defineDef(def,'core',0);
  if(template.state)applyOps(world,[{op:'world',state:template.state}],'state');
  for(const [i,b] of template.batches.entries())applyOps(world,b.ops,`base ${i}: ${b.note??''}`);
  return world;
}
export function materialize(name,{patched=true,fixtures=true,seed=`meaning:${name}`}={}){
  if(!/^[a-z0-9-]+$/.test(name))throw Error('template name required');
  const source=`worlds/templates/${name}.json`,template=read(source);
  // Re-running enrichment starts from the same physical source, not from its
  // prior semantic patch. Keep authored geometry and unrelated batches intact.
  template.batches=template.batches.filter(b=>{
    if(!b.note?.startsWith('World meaning v1:'))return true;
    for(const op of b.ops){
      const keys=Object.keys(op);
      const entity=op.op==='set'&&keys.every(k=>['op','id','about'].includes(k))&&'about'in op;
      const state=op.op==='world'&&keys.every(k=>['op','state'].includes(k))&&op.state&&Object.keys(op.state).length===1&&'about'in op.state;
      if(!entity&&!state)throw Error(`physical operation in semantic batch: ${b.note}`);
    }
    return false;
  });
  if(name==='mars-two'&&template.batches.some(b=>b.note==='Mars fidelity patch')){
    for(const note of ['Mars campus bearing 82','mars-field-20261016','mars-water-20261016','mars-gallery-20261017','mars-mimos-mat-20261017']){
      if(!template.batches.some(b=>b.note===note))throw Error(`incomplete materialized Mars source: missing ${note}`);
    }
  }
  const provenance=[{path:source,sha:hashOf(template)}];
  const original=structuredClone(template);
  // Common A/B fixtures precede furniture: the old compiler wrongly re-settles
  // unrelated objects when a later pond touches their coarse terrain tile. Both
  // arms must start with equal physical worlds; the live patch runs after the fix.
  const hasPlace=ref=>template.batches.some(b=>b.ops.some(op=>op.op==='place'&&op.name===ref));
  if(fixtures&&name==='mars-two'&&!hasPlace('campus-swimming-pond')){
    const path=`worlds/patches/unified-affordances-20261027/${name}.json`,batch=read(path);
    template.batches.unshift(batch);provenance.push({path,sha:hashOf(batch)});
  }
  const world=replay(template,{seed});
  const snapshot=()=>({...world.snapshot(),worldId:`${name}-1`});
  const append=(batch,note)=>{
    const parents=new Map([...world.entities].map(([id,e])=>[id,e.in.parent]));
    const path=id=>{
      const e=world.entities.get(id);if(!e)return id;
      if(!e.name)throw Error(`cannot make unnamed source portable: ${id}`);
      const parent=parents.get(id);return parent==='world'?e.name:`${path(parent)}/${e.name}`;
    };
    const portable=value=>{
      if(typeof value==='string'&&world.entities.has(value))return path(value);
      if(Array.isArray(value))return value.map(portable);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,portable(v)]));
      return value;
    };
    const ops=batch.ops.map(op=>{
      const result=portable(op);
      // Detach/reparent operations change later name references in the same batch.
      if(op.op==='move'&&op.in?.parent)parents.set(op.id,op.in.parent);
      return result;
    });
    applyOps(world,ops,note);template.batches.push({note,ops});
  };
  if(patched&&name==='mars-two'&&!template.batches.some(b=>b.note==='Mars fidelity patch')){
    // The historical patch predates the current library's derived display LODs.
    // Its strict guard still checks every authored/physical field. Only remove
    // that known display supplement from the planner's private snapshot.
    const historical=structuredClone(snapshot()),lods=read('packages/world-compiler/src/core-mesh-lods.json');
    for(const d of historical.defs){
      if(originalDefs.some(o=>o.name===d.name&&o.version===d.version)&&d.make?.lod1){
        if(lods[d.make.asset]?.lod1!==d.make.lod1)throw Error(`unrecognized display LOD ${d.ref}`);
        delete d.make.lod1;
      }
    }
    append(fidelity(historical,{group:'mars-fidelity-20261015-meaning'}).batch,'Mars fidelity patch');
    append(rotate(snapshot(),{template:original,bearing:82,group:'meaning-rotation'}).batch,'Mars campus bearing 82');
    for(const path of ['tools/mars-fidelity/patch.mjs','worlds/core-assets/mars-fidelity/defs.json','tools/mars-rotation/patch.mjs','packages/world-compiler/src/core-mesh-lods.json'])provenance.push({path,sha:hashOf(readFileSync(resolve(ROOT,path),'utf8'))});
    for(const id of ['mars-field-20261016','mars-water-20261016','mars-gallery-20261017','mars-mimos-mat-20261017']){
      const path=`worlds/patches/${id}/spec.json`,spec=loadSpec(resolve(ROOT,path));
      append(add(snapshot(),spec,{group:`meaning-${id}`}).batch,id);provenance.push({path,sha:hashOf(spec)});
    }
  }
  if(patched&&name==='eden-2026'){
    // Eden's checked-in template is the cumulative upgraded source. These are
    // migration recipes for older live worlds, not extra genesis batches; replaying
    // them would undo subsequent authored changes (for example bedroom furniture).
    for(const path of ['worlds/patches/eden-2026-upgrade-20261018/spec.json','worlds/patches/eden-2026-landmarks-20261019/spec.json','worlds/patches/eden-2026-landmarks-20261019/spec-station.json','worlds/patches/eden-2026-landmarks-20261019/spec-wheel.json','worlds/patches/eden-2026-hills-ring-20261020/spec.json']){
      const spec=read(path);
      provenance.push({path,sha:hashOf(spec)});
    }
  }
  if(fixtures&&name==='eden-2026'&&!hasPlace('harbour-west-pier-bench')){
    const path=`worlds/patches/unified-affordances-20261027/${name}.json`,batch=read(path);
    append(batch,batch.note);provenance.push({path,sha:hashOf(batch)});
  }
  return {template,world,provenance};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [name,out]=process.argv.slice(2);if(!name||!out)throw Error('usage: materialize.mjs <template-name> <output.json>');
  const {template,world,provenance}=materialize(name);mkdirSync(dirname(resolve(out)),{recursive:true});
  writeFileSync(out,JSON.stringify(template,null,2)+'\n');
  writeFileSync(out+'.source.json',JSON.stringify({schema:'meaning-source/1',name,provenance,entities:world.entities.size,sha:hashOf(template)},null,2)+'\n');
  console.log(JSON.stringify({name,entities:world.entities.size,batches:template.batches.length,out}));
}
