#!/usr/bin/env node
// Public Godmode edits only: shared core definitions remain immutable. Replace
// emptied static mesh parents; untargeted furniture/descendants keep IDs/poses.
// Credential files are consumed only at runtime, never copied into receipts.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {defSchema} from '../../packages/world-compiler/src/schemas.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
/** Raw visual inputs, never submitted as core overrides. */
export const updatedDefs=JSON.parse(readFileSync(join(root,'worlds/core-assets/mars-fidelity/defs.json'),'utf8'));
const library=JSON.parse(readFileSync(join(root,'packages/world-compiler/src/core-kit/mars.json'),'utf8'));
export const originalDefs=updatedDefs.map(d=>library.find(o=>o.name===d.name&&o.version===d.version));
export const localDefs=updatedDefs.map(d=>({...structuredClone(d),name:d.name.replace(/^core-mars-/,'mars-fidelity-'),version:1}));
export const WORLD_STATE={sky:{palette:'mars-desert'},weather:{kind:'auto',clouds:0,wind:.25,rain:0,fog:0,intensity:0,strike:null}};
const ref=d=>d.name+'@'+d.version;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const strip=d=>{const {budget,...normalized}=defSchema.parse(d);return normalized;};
const modelOf=s=>WorldModel.fromSnapshot({...s,seq:s.counter??s.seq,editSeq:s.seq,seed:s.seed??'mars-fidelity-review'});
const bound=(s,d)=>s.defs.find(x=>x.ref===ref(d));
const entityFields=['name','p','r','s','params','state','seed','shape','anchor','owner','access','schedule','price','constraints'];
const defined=(e,keys)=>Object.fromEntries(keys.filter(k=>e[k]!==undefined).map(k=>[k,structuredClone(e[k])]));
const near=(a,b,label)=>{for(const k of ['x','y','z','yaw','s'])assert(Math.abs(a[k]-b[k])<1e-8,label+'.'+k+' retained');};
function selected(snapshot,defs){return defs.flatMap((d,defIndex)=>{
 const aliases=new Set([ref(d),ref(d).replace(/^core-/,'core/'),...snapshot.defs.filter(x=>x.ref===ref(d)).map(x=>'sha:'+x.hash)]);
 const es=snapshot.entities.filter(e=>aliases.has(e.def));assert(es.length>0,'at least one '+ref(d)+' instance required');return es.map(entity=>({entity,defIndex}));
});}
/** Structural parent links are deliberately remapped; all other references to
 * old static IDs require a separate owner-reviewed migration. */
export function rejectExternalReferences(snapshot,oldIds){
 const walk=(value,path=[])=>{
  if(typeof value==='string'){
   const structural=path.length===4&&path[0]==='entities'&&path[2]==='in'&&path[3]==='parent';
   const identity=path.length===3&&path[0]==='entities'&&path[2]==='id';
   if(!structural&&!identity)for(const id of oldIds)assert(!value.includes(id),'external reference to replaced parent '+id+' at '+path.join('.'));
  }else if(Array.isArray(value))value.forEach((v,i)=>walk(v,[...path,i]));
  else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){for(const id of oldIds)assert(!k.includes(id),'external reference key to replaced parent '+id+' at '+path.join('.'));walk(v,[...path,k]);}
 };walk(snapshot);
}

/** Snapshot-bound atomic public batch. Detach children at their world poses,
 * remove only empty static parents, replace them and reattach the same children. */
