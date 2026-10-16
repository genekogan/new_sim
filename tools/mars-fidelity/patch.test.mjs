import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';
import {applyBatch} from '../../packages/world-compiler/src/compile.ts';
import {defSchema} from '../../packages/world-compiler/src/schemas.ts';
import {makePatch,verifyPatch,recordApplied,guardRollback,originalDefs,updatedDefs,localDefs} from './patch.mjs';
const assets=()=>({tris:1,bytes:1,textures:0,box:[1,1,1]});
function fixture(){
 const w=new WorldModel({constants:{ground:'land',extent:1200},seed:'mars-fixture',assets});
 for(const d of originalDefs)w.defineDef(d,'core',0);
 const chair=w.defineDef({schema:'def/1',name:'fixture-chair',make:{kind:'none'},layer:'decor',size:{box:[.5,1,.5]}},'fixture',0);
 for(const [i,d]of originalDefs.entries())w.insert({id:'e_bldg000'+i,def:d.name+'@'+d.version,name:d.name.replace(/^core-mars-/,''),in:{parent:'world'},p:[i*40,0,0],r:-1.571,by:'fixture',born:0,v:1});
 w.insert({id:'e_sofa0000',name:'red-sofa-12',def:chair.ref,in:{parent:'e_bldg0000',slot:'main-south'},p:[.195,1.96],r:1.5708,by:'fixture',born:0,v:1});
 w.insert({id:'e_cup00000',name:'e_cup00000',def:chair.ref,in:{parent:'e_sofa0000'},p:[0,.8,0],by:'fixture',born:0,v:1});
 const s=w.snapshot();return {w,s:{...s,contract:'world/1',worldId:'mars-fixture',counter:s.seq,seq:31}};
}
test('public patch derives local defs and empties targeted parents, retaining all descendant IDs/poses',()=>{
 const {w,s}=fixture(),p=makePatch(s);
 assert.deepEqual(p.batch.ops.filter(o=>o.op==='define').map(o=>o.def.name),localDefs.map(d=>d.name));
 assert.deepEqual(updatedDefs.map(d=>d.name),originalDefs.map(d=>d.name),'raw visual input unchanged');
 assert.equal(p.batch.ops.filter(o=>o.op==='remove').length,originalDefs.length);assert(p.batch.ops.filter(o=>o.op==='remove').every(o=>o.cascade===false));
 assert.equal(p.descendants.length,2);assert.equal(Object.keys(p.batch.expect).length,originalDefs.length+2);
 const applied=applyBatch(w,p.batch,'god',1);assert(applied.result.accepted,JSON.stringify(applied.result));
 const after={...w.snapshot(),worldId:s.worldId};recordApplied(p,applied.result,after);verifyPatch(after,p);
 const journal=[{seq:p.appliedSeq,by:'god',kind:'edit',grp:p.batch.group,undone:0}];assert.equal(guardRollback(journal,p,after),p.rollback.path);
 const changed=structuredClone(after);changed.entities.find(e=>e.id==='e_sofa0000').v++;assert.throws(()=>guardRollback(journal,p,changed),/touched entity/);
 const moved=structuredClone(after);moved.entities.find(e=>e.id==='e_sofa0000').p[0]+=.1;assert.throws(()=>guardRollback(journal,p,moved),/retained/);
 assert.equal(w.entities.get('e_cup00000').in.parent,'e_sofa0000');assert.equal(w.entities.get('e_sofa0000').in.parent,p.replacementIds[0]);
 assert.equal(w.entities.size,s.entities.length);
 const undone=applyBatch(w,{ops:applied.inverse},'god',2,{trusted:true});assert(undone.result.accepted,JSON.stringify(undone.result));verifyPatch({...w.snapshot(),worldId:s.worldId},p,true);
 assert(w.entities.has('e_bldg0000')&&w.entities.has('e_bldg0001'));assert(w.def(localDefs[0].name+'@1'),'unused local def remains after undo');
});
test('source changes, missing instances, body descendants and parent event schedules refuse',()=>{
 const {s}=fixture();s.defs.find(d=>d.ref===originalDefs[0].name+'@2').size.box[0]++;assert.throws(()=>makePatch(s),/changed since/);
 const t=fixture().s;t.entities=t.entities.filter(e=>e.id!=='e_bldg0000');assert.throws(()=>makePatch(t),/at least one/);
 const b=fixture().s,body=defSchema.parse({schema:'def/1',name:'fixture-body',make:{kind:'none'},size:{box:[1,2,1]},components:{body:{media:['walk'],radius:.2,height:1.8,carry:{slot:'hands',maxMass:1,maxSize:[1,1,1]}}}});
 b.defs.push({...body,ref:'fixture-body@1',hash:'body'});if(b.defRefs)b.defRefs['fixture-body@1']='body';/* release 2 snapshots bind refs via defRefs */b.entities.push({id:'soul-body',def:'fixture-body@1',in:{parent:'e_bldg0000'},v:1});assert.throws(()=>makePatch(b),/body descendant/);
 const c=fixture().s;c.entities[0].schedule={events:[{id:'event',day:1}]};assert.throws(()=>makePatch(c),/calendar event identity/);
});
test('references to replaced static IDs refuse, while ordinary structural parents remain allowed',()=>{
 assert.doesNotThrow(()=>makePatch(fixture().s));
 for(const field of ['state','params','constraints','schedule']){
  const {s}=fixture();s.entities[2][field]=field==='constraints'?[{kind:'facing',ref:'e_bldg0000'}]:{ref:'e_bldg0000'};assert.throws(()=>makePatch(s),/external reference/);
 }
 const s=fixture().s;s.state.layers={properties:{'thing:e_bldg0001':{}}};assert.throws(()=>makePatch(s),/external reference key/);
});
test('rollback targets one unique edit, permits newer engine rows and refuses later authored edits',()=>{
 const p=makePatch(fixture().s);p.appliedSeq=40;
 const own={seq:40,by:'god',kind:'edit',grp:p.batch.group,undone:0};
 assert.equal(guardRollback([{seq:41,by:'engine',kind:'engine'},own],p),p.rollback.path);
 assert.throws(()=>guardRollback([{seq:41,by:'god',kind:'edit'},own],p),/authored edit intervened/);
 assert.throws(()=>guardRollback([{...own,undone:1}],p),/authored edit intervened/);
 assert.throws(()=>guardRollback([own,{...own,seq:39}],p),/exactly one/);
 assert.notEqual(makePatch(fixture().s).batch.group,p.batch.group);
});
test('accepted sequence/result are recorded before an optional verification can fail',()=>{
 const p=makePatch(fixture().s),accepted={accepted:true,seq:40,ids:Object.fromEntries(originalDefs.map((_,i)=>['$building'+i,'e_new000'+i])),undoId:'40',warnings:[]};
 recordApplied(p,accepted);assert.equal(p.appliedSeq,40);assert.deepEqual(p.serverResult,accepted);
 assert.throws(()=>verifyPatch({...fixture().s,worldId:'different'},p),/world identity/);assert.equal(p.appliedSeq,40,'accepted receipt remains usable for guarded rollback');
});
test('omitted child transform defaults remain pose-equivalent after public replacement',()=>{
 const {w,s}=fixture(),child=s.entities.find(e=>e.id==='e_sofa0000');delete child.p;delete child.r;w.entities.set(child.id,child);
 const p=makePatch(s),a=applyBatch(w,p.batch,'god',1);assert(a.result.accepted,JSON.stringify(a.result));recordApplied(p,a.result,{...w.snapshot(),worldId:s.worldId});
});
test('static reference files use world-local definitions and guarded public undo',()=>{
 const base=new URL('../../worlds/patches/mars-fidelity-20261015/',import.meta.url);
 const a=JSON.parse(readFileSync(new URL('apply.json',base),'utf8')),b=JSON.parse(readFileSync(new URL('rollback-meshes.json',base),'utf8'));
 assert.equal(a.referenceOnly,true);assert.deepEqual(a.ops.filter(o=>o.op==='define').map(o=>o.def.name),localDefs.map(d=>d.name));
 assert(a.ops.filter(o=>o.op==='remove').length>=originalDefs.length);assert(a.ops.filter(o=>o.op==='remove').every(o=>o.cascade===false));
 assert.equal(b.method,'POST');assert.match(b.path,/^\/v1\/god\/undo\?group=/);assert(!b.ops,'rollback must not try core redefinition');
});

