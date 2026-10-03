import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-2025-occupied-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export {createHistoricalScene} from './app/history/scenes';export {BAY} from './app/history/kit';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(){return new T.Texture();};
Reflect.set(globalThis,'document',{createElement:()=>({width:1,height:1,getContext:()=>new Proxy({},{get:()=>()=>{}})})});
const {createHistoricalScene,BAY}=await import(file.href);
after(()=>fs.unlink(file));
const originalOwners=JSON.parse(await fs.readFile(new URL('./fixtures/history-2025-original-owners-20261001.json',import.meta.url),'utf8'));
const root=createHistoricalScene(2025);root.updateMatrixWorld(true);
const meshes=[];root.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});
const kinds=name=>meshes.filter(m=>m.userData.kind===name);
const assembly=id=>root.children.find(o=>o.userData.assembly_id===id);

test('2025 interior source surfaces and retrospective painting have correct visibility',()=>{
 const skin=kinds('2025 auditorium north interior plywood')[0];assert.ok(skin);
 for(const m of kinds('rack upright')){const c=m.material.color;assert.ok(c.b>c.g&&c.g>c.r,'dated native sources support blue-grey rack steel rather than Kit green');}
 const ray=new T.Raycaster(new T.Vector3(0,1.4,-3),new T.Vector3(0,0,-1));
 assert.equal(ray.intersectObjects(meshes,false).filter(h=>h.object.visible)[0].object,skin,'interior sees source-confirmed plain plywood before exterior eye mural');
 const paint=kinds('Freeside actual blue-edged pentagon roof painting');assert.equal(paint.length,6);
 for(const m of paint){assert.equal(m.visible,false);assert.equal(m.userData.historicalQuarantine,true);assert.equal(m.userData.walkNoCollision,true);assert.ok(m.userData.component_id);assert.match(m.userData.source,/Capture date\/level/);}
 const cloth=kinds('Auditorium photographed patterned ceiling textile')[0],p=cloth.geometry.getAttribute('position');
 const ys=Array.from({length:p.count},(_,i)=>p.getY(i));assert.ok(Math.min(...ys)<3.7,'c72601 multiple deep cloth swags');
});

test('2025 actual combined hierarchy has open Tool window and clear occupied-room routes',()=>{
 const tool=assembly('secondary-house'),wall=tool.children.find(o=>o.userData.kind==='plywood wall'&&Math.abs(o.position.x+1.5*BAY)<.02&&Math.abs(o.position.y-1.34)<.02);
 assert.ok(wall.userData.component_id);assert.match(wall.userData.source,/c534/);
 const window=kinds('2025 Tool workshop actual ground window')[0];assert.ok(window);assert.ok(!window.userData.walkNoCollision,'source glazing remains a physical walking boundary');assert.ok(window.material.transparent&&window.material.opacity<.3,'window keeps a transparent visual sightline');
 for(const z of [.6,1.1,1.6]){
  const from=tool.localToWorld(new T.Vector3(-1.5*BAY-.3,1.74,z)),dir=new T.Vector3(1,0,0).transformDirection(tool.matrixWorld);
  const ray=new T.Raycaster(from,dir,0,.6);assert.equal(ray.intersectObject(wall,false).length,0,'through-opening in original wall mesh');
 }
 const sam=assembly('rv-10'),towardChiba=new T.Vector3().subVectors(assembly('chiba').position,sam.position).setY(0).normalize();assert.ok(new T.Vector3(0,0,1).applyQuaternion(sam.quaternion).dot(towardChiba)>.9,'c564: Sam cab faces the courtyard rather than the rear field');
 const body=assembly('bodywork-dojo'),van=assembly('observed-car-9'),inverse=new T.Matrix4().copy(body.matrixWorld).invert();let nearest=-Infinity;
 van.traverse(m=>{if(!(m instanceof T.Mesh))return;m.geometry.computeBoundingBox();const b=m.geometry.boundingBox;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])nearest=Math.max(nearest,new T.Vector3(x,y,z).applyMatrix4(m.matrixWorld).applyMatrix4(inverse).z);});
 assert.ok(nearest<-BAY-.1,'whole background van clears occupied dojo shell, not just its center');
 const dojoBox=new T.Box3(new T.Vector3(-2*BAY,0,-BAY),new T.Vector3(2*BAY,3.7,BAY));
 for(const v of root.children.filter(o=>o.userData.assembly_id?.startsWith('observed-car'))){const bounds=new T.Box3();v.traverse(m=>{if(!(m instanceof T.Mesh))return;m.geometry.computeBoundingBox();const b=m.geometry.boundingBox;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])bounds.expandByPoint(new T.Vector3(x,y,z).applyMatrix4(m.matrixWorld).applyMatrix4(inverse));});assert.ok(!bounds.intersectsBox(dojoBox),`whole fitted vehicle outside occupied dojo:${v.userData.assembly_id}`);}
 const free=assembly('kitchen');
 for(const [x,z,dx,dz] of [[-BAY/2,-2.4,1,0],[BAY/2,-2.4,1,0],[.70,-BAY,0,1]])for(const y of [.50,1.20,1.85]){
  const local=new T.Vector3(x,y,z),from=free.localToWorld(local.clone().add(new T.Vector3(-dx*.2,0,-dz*.2))),dir=new T.Vector3(dx,0,dz).transformDirection(free.matrixWorld);
  const hits=new T.Raycaster(from,dir,0,.4).intersectObjects(meshes,false).filter(h=>h.object.visible&&!h.object.userData.walkNoCollision);
  assert.equal(hits.length,0,`occupied furniture leaves sampled route clear:${x},${z},${y}`);
 }
 for(const kind of ['2025 Libaby actual photographed sign','2025 Freeside second white refrigerator','2025 Tool compressor yellow coil hose'])assert.equal(kinds(kind).length,1);
});