export function makePatch(snapshot,{group='mars-fidelity-20261015-'+randomBytes(6).toString('hex')}={}){
 assert.equal(typeof snapshot.worldId,'string','world identity required');
 assert(group.length<=60&&/^mars-fidelity-20261015-[a-z0-9-]+$/.test(group),'unique application group required');
 const parentEntries=selected(snapshot,originalDefs),parents=parentEntries.map(p=>p.entity),model=modelOf(snapshot),oldIds=new Set(parents.map(e=>e.id));
 rejectExternalReferences(snapshot,oldIds);
 for(const d of originalDefs){const actual=bound(snapshot,d);assert(actual,'missing '+ref(d));assert(equal(strip(actual),strip(d)),ref(d)+' changed since this patch was authored');}
 for(const {entity,defIndex}of parentEntries)assert(equal(strip(model.resolvedDef(entity.def)),strip(originalDefs[defIndex])),(entity.name??entity.id)+' uses a changed source definition');
 for(const d of localDefs){const actual=bound(snapshot,d);if(actual)assert(equal(strip(actual),strip(d)),ref(d)+' already exists with different content');}
 const descendants=[],direct=[];
 for(const [i,e]of parents.entries()){
  assert.equal(e.in.parent,'world','static replacement parent must be at world root');assert(e.name,'static parent needs a stable name');
  assert(!e.schedule?.events?.length,'scheduled parent '+e.name+': replacement would change calendar event identity');
  for(const id of model.subtree(e.id).slice(1)){
   const child=model.entities.get(id),def=model.resolvedDef(child.def);assert(def,'unknown descendant definition '+child.def);
   assert(!def.components.body,'body descendant '+(child.name??id)+': wait until every Soul has left this building');
   descendants.push({entity:structuredClone(child),worldPose:model.worldPose(child)});
  }
  for(const child of snapshot.entities.filter(c=>c.in.parent===e.id))direct.push({parent:i,entity:child,worldPose:model.worldPose(child)});
 }
 const names=new Set(snapshot.entities.filter(e=>e.in.parent==='world'&&!oldIds.has(e.id)).map(e=>e.name).filter(Boolean));
 for(const {entity:e}of direct)if(e.name){assert(!names.has(e.name),'temporary world-root name collision: '+e.name);names.add(e.name);}
 const detach=direct.map(({entity:e,worldPose:p})=>({op:'move',id:e.id,in:{parent:'world'},p:[p.x,p.y,p.z],r:Array.isArray(e.r)?[p.yaw,e.r[1],e.r[2]]:p.yaw,s:p.s}));
 const remove=parents.map(e=>({op:'remove',id:e.id,cascade:false}));
 const place=parents.map((e,i)=>({op:'place',tmp:'$building'+i,def:ref(localDefs[parentEntries[i].defIndex]),in:structuredClone(e.in),...defined(e,entityFields)}));
 const attach=direct.map(({parent,entity:e})=>({op:'move',id:e.id,in:{...e.in,parent:'$building'+parent},p:e.p??[0,0],r:e.r??0,s:e.s??1}));
 const expect=Object.fromEntries([...parents,...descendants.map(d=>d.entity)].map(e=>[e.id,{id:e.id,v:e.v}]));
 const batch={group,clientRef:group,expect,note:'Mars cosmetic meshes and desert dust. Replace '+parents.length+' emptied static mesh entities; retain all untargeted descendant identities, room slots and world poses.',ops:[...localDefs.map(def=>({op:'define',def})),...detach,...remove,...place,...attach,{op:'world',state:WORLD_STATE}]};
 return {schema:'mars-fidelity-patch/2',worldId:snapshot.worldId,beforeSeq:snapshot.seq,changedStaticEntityIds:parents.length,parentEntries:structuredClone(parentEntries),parents:parents.map(e=>structuredClone(e)),descendants,otherEntityIds:snapshot.entities.filter(e=>!oldIds.has(e.id)).map(e=>e.id),beforeState:{sky:structuredClone(snapshot.state.sky),weather:structuredClone(snapshot.state.weather)},batch,rollback:{method:'POST',path:'/v1/god/undo?group='+encodeURIComponent(group),note:'Refuse intervening authored edits; undo this single unique application group. Original static entity IDs/weather return; unused local definitions remain.'}};
}

export function recordApplied(receipt,result,snapshot){
 assert(result.accepted,'patch must be accepted');assert(Number.isInteger(result.seq),'accepted seq required');
 receipt.appliedSeq=result.seq;receipt.replacementIds=receipt.parents.map((_,i)=>result.ids?.['$building'+i]);
 receipt.serverResult=structuredClone(result);receipt.status='accepted';
 const oldParents=new Set(receipt.parents.map(e=>e.id));
 // The fixed batch makes each replacement once and moves each direct child
 // twice. Derive expected revisions before any postcommit network read; recovery
 // must never bless a later engine change merely because its pose looks similar.
 receipt.appliedVersions={...Object.fromEntries(receipt.replacementIds.map(id=>[id,1])),...Object.fromEntries(receipt.descendants.map(({entity:e})=>[e.id,e.v+(oldParents.has(e.in.parent)?2:0)]))};
 assert(receipt.replacementIds.every(Boolean),'accepted result must identify every static replacement');if(snapshot)recordVerified(receipt,snapshot);return receipt;
}
export function recordVerified(receipt,snapshot){
 verifyPatch(snapshot,receipt);
 for(const [id,v]of Object.entries(receipt.appliedVersions))assert.equal(snapshot.entities.find(e=>e.id===id)?.v,v,'touched entity '+id+' changed after apply');receipt.status='verified';return receipt;
}

