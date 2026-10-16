#!/usr/bin/env node
// Turn the Mars campus from bearing 90 to a true bearing (default 82) with ordinary public Godmode `move` edits.
// Every campus root entity (the world-root placements of worlds/templates/mars-two.json outside its `land` batch) is
// rotated about the Mimos origin (world 0,-30) and gets the same yaw added; children are parent-local and follow.
// Pure reads until --apply. The credential is consumed by path at runtime, never copied into a receipt.
//   node patch.mjs --base <world URL> --receipt <abs JSON> [--bearing 82] [--token-file <path>] [--apply | --recover | --rollback [--apply]]
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const FROM=90,PIVOT=[0,-30],r3=v=>Math.round(v*1000)/1000;
const first=r=>Array.isArray(r)?r[0]:(r??0);
/** Names of the campus' world-root placements in the committed (bearing 90) template, excluding the geographic land. */
export function campusNames(template=JSON.parse(readFileSync(join(root,'worlds/templates/mars-two.json'),'utf8'))){
 return template.batches.filter(b=>b.group!=='land').flatMap(b=>b.ops.filter(o=>o.op==='place'&&!o.in&&o.p&&o.name).map(o=>o.name));
}
/** Pose after turning the compass bearing of the plan's north from FROM to `to` (same convention as frame.mjs). */
export function turn(p,r,to,from=FROM){
 const phi=(from-to)*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi),x=p[0]-PIVOT[0],z=p[p.length-1]-PIVOT[1];
 const nx=r3(x*c+z*s+PIVOT[0]),nz=r3(-x*s+z*c+PIVOT[1]);
 return {p:p.length===3?[nx,p[1],nz]:[nx,nz],r:Array.isArray(r)?[r3(r[0]+phi),...r.slice(1)]:r3((r??0)+phi)};
}
/** Campus bounding box in the committed template, padded, for the resident guard. */
export function makePatch(snapshot,{bearing=82,group='mars-rotation-20261016-'+randomBytes(6).toString('hex'),template}={}){
 assert(bearing>=70&&bearing<=90,'bearing outside the drone-fit range 70..90');
 assert.equal(typeof snapshot.worldId,'string','world identity required');
 assert(!snapshot.entities.some(e=>e.name&&e.name.startsWith('rotation-marker-')),'no marker expected');
 const names=campusNames(template),byName=new Map(snapshot.entities.filter(e=>e.in.parent==='world'&&e.name).map(e=>[e.name,e]));
 const targets=[],missing=[];
 for(const n of names){const e=byName.get(n);if(!e||!e.p)missing.push(n);else targets.push(e);}
 assert(targets.length>=names.length*0.9,'too many campus entities missing ('+missing.length+'): wrong world?');
 const half=Math.max(...targets.map(e=>Math.hypot(e.p[0]-PIVOT[0],e.p[e.p.length-1]-PIVOT[1])))+30;
 const bodies=snapshot.entities.filter(e=>/body|soul/i.test(e.def??'')&&e.in.parent==='world'&&e.p&&Math.hypot(e.p[0]-PIVOT[0],e.p[e.p.length-1]-PIVOT[1])<half);
 assert(bodies.length===0,'residents stand inside the campus ('+bodies.map(b=>b.name??b.id).join(', ')+'): wait until they are away, then retry');
 const ops=targets.map(e=>({op:'move',id:e.id,...turn(e.p,e.r,bearing)}));
 const expect=Object.fromEntries(targets.map(e=>[e.id,{id:e.id,v:e.v}]));
 const batch={group,clientRef:group,expect,note:'Turn the Mars campus from bearing '+FROM+' to '+bearing+' ('+targets.length+' root placements about the Mimos origin; children follow)',ops};
 return {schema:'mars-rotation-patch/1',worldId:snapshot.worldId,beforeSeq:snapshot.seq,bearing,missing,
  before:targets.map(e=>({id:e.id,name:e.name,v:e.v,p:structuredClone(e.p),r:e.r??0})),batch};
}
export function verify(snapshot,receipt,rollback=false){
 assert.equal(snapshot.worldId,receipt.worldId,'world identity');
 for(const [i,b] of receipt.before.entries()){
  const e=snapshot.entities.find(x=>x.id===b.id);assert(e,b.name+' present');
  const want=rollback?{p:b.p,r:b.r}:{p:receipt.batch.ops[i].p,r:receipt.batch.ops[i].r};
  for(const [k,j] of want.p.map((v,j)=>[v,j])) assert(Math.abs(k-e.p[j])<1e-6,b.name+'.p retained');
  assert(Math.abs(first(want.r)-first(e.r))<1e-6,b.name+'.r retained');
 }
}
/** Latest authored edit that still has an effect: skips engine rows, undone edits, undo records, and add-patch pairs (a patch
 *  group whose guarded '-rollback' removal came later), so patches can be rolled back in strict reverse order. */
