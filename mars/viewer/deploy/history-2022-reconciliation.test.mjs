import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-2022-reconciliation-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export {make2022} from './app/history/year-2022';export {Kit,BAY} from './app/history/kit';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(url){const t=new T.Texture();t.userData.sourceUrl=url;return t;};
// oxlint-disable-next-line typescript/no-deprecated -- offline texture fixture
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {Kit,make2022}=await import(file.href);after(()=>fs.unlink(file));
const scene=()=>{const k=new Kit(2022);make2022(k);const r=k.finalize();r.updateMatrixWorld(true);return r;};
const asm=(r,id)=>{let a;r.traverse(o=>{if(o.userData.assembly_id===id&&!o.userData.layer)a??=o;});return a;};
const meshes=(r,name)=>{const a=[];r.traverse(o=>{if(o.isMesh&&(!name||o.name===name)){let v=true;for(let q=o;q;q=q.parent)if(!q.visible)v=false;if(v)a.push(o);}});return a;};
const localBottom=(o)=>{o.geometry.computeBoundingBox();return o.geometry.boundingBox.min.y+o.position.y;};

test('2022 all1755 untouched owner IDs survive source-specific occupied corrections',async()=>{
 const r=scene(),old=JSON.parse(await fs.readFile(new URL('./history-2022-original-owner-ids.json',import.meta.url),'utf8')),all=[];
 r.traverse(o=>{if(o.userData.component_id)all.push(o.userData.component_id);});
 assert.equal(old.length,1755);assert.equal(new Set(all).size,all.length);
 for(const id of old)assert.ok(all.includes(id),id);
 const hidden=[];r.traverse(o=>{if(o.userData.source_quarantine)hidden.push(o);});assert.ok(hidden.length>80);assert.ok(hidden.every(o=>!o.visible&&o.userData.walkNoCollision));
});

test('2022 occupied Cahuilla kitchen keeps triple sink and replaces generic white refrigerator',()=>{
 const r=scene(),g=asm(r,'east-house');assert.equal(meshes(g,'white refrigerator').length,0);
 assert.equal(meshes(g,'three-basin stainless sink').length,1);assert.equal(meshes(g,'sink basin').length,3);
 const d=asm(r,'2022-cahuilla-kitchen-detail'),fridge=meshes(d,'2022 Cahuilla red mini refrigerator')[0];
 assert.ok(Math.abs(localBottom(fridge)-.2525)<1e-6);
 for(const m of meshes(d).filter(m=>m.name.includes(' leg ')||m.name==='2022 black yellow pantry tote'))assert.ok(Math.abs(localBottom(m)-.2525)<1e-6,m.name);
 assert.equal(meshes(d).filter(m=>m.name.startsWith('2022 pantry wire basket base')).length,4);
 assert.equal(meshes(d,'2022 sink high ingredient shelf').length,1);
 const barJug=meshes(r,'2022 bar clear water jug')[0];assert.ok(Math.abs(localBottom(barJug)-1.0)<1e-6,'bar water jug rests on retained counter top');
 const sink=meshes(g,'three-basin stainless sink')[0];assert.ok(Math.abs(localBottom(sink)-.7425)<1e-6,'source shallow sink body stands on commercial legs');
 assert.equal(meshes(d).filter(m=>m.name.startsWith('2022 commercial sink leg')).length,4);
 const bottle=meshes(d,'2022 water dispenser bottle')[0],urn=meshes(d,'2022 water dispenser urn')[0];
 assert.ok(Math.abs(localBottom(bottle)-(urn.position.y+.14))<1e-6,'bottle meets urn without intersecting it');
});

test('2022 four occupied rooms retain source finishes and grounded source furniture',()=>{
 const r=scene();for(const id of ['chiba','east-house','kitchen','west-house'])assert.ok(asm(r,id));
 const study=asm(r,'2022-bss-study-detail');assert.equal(meshes(study).filter(m=>m.name.startsWith('2022 book ')).length,52);
 assert.equal(meshes(study).filter(m=>m.name.endsWith(' seat')).length,8);
 assert.equal(meshes(asm(r,'chiba'),'classroom bench').length,0);assert.equal(meshes(asm(r,'chiba'),'display content').length,0);
 const upper=asm(r,'ba-sing-se-upper-room');
 for(const leg of meshes(upper,'table leg'))assert.ok(Math.abs(localBottom(leg)-.0325)<1e-6,'upper table leg meets actual upper deck');
 const dj=asm(r,'2022-hqb-upper-detail');assert.equal(meshes(dj).filter(m=>m.name.endsWith(' seat')).length,2);
 assert.equal(meshes(dj,'2022 upper DJ mixer').length,1);
 assert.equal(meshes(asm(r,'2022-chatsubo-occupied-detail'),'2022 Chatsubo rear ingredient shelf').length,1);
 assert.equal(meshes(asm(r,'kitchen'),'Chatsubo reflective bar front').length,1);
});