/** Only the explicitly targeted static IDs/refs may change. Explicit default
 * r=0/s=1 is pose-equivalent; normal undo retains those equivalent defaults. */
export function verifyPatch(snapshot,receipt,rollback=false){
 assert.equal(snapshot.worldId,receipt.worldId,'world identity');const model=modelOf(snapshot),ids=new Set(snapshot.entities.map(e=>e.id));
 for(const id of receipt.otherEntityIds)assert(ids.has(id),'retained entity '+id);
 for(const [i,old]of receipt.parents.entries()){
  const di=receipt.parentEntries[i].defIndex;
  const expected=rollback?old.id:receipt.replacementIds?.[i],got=expected?model.entities.get(expected):snapshot.entities.find(e=>e.name===old.name&&model.resolvedDef(e.def)?.ref===ref(localDefs[di]));
  assert(got,old.name+' static parent present');assert.equal(got.name,old.name);assert.equal(got.in.parent,old.in.parent);
  if(rollback)assert.equal(got.def,old.def);else assert.equal(model.resolvedDef(got.def)?.ref,ref(localDefs[di]));
  for(const k of ['p','r'])assert(equal(got[k]??(k==='p'?[0,0]:0),old[k]??(k==='p'?[0,0]:0)),old.name+'.'+k+' retained');
  assert.equal(got.s??1,old.s??1,old.name+'.s retained');
  assert.equal(model.resolvedDef(got.def)?.make.asset,(rollback?originalDefs:localDefs)[di].make.asset,old.name+' active mesh');
  if(!rollback)assert(!ids.has(old.id),'only empty original static parent is replaced');
 }
 for(const {entity:old,worldPose}of receipt.descendants){
  const got=model.entities.get(old.id);assert(got,(old.name??old.id)+' descendant identity retained');
  for(const k of ['def','name','state','params','constraints','owner','access','schedule','price','seed'])assert(equal(got[k],old[k]),old.name+'.'+k+' retained');
  assert(equal(got.p??[0,0],old.p??[0,0]),old.name+'.p retained');
  assert(equal(got.r??0,old.r??0),old.name+'.r retained');assert.equal(got.s??1,old.s??1,old.name+'.s retained');
  const pi=receipt.parents.findIndex(p=>p.id===old.in.parent),parent=pi<0?old.in.parent:rollback?old.in.parent:receipt.replacementIds?.[pi]??snapshot.entities.find(e=>e.name===receipt.parents[pi].name&&model.resolvedDef(e.def)?.ref===ref(localDefs[receipt.parentEntries[pi].defIndex]))?.id;
  assert.deepEqual(got.in,{...old.in,parent},old.name+' parent/room retained');near(model.worldPose(got),worldPose,old.name??old.id);
 }
 const state=rollback?receipt.beforeState:WORLD_STATE;
 for(const [key,value]of Object.entries(state))for(const [k,v]of Object.entries(value))assert.deepEqual(snapshot.state[key][k],v,key+'.'+k+' retained');
 if(rollback){assert.deepEqual(snapshot.state.sky,receipt.beforeState.sky);assert.deepEqual({...snapshot.state.weather,strike:snapshot.state.weather.strike??null},{...receipt.beforeState.weather,strike:receipt.beforeState.weather.strike??null});}
}

/** Client preflight guard plus unique group targeting. Automatic engine rows
 * may advance the sequence during a walk; any later authored edit refuses undo. */
/** Latest authored edit that still has an effect: skips engine rows, undone edits, undo records, and add-patch pairs (a patch
 *  group whose guarded '-rollback' removal came later), so patches can be rolled back in strict reverse order. */
export function latestEffectiveEdit(edits){const paired=new Set(edits.filter(e=>/-rollback$/.test(e.grp??'')).flatMap(e=>[e.grp,e.grp.replace(/-rollback$/,'')]));return edits.find(e=>e.by!=='engine'&&e.kind!=='engine'&&!e.undone&&e.kind!=='undo'&&!paired.has(e.grp));}
export function guardRollback(edits,receipt,snapshot){
 assert(Number.isInteger(receipt.appliedSeq),'receipt has no accepted patch sequence');
 if(snapshot){
  verifyPatch(snapshot,receipt);assert(receipt.appliedVersions,'post-apply versions unavailable; use --recover to verify the accepted patch first');
  for(const [id,v]of Object.entries(receipt.appliedVersions))assert.equal(snapshot.entities.find(e=>e.id===id)?.v,v,'rollback refused: touched entity '+id+' changed after apply');
 }
 const authored=latestEffectiveEdit(edits);
 assert(authored&&authored.seq===receipt.appliedSeq&&authored.grp===receipt.batch.group&&authored.kind==='edit'&&!authored.undone,'rollback refused: an authored edit intervened, or patch is not the latest authored edit');
 assert.equal(edits.filter(e=>e.grp===receipt.batch.group&&!e.undone&&(e.kind==='edit'||e.kind==='redo')).length,1,'rollback must target exactly one accepted patch edit');return receipt.rollback.path;
}