export function latestEffectiveEdit(edits){const paired=new Set(edits.filter(e=>/-rollback$/.test(e.grp??'')).flatMap(e=>[e.grp,e.grp.replace(/-rollback$/,'')]));return edits.find(e=>e.by!=='engine'&&e.kind!=='engine'&&!e.undone&&e.kind!=='undo'&&!paired.has(e.grp));}
export function guardRollback(edits,receipt,snapshot){
 assert(Number.isInteger(receipt.appliedSeq),'receipt has no accepted sequence');verify(snapshot,receipt);
 for(const [id,v] of Object.entries(receipt.appliedVersions)) assert.equal(snapshot.entities.find(e=>e.id===id)?.v,v,'rollback refused: touched entity '+id+' changed after apply');
 const authored=latestEffectiveEdit(edits);
 assert(authored&&authored.seq===receipt.appliedSeq&&authored.grp===receipt.batch.group&&authored.kind==='edit'&&!authored.undone&&edits.filter(e=>e.grp===receipt.batch.group&&!e.undone&&(e.kind==='edit'||e.kind==='redo')).length===1,'rollback refused: an authored edit intervened (undo later patches first), or this is not the latest authored edit');
 return receipt.rollbackPath;
}
if(import.meta.url==='file://'+process.argv[1]){
 const args=process.argv.slice(2),flag=(k,d)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1];};
 const base=flag('base',null)?.replace(/\/+$/,''),out=flag('receipt',null),rollback=args.includes('--rollback'),bearing=Number(flag('bearing',82));
 assert(base&&out,'--base <world URL> --receipt <absolute JSON path> [--bearing 82] [--apply|--recover|--rollback [--apply]]');
 const tokenFile=flag('token-file',process.env.EDEN_GOD_TOKEN_FILE);let token='';
 if(tokenFile){const raw=readFileSync(tokenFile,'utf8').trim();try{token=JSON.parse(raw).token??'';}catch{token=raw;}}
 const request=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,path+': HTTP '+r.status);return r.json();};
 const snapshot=await request('/v1/world/snapshot'),existing=existsSync(out);
 const save=r=>writeFileSync(out,JSON.stringify(r,null,2)+'\n',{mode:0o600});
 const record=(receipt,result)=>{assert(result.accepted&&Number.isInteger(result.seq),'accepted result required');receipt.appliedSeq=result.seq;receipt.appliedVersions=Object.fromEntries(receipt.before.map(b=>[b.id,b.v+1]));receipt.status='applied';};
 if(rollback||(existing&&args.includes('--recover'))){
  assert(existing,'receipt required');const receipt=JSON.parse(readFileSync(out,'utf8'));assert.equal(receipt.worldId,snapshot.worldId,'receipt world identity');assert(token,'credential path required');
  if(!rollback){record(receipt,(await request('/v1/god/requests/'+encodeURIComponent(receipt.batch.clientRef))).result);verify(snapshot,receipt);save(receipt);console.log(JSON.stringify({mode:'recovered',seq:receipt.appliedSeq}));process.exit(0);}
  const {edits}=await request('/v1/god/edits?limit=200');receipt.rollbackPath='/v1/god/undo?group='+encodeURIComponent(receipt.batch.group);
  const path=guardRollback(edits,receipt,snapshot);
  if(!args.includes('--apply')){console.log(JSON.stringify({mode:'rollback-review',path,appliedSeq:receipt.appliedSeq}));process.exit(0);}
  const undone=await request(path,{});assert(undone.accepted&&JSON.stringify(undone.reverted)===JSON.stringify([receipt.appliedSeq]),'undo refused: '+JSON.stringify(undone.failures??undone.reverted));
  receipt.status='undone';save(receipt);verify(await request('/v1/world/snapshot'),receipt,true);receipt.status='rollback-verified';save(receipt);
  console.log(JSON.stringify({mode:'rollback',accepted:true,reverted:undone.reverted}));process.exit(0);
 }
 assert(!existing,'receipt exists; use --recover or --rollback');
 const receipt=makePatch(snapshot,{bearing});
 if(!token){console.log(JSON.stringify({mode:'review',worldId:receipt.worldId,moves:receipt.batch.ops.length,missing:receipt.missing,sample:receipt.batch.ops.slice(0,3)},null,2));process.exit(0);}
 const preview=await request('/v1/god/preview',receipt.batch);assert(preview.accepted,'preview refused: '+JSON.stringify(preview.failures??preview));
 if(!args.includes('--apply')){console.log(JSON.stringify({mode:'preview',moves:receipt.batch.ops.length,accepted:true}));process.exit(0);}
 receipt.status='prepared';save(receipt);
 const applied=await request('/v1/god/act',{...receipt.batch,preview:preview.id});assert(applied.accepted,'act refused: '+JSON.stringify(applied.failures));
 record(receipt,applied);receipt.rollbackPath='/v1/god/undo?group='+encodeURIComponent(receipt.batch.group);save(receipt);verify(await request('/v1/world/snapshot'),receipt);
 console.log(JSON.stringify({mode:'apply',accepted:true,seq:applied.seq,moves:receipt.batch.ops.length,bearing}));
}
