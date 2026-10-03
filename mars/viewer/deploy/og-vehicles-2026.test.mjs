import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
const file=new URL(`../.og-vehicle-test-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export * from './app/history/details-2026-og-vehicles';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
const GROUND=-.16; // Studio sand datum, verified against the actual combined model.
const {add2026OGVehicles,trimOGSolarAtGrade}=await import(file.href);after(()=>fs.unlink(file));
test('source boat keeps CAD identity, tandem tyres contact ground, open ladder has six rungs',()=>{
 const root=new T.Group(),hull=new T.Mesh(new T.BoxGeometry(6.8,1,2.4),new T.MeshBasicMaterial());
 hull.name='cad_component-2236';hull.userData.component_id=hull.name;hull.position.set(-83,1.58,-16);root.add(hull);
 const originalGeometry=hull.geometry,[boat]=add2026OGVehicles(root);root.updateMatrixWorld(true);
 assert.equal(hull.geometry,originalGeometry);assert.equal(hull.userData.component_id,'cad_component-2236');assert.equal(hull.position.x,-83);assert.equal(hull.position.z,-16);assert.ok(Math.abs(hull.position.y-(1.82+GROUND))<1e-8);
 const tyres=boat.children.filter(o=>o.name==='tandem trailer tyre');assert.equal(tyres.length,4);
 for(const tyre of tyres){const b=new T.Box3().setFromObject(tyre);assert.ok(Math.abs(b.min.y-GROUND)<1e-6);assert.ok(Math.abs(b.max.y-(GROUND+.66))<1e-6);}
 assert.equal(new Set(tyres.map(o=>o.position.x)).size,2);
 assert.equal(boat.children.filter(o=>o.name==='flybridge ladder rung').length,6);
 const ids=[];for(const group of root.children.filter(o=>o.userData.assembly_id))group.traverse(o=>{if(o instanceof T.Mesh){assert.ok(o.userData.component_id);ids.push(o.userData.component_id);assert.ok(Number.isFinite(new T.Box3().setFromObject(o).max.y));}});
 assert.equal(ids.length,new Set(ids).size);
 const count=root.children.length;assert.deepEqual(add2026OGVehicles(root),[]);assert.equal(root.children.length,count);assert.ok(Math.abs(hull.position.y-(1.82+GROUND))<1e-8,'idempotent hookup does not lift twice');
});
test('OG twin entry leaves leave walkable holes and sink worktop has a genuine cutout',()=>{
 const root=new T.Group(),[,,club,kitchen]=add2026OGVehicles(root);root.updateMatrixWorld(true);
 for(const x of [1.3,2.4])for(const y of [.15,1,1.95]){
  const a=club.localToWorld(new T.Vector3(x,y,-4.3)),b=club.localToWorld(new T.Vector3(x,y,-3.1));
  const delta=b.clone().sub(a),ray=new T.Raycaster(a,delta.clone().normalize(),0,delta.length());
  assert.equal(ray.intersectObject(root,true).length,0,`door passage x${x} y${y}`);
 }
 const a=kitchen.localToWorld(new T.Vector3(-2.85,1.1,3.18));
 const hit=new T.Raycaster(a,new T.Vector3(0,-1,0),0,1).intersectObject(kitchen,true)[0];
 assert.equal(hit?.object.name,'OG sink basin bottom');
});
test('bus morph is one shared spatial fit and does not mutate reused CAD geometry',()=>{
 const root=new T.Group(),shared=new T.BoxGeometry(.1,.1,.1),before=Array.from(shared.attributes.position.array);
 const yaw=2.416943,center=new T.Vector3(-84.834,0,-3.657);
 for(const [id,x] of [['cad_component-0091',2],['cad_component-0251',0]]){
  const m=new T.Mesh(shared,new T.MeshBasicMaterial());m.name=id;m.userData.component_id=id;m.position.copy(new T.Vector3(x,1,0).applyAxisAngle(new T.Vector3(0,1,0),yaw).add(center));root.add(m);
 }
 add2026OGVehicles(root);root.updateMatrixWorld(true);
 assert.deepEqual(Array.from(shared.attributes.position.array),before);
 const group=root.getObjectByName('OG · source-fitted short bus');assert.ok(group);assert.equal(group.children.length,2);
 for(const o of group.children){assert.notEqual(o.geometry,shared);assert.equal(o.userData.component_id,o.name);}
 const bounds=new T.Box3().setFromObject(group);assert.ok(Math.abs(bounds.min.y-GROUND)<1e-6,'joint bus fit rests on Studio ground');assert.ok(Math.abs((bounds.max.y-bounds.min.y)-.122)<1e-6,'rigid grounding retains shared vertical proportions');
});
test('occupied OG high-bay door passages clear the actual complete retained CAD',async()=>{
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 const raw=await fs.readFile(new URL('../public/browser/campus.glb',import.meta.url));
 const n=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+n)),bin=raw.subarray(28+n);
 doc.images=[];doc.textures=[];doc.materials=(doc.materials||[]).map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]},doubleSided:true}));
 let j=Buffer.from(JSON.stringify(doc));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const h=Buffer.alloc(20),bh=Buffer.alloc(8);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+bin.length,8);h.writeUInt32LE(j.length,12);h.write('JSON',16);bh.writeUInt32LE(bin.length);bh.write('BIN\0',4);const packed=Buffer.concat([h,j,bh,bin]);
 const {scene:root}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),'');
 const originals=new Map();for(let n=732;n<=745;n++){const o=root.getObjectByName(`wood_component-${String(n).padStart(4,'0')}`);originals.set(o,o.geometry);}
 const [boat,,club]=add2026OGVehicles(root);root.updateMatrixWorld(true);
 // The curved retained donor roof makes a side gap visible, but the upper
 // sole must actually meet the roof; no invented props or support posts.
 const sole=boat.children.find(o=>o.userData.kind==='flybridge sole');sole.geometry.computeBoundingBox();
 const intoSole=sole.matrixWorld.clone().invert(),soleBox=sole.geometry.boundingBox;let roofContacts=0;
 root.getObjectByName('cad_component-2236').traverse(m=>{if(!m.isMesh)return;const pos=m.geometry.attributes.position,ix=m.geometry.index,mat=intoSole.clone().multiply(m.matrixWorld);for(let i=0;i<(ix?.count??pos.count);i+=3){const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(i+k):i+k).applyMatrix4(mat));if(soleBox.intersectsTriangle(new T.Triangle(...v)))roofContacts++;}});
 assert.ok(roofContacts>0,'source-fitted flybridge sole has actual retained roof triangle contact');
 for(const [o,g] of originals){assert.notEqual(o.geometry,g);const b=new T.Box3().setFromObject(o);assert.ok(b.min.y>=GROUND-1e-5,`${o.name} below ground ${b.min.y}`);assert.ok(b.max.y>.7,'above-ground solar timber remains');}
 for(const x of [1.3,2.4])for(const y of [.15,1,1.95]){
  const a=club.localToWorld(new T.Vector3(x,y,-4.3)),b=club.localToWorld(new T.Vector3(x,y,-3.1)),d=b.clone().sub(a);
  const hits=new T.Raycaster(a,d.clone().normalize(),0,d.length()).intersectObject(root,true);
  assert.deepEqual(hits.map(h=>h.object.name),[],`complete CAD doorway x${x} y${y}`);
 }
});

test('solar grade trim intersects triangles without flattening above-ground timber vertices',()=>{
 const root=new T.Group(),g=new T.BoxGeometry(.12,5,.1);g.rotateZ(.55);const o=new T.Mesh(g,new T.MeshBasicMaterial());o.name='wood_component-0732';o.userData.component_id=o.name;o.position.y=.8;root.add(o);root.updateMatrixWorld(true);
 const input=Array.from(g.attributes.position.array),top=new T.Box3().setFromObject(o).max.y;trimOGSolarAtGrade(root);root.updateMatrixWorld(true);
 assert.deepEqual(Array.from(g.attributes.position.array),input,'cached CAD buffer untouched');assert.notEqual(o.geometry,g);
 const b=new T.Box3().setFromObject(o);assert.ok(Math.abs(b.min.y-GROUND)<1e-6);assert.ok(Math.abs(b.max.y-top)<1e-6);
 const final=o.geometry;trimOGSolarAtGrade(root);assert.equal(o.geometry,final,'idempotent');
});
test('source forklift has four grounded wheels and low unobstructed twin forks',()=>{
 const root=new T.Group(),[,,,,f]=add2026OGVehicles(root);root.updateMatrixWorld(true);
 const tyres=f.children.filter(o=>o.name==='forklift tyre');assert.equal(tyres.length,4);
 for(const tyre of tyres)assert.ok(Math.abs(new T.Box3().setFromObject(tyre).min.y-GROUND)<1e-6);
 const forks=f.children.filter(o=>o.name==='forklift horizontal fork');assert.equal(forks.length,2);
 for(const fork of forks){const b=new T.Box3().setFromObject(fork);assert.ok(b.min.y>GROUND+.09&&b.max.y<GROUND+.20);}
 assert.ok(f.children.some(o=>o.name==='forklift rear propane cylinder'));
 assert.equal(f.children.filter(o=>o.name==='forklift overhead guard post').length,4);
});