test('every known instance is replaced once using its own input definition, including repeated mesh refs',()=>{
 const {w,s}=fixture(),source=s.entities.find(e=>e.id==='e_bldg0000'),second={...structuredClone(source),id:'e_dup00000',name:'second-mimos',p:[450,0,0]};s.entities.push(second);w.insert(second);
 const p=makePatch(s),entries=p.parentEntries.filter(e=>e.defIndex===0);assert.equal(entries.length,2);assert.equal(p.parents.length,originalDefs.length+1);
 const a=applyBatch(w,p.batch,'god',1);assert(a.result.accepted,JSON.stringify(a.result));recordApplied(p,a.result,{...w.snapshot(),worldId:s.worldId});
 assert.equal(p.replacementIds.length,originalDefs.length+1);assert.equal(w.entities.get(p.replacementIds[1]).def,localDefs[0].name+'@1');
 const undone=applyBatch(w,{ops:a.inverse},'god',2,{trusted:true});assert(undone.result.accepted);verifyPatch({...w.snapshot(),worldId:s.worldId},p,true);assert(w.entities.has(second.id));
});
test('catalogue-backed worlds may pin local replacement refs by content hash',()=>{
 const {w,s}=fixture();w.library={id:'fixture',version:'1',get:()=>undefined,all:()=>[],placementRef:()=>undefined};
 const p=makePatch(s),a=applyBatch(w,p.batch,'god',1);assert(a.result.accepted,JSON.stringify(a.result));
 const after={...w.snapshot(),worldId:s.worldId};recordApplied(p,a.result,after);assert.match(w.entities.get(p.replacementIds[0]).def,/^sha:/);verifyPatch(after,p);
});