if(import.meta.url==='file://'+process.argv[1]){
 const args=process.argv.slice(2),flag=(k,d)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1];};
 const base=flag('base',null)?.replace(/\/+$/,''),out=flag('receipt',null),rollback=args.includes('--rollback');
 assert(base&&out,'--base <world URL> --receipt <absolute JSON path> [--apply] [--rollback]');
 const tokenFile=flag('token-file',process.env.EDEN_GOD_TOKEN_FILE);let token='';
 if(tokenFile){const raw=readFileSync(tokenFile,'utf8').trim();try{token=JSON.parse(raw).token??'';}catch{token=raw;}}
 const request=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,path+': HTTP '+r.status);return r.json();};
 const before=await request('/v1/world/snapshot'),existing=existsSync(out),receipt=rollback||existing?JSON.parse(readFileSync(out,'utf8')):makePatch(before);
 assert.equal(receipt.worldId,before.worldId,'receipt world identity');
 const save=()=>writeFileSync(out,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 if(existing&&!rollback){
  assert(args.includes('--recover'),'receipt exists; do not overwrite. Use --recover with the same receipt to read /v1/god/requests/'+receipt.batch.clientRef+'; then inspect or --rollback.');
  assert(token,'recovery requires owner credential path');const saved=await request('/v1/god/requests/'+encodeURIComponent(receipt.batch.clientRef));recordApplied(receipt,saved.result);save();recordVerified(receipt,before);save();console.log(JSON.stringify({mode:'recovered',accepted:true,seq:receipt.appliedSeq,worldId:receipt.worldId}));process.exit(0);
 }
 if(rollback){
  assert(token,'rollback requires owner credential path');const {edits}=await request('/v1/god/edits?limit=200'),path=guardRollback(edits,receipt,before);
  if(!args.includes('--apply')){console.log(JSON.stringify({mode:'rollback-review',path,appliedSeq:receipt.appliedSeq}));process.exit(0);}
  const undone=await request(path,{});assert(undone.accepted&&equal(undone.reverted,[receipt.appliedSeq]),'undo refused or wrong edit: '+JSON.stringify(undone.failures??undone.reverted));receipt.undoResult=undone;receipt.status='undone';save();verifyPatch(await request('/v1/world/snapshot'),receipt,true);receipt.status='rollback-verified';save();
  console.log(JSON.stringify({mode:'rollback',accepted:true,reverted:undone.reverted,worldId:receipt.worldId}));process.exit(0);
 }
 for(const d of localDefs){const r=await fetch(base+'/assets/'+d.make.asset+'.glb',{method:'HEAD'});assert(r.ok,'release is missing '+d.make.asset+'.glb');}
 if(!token){console.log(JSON.stringify({mode:'review',worldId:receipt.worldId,changedStaticEntityIds:receipt.parents.length,retainedDescendants:receipt.descendants.length,batch:receipt.batch},null,2));process.exit(0);}
 const preview=await request('/v1/god/preview',receipt.batch);assert(preview.accepted,'preview refused: '+JSON.stringify(preview.failures??preview));
 if(!args.includes('--apply')){console.log(JSON.stringify({mode:'preview',worldId:receipt.worldId,ops:receipt.batch.ops.length,accepted:true,preview:preview.id}));process.exit(0);}
 receipt.submission={preview:preview.id,clientRef:receipt.batch.clientRef,expect:receipt.batch.expect};receipt.status='prepared';save();
 const applied=await request('/v1/god/act',receipt.submission);assert(applied.accepted,'act refused: '+JSON.stringify(applied.failures));
 recordApplied(receipt,applied);save();recordVerified(receipt,await request('/v1/world/snapshot'));save();
 console.log(JSON.stringify({mode:'apply',accepted:true,worldId:receipt.worldId,seq:applied.seq,ops:receipt.batch.ops.length,changedStaticEntityIds:receipt.parents.length,retainedDescendants:receipt.descendants.length}));
}