test('2022 native footprint census retains7trailers+14vehicles and distinct pickup/van topology',()=>{
 const r=scene();assert.equal(r.children.filter(g=>/^rv-[1-6]$|^rv-8$/.test(g.userData.assembly_id)).length,7);
 assert.ok(!asm(r,'rv-7')&&!asm(r,'rv-9'));assert.ok(asm(r,'rear-canopy')&&asm(r,'silver-shelter'));
 for(let n=1;n<=14;n++){
  const g=asm(r,`car-${n}`);assert.ok(g);assert.equal(meshes(g,'car road wheel').length,4);
  for(const side of [-1,1])assert.equal(meshes(g,`2022 vehicle ${n} mirror ${side}`).length,1);
 }
 for(const n of [1,3,6,14]){
  const g=asm(r,`car-${n}`);assert.equal(meshes(g,'vehicle body').length,0);assert.equal(meshes(g,`2022 pickup ${n} dark bed`).length,1);
 }
 for(const n of [2,7]){const geo=meshes(asm(r,`car-${n}`),'vehicle roof')[0].geometry;geo.computeBoundingBox();assert.ok(geo.boundingBox.max.z-geo.boundingBox.min.z>3.7);}
 assert.ok(asm(r,'2022-additional-work-vehicle'));assert.equal(meshes(r,'2022 work vehicle wheel').length,4);
 assert.equal(meshes(r,'2022 pickup IBC tank').length,1);
 assert.equal(meshes(r,'2022 school bus mirror -1').length,1);assert.equal(meshes(r,'2022 school bus mirror 1').length,1);
});

test('2022 timber geometric forms use open rods rather than invented opaque shelters',()=>{
 const r=scene(),g=asm(r,'2022-timber-geometric-forms');assert.equal(meshes(g).length,40);assert.ok(meshes(g).every(m=>m.geometry.type==='CylinderGeometry'));
});


test('2022 retained visible original bar/DJ/context supports contact actual floor datums',()=>{
 const r=scene();
 for(const leg of meshes(asm(r,'kitchen'),'bar counter support'))assert.ok(Math.abs(localBottom(leg)-.2525)<1e-6);
 for(const leg of meshes(asm(r,'west-house'),'DJ shelf support'))assert.ok(Math.abs(localBottom(leg)-2.4925)<1e-6);
 for(const leg of meshes(asm(r,'rear-canopy'),'shade post'))assert.ok(Math.abs(localBottom(leg)+.16)<1e-6);
 assert.ok(Math.abs(localBottom(meshes(asm(r,'silver-shelter'),'silver shelter shell')[0])+.16)<1e-6);
 const load=meshes(asm(r,'car-1'),'2022 pickup IBC tank')[0],bed=meshes(asm(r,'car-1'),'2022 pickup 1 dark bed')[0];
 assert.ok(Math.abs(localBottom(load)-(bed.position.y+.025))<1e-6,'IBC rests on pickup bed');
});


test('2022 ALL visible furniture feet and rigid floor equipment clear retained deck beams',()=>{
 const r=scene(),all=meshes(r),supports=all.filter(o=>/deck|beam|crossbar|platform/.test(o.userData.kind??'')),ray=new T.Raycaster();
 const feet=all.filter(o=>o.name==='table leg'||o.name==='bar counter support'||o.name==='DJ shelf support'||(/2022/.test(o.name)&&/ leg | foot |Cahuilla red mini refrigerator|black yellow pantry tote|pickup IBC tank/.test(o.name)));
 assert.ok(feet.length>70);
 for(const o of feet){
  const attr=o.geometry.attributes.position,pts=[];let min=Infinity;
  for(let i=0;i<attr.count;i++){const p=new T.Vector3().fromBufferAttribute(attr,i).applyMatrix4(o.matrixWorld);pts.push(p);min=Math.min(min,p.y);}
  const bottom=pts.filter(p=>Math.abs(p.y-min)<1e-3),center=bottom.reduce((a,p)=>a.add(p),new T.Vector3()).multiplyScalar(1/bottom.length);
  let contact=false;
  for(const p of [center,...bottom]){ray.set(new T.Vector3(p.x,min+.15,p.z),new T.Vector3(0,-1,0));const hit=ray.intersectObjects(supports,false).find(h=>h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.5);const surface=hit?Math.max(-.16,hit.point.y):-.16;
   assert.ok(surface-min<.01,`${o.userData.component_id}: structure ${surface-min} into actual foot`);if(Math.abs(surface-min)<.01)contact=true;
  }
  // IBC is equipment supported by its pickup bed rather than rack flooring.
  if(!o.name.includes('IBC tank'))assert.ok(contact,`${o.userData.component_id}: no floor contact`);
 }
});


test('2022 ALL current trailer and motor vehicle wheels meet Studio soil while frozen recipes keep IDs',()=>{
 const r=scene();for(const name of ['trailer wheel','car road wheel','bus road wheel','2022 work vehicle wheel'])for(const wheel of meshes(r,name)){
  assert.ok(Math.abs(new T.Box3().setFromObject(wheel).min.y+.16)<1e-6,wheel.userData.component_id);
 }
 assert.equal(meshes(r,'RV6 photographed side projection').length,0,'year-specific source names carry prefix');
 assert.equal(meshes(r,'2022 RV6 photographed side projection').length,1);
});