// Authoritative baseline is the preserved pre-specialist main source. This is
// deliberately an old-owner set comparison, not merely uniqueness of new IDs.
test('2025 preserves every original component ID and owner across corrections',()=>{
 const before=new Map(originalOwners.map(([id,...owner])=>[id,owner])),afterIds=new Map();
 root.traverse(o=>{if(o.userData.component_id){assert.ok(!afterIds.has(o.userData.component_id));afterIds.set(o.userData.component_id,[o.userData.assembly_id,o.userData.kind]);}});
 for(const [id,owner] of before){assert.ok(afterIds.has(id),`original ID lost:${id}`);assert.deepEqual(afterIds.get(id),owner,`original owner/kind changed:${id}`);}
 console.log(`original2025 IDs retained:${before.size}/${before.size}; current:${afterIds.size}`);
});

// Actual mesh envelopes, including every livery/wheel projection, must clear
// building surfaces; positions alone cannot establish clearance.
const subtreeMeshes=o=>{const out=[];o.traverse(m=>{if(m instanceof T.Mesh)out.push(m);});return out;};
function groundRectangle(o){
 const points=[];
 for(const mesh of subtreeMeshes(o)){mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
  for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(new T.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).setY(0));
 }
 points.sort((a,b)=>a.x-b.x||a.z-b.z);
 const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
 const half=ps=>{const h=[];for(const p of ps){while(h.length>=2&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}h.pop();return h;};
 return [...half(points),...half([...points].reverse())];
}
function rectangleDistance(a,b){
 const dot=(p,n)=>p.x*n.x+p.z*n.z;
 let separated=false;
 for(const poly of [a,b])for(let i=0;i<poly.length;i++){
  const edge=poly[(i+1)%poly.length].clone().sub(poly[i]),n=new T.Vector3(-edge.z,0,edge.x).normalize();
  const av=a.map(p=>dot(p,n)),bv=b.map(p=>dot(p,n));
  if(Math.max(...av)<Math.min(...bv)||Math.max(...bv)<Math.min(...av))separated=true;
 }
 if(!separated)return 0;
 const pointSegment=(p,a,b)=>{const d=b.clone().sub(a).setY(0),v=p.clone().sub(a).setY(0),t=Math.max(0,Math.min(1,v.dot(d)/d.lengthSq()));return v.sub(d.multiplyScalar(t)).length();};
 return Math.min(...a.flatMap(p=>b.map((q,i)=>pointSegment(p,q,b[(i+1)%b.length]))),...b.flatMap(p=>a.map((q,i)=>pointSegment(p,q,a[(i+1)%a.length]))));
}
test('2025 Sam bus whole envelope clears every building after minimal parking refit',()=>{
 const bus=assembly('rv-10'),vehicle=groundRectangle(bus),buildings=root.children.filter(o=>o.userData.assembly_id&&!/^rv-|^car-|^observed-car-|^observed-black-bus$|^yellow-bus$|^people$/.test(o.userData.assembly_id));
 let nearest=Infinity,owner='';for(const b of buildings){let distance=rectangleDistance(vehicle,groundRectangle(b));if(distance<.5)distance=Math.min(...subtreeMeshes(b).map(m=>rectangleDistance(vehicle,groundRectangle(m))));assert.ok(distance>=.5,`Sam envelope only${distance.toFixed(4)}m from${b.name}`);if(distance<nearest){nearest=distance;owner=b.userData.assembly_id;}}
 const fitted=bus.position.clone();bus.position.set(2.6,bus.position.y,40.6);root.updateMatrixWorld(true);const before=groundRectangle(bus),tool=assembly('secondary-house'),oldDistance=Math.min(...subtreeMeshes(tool).map(m=>rectangleDistance(before,groundRectangle(m))));bus.position.copy(fitted);root.updateMatrixWorld(true);console.log(`Sam bus old envelope clearance:${oldDistance.toFixed(6)}m`);
 console.log(`Sam bus fitted center:${bus.position.x.toFixed(10)},${bus.position.z.toFixed(10)}; nearest building:${owner}, clearance:${nearest.toFixed(6)}m`);
});
