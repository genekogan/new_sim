import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
// Geometry-only harness: photographed surfaces use real browser loaders in production.
T.TextureLoader.prototype.load=function(){return new T.Texture();};
const file=new URL(`../.compound-test-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:"export * from './app/history/details-2026-compound';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname});
const {add2026CompoundDetails,add2026DojoDetails,add2026CabinDetails,add2026CompletedKitchen}=await import(file.href);after(()=>fs.unlink(file));
test('2026 compound details attach to existing CAD without moving or replacing its pieces',()=>{
 const root=new T.Group(),host=new T.Group();host.userData.assembly_id='northeast-compound';host.position.set(44,0,-95);root.add(host);
 const base=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());base.userData.component_id='existing-cad-component';host.add(base);const before=base.matrix.clone();
 const [g]=add2026CompoundDetails(root);assert.equal(g.parent,host);assert.deepEqual(base.matrix,before);assert.equal(base.parent,host);
 root.updateMatrixWorld(true);const p=g.getWorldPosition(new T.Vector3());assert.ok(p.distanceTo(new T.Vector3())>90,'compound remains far from Chiba');
 const ids=[];host.traverse(o=>{if(o.isMesh&&o!==base){assert.ok(o.userData.source);ids.push(o.userData.component_id);}});assert.equal(ids.length,new Set(ids).size);assert.ok(ids.length>40);
 assert.equal(add2026CompoundDetails(root)[0],g,'repeated integration is idempotent');
});
test('actual kitchen CAD serving aperture is open while spandrel, head and existing entrance survive',async()=>{
 const path=new URL('../public/modular/campus-components.glb',import.meta.url);
 // This test operates on the local uncompressed source geometry, not a box surrogate.
 const data=await fs.readFile(path),jsonLength=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+jsonLength).toString()),binStart=28+jsonLength;
 const node=doc.nodes.find(n=>n.extras?.component_id==='wood_component-1633'),primitive=doc.meshes[node.mesh].primitives[0];
 function array(id){const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],count=a.count*(a.type==='VEC3'?3:1),offset=binStart+(v.byteOffset||0)+(a.byteOffset||0);return a.componentType===5126?new Float32Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*4)):a.componentType===5123?new Uint16Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*2)):new Uint32Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*4));}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(array(primitive.attributes.POSITION),3));geometry.setIndex(new T.BufferAttribute(array(primitive.indices),1));
 const root=new T.Group(),host=new T.Group();host.userData.assembly_id='northeast-compound';root.add(host);const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.position.fromArray(node.translation);mesh.userData.component_id='wood_component-1633';host.add(mesh);
 const before=geometry.getAttribute('position').array.slice();add2026CompoundDetails(root);root.updateMatrixWorld(true);assert.notEqual(mesh.geometry,geometry);assert.deepEqual(geometry.getAttribute('position').array,before,'shared input geometry stays intact');
 const facade=new T.Matrix4().compose(new T.Vector3(-.1,0,-4.2),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.324),new T.Vector3(1,1,1));
 const hit=(x,y)=>new T.Raycaster(new T.Vector3(x,y,4).applyMatrix4(facade),new T.Vector3(0,0,-1).transformDirection(facade),0,5).intersectObject(mesh).length;
 assert.equal(hit(-3,1.7),0,'serving opening admits sightline');assert.ok(hit(-3,.6),'lower plywood spandrel retained');assert.ok(hit(-3,2.38),'upper plywood beneath photo-fitted shallow roof retained');assert.equal(hit(3.3,1),0,'existing right entrance retained');
});
test('actual CoLab side window cut preserves sill and head',async()=>{
 const path=new URL('../public/modular/campus-components.glb',import.meta.url);
 // This test operates on the local uncompressed source geometry, not a box surrogate.
 const data=await fs.readFile(path),jsonLength=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+jsonLength).toString()),binStart=28+jsonLength;
 const node=doc.nodes.find(n=>n.extras?.component_id==='wood_component-1830'),primitive=doc.meshes[node.mesh].primitives[0];
 function array(id){const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],count=a.count*(a.type==='VEC3'?3:1),offset=binStart+(v.byteOffset||0)+(a.byteOffset||0);return a.componentType===5126?new Float32Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*4)):a.componentType===5123?new Uint16Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*2)):new Uint32Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*4));}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(array(primitive.attributes.POSITION),3));geometry.setIndex(new T.BufferAttribute(array(primitive.indices),1));
 const root=new T.Group(),host=new T.Group();host.userData.assembly_id='northeast-compound';root.add(host);const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.position.fromArray(node.translation);mesh.userData.component_id='wood_component-1830';host.add(mesh);
 const before=geometry.getAttribute('position').array.slice();add2026CompoundDetails(root);root.updateMatrixWorld(true);assert.notEqual(mesh.geometry,geometry);assert.deepEqual(geometry.getAttribute('position').array,before,'shared input geometry stays intact');
 const facade=new T.Matrix4().compose(new T.Vector3(3.35,0,14.97),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.736),new T.Vector3(1,1,1));
 const hit=(z,y)=>new T.Raycaster(new T.Vector3(-6,y,z).applyMatrix4(facade),new T.Vector3(1,0,0).transformDirection(facade),0,3).intersectObject(mesh).length;
 assert.equal(hit(0,1.5),0,'long glazing aperture is real');assert.ok(hit(0,.5),'lower wall retained');assert.ok(hit(0,2.3),'upper wall retained');
});
test('actual library broad window is cut beside preserved entrance',async()=>{
 const path=new URL('../public/modular/campus-components.glb',import.meta.url);
 // This test operates on the local uncompressed source geometry, not a box surrogate.
 const data=await fs.readFile(path),jsonLength=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+jsonLength).toString()),binStart=28+jsonLength;
 const node=doc.nodes.find(n=>n.extras?.component_id==='wood_component-1145'),primitive=doc.meshes[node.mesh].primitives[0];
 function array(id){const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],count=a.count*(a.type==='VEC3'?3:1),offset=binStart+(v.byteOffset||0)+(a.byteOffset||0);return a.componentType===5126?new Float32Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*4)):a.componentType===5123?new Uint16Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*2)):new Uint32Array(data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*4));}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(array(primitive.attributes.POSITION),3));geometry.setIndex(new T.BufferAttribute(array(primitive.indices),1));
 const root=new T.Group(),host=new T.Group();host.userData.assembly_id='northeast-compound';root.add(host);const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.position.fromArray(node.translation);mesh.userData.component_id='wood_component-1145';host.add(mesh);
 const before=geometry.getAttribute('position').array.slice();add2026CompoundDetails(root);root.updateMatrixWorld(true);assert.notEqual(mesh.geometry,geometry);assert.deepEqual(geometry.getAttribute('position').array,before,'shared input geometry stays intact');
 const facade=new T.Matrix4().compose(new T.Vector3(-2.9,0,5.2),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.56),new T.Vector3(1,1,1));
 const hit=(x,y)=>new T.Raycaster(new T.Vector3(x,y,-4).applyMatrix4(facade),new T.Vector3(0,0,1).transformDirection(facade),0,3).intersectObject(mesh).length;
 assert.equal(hit(1,1.5),0,'window aperture is real');assert.ok(hit(1,.5),'lower wall retained');assert.ok(hit(1,2.2),'upper wall retained');assert.equal(hit(-1.8,1),0,'original entrance retained');
});

test('Dojo detail layer stays on separate square assembly and has clear entry and clerestory',()=>{
 const root=new T.Group(),host=new T.Group();host.userData.assembly_id='north-rack-building';host.position.set(6,0,-83);root.add(host);
 const [g]=add2026DojoDetails(root);assert.equal(g.parent,host);root.updateMatrixWorld(true);
 const ray=(y)=>new T.Raycaster(g.localToWorld(new T.Vector3(-1.8,y,5)),new T.Vector3(0,0,-1).transformDirection(g.matrixWorld),0,2).intersectObject(g,true);
 assert.equal(ray(1).length,0,'front entrance remains walkable');assert.equal(ray(4.1).length,0,'clerestory under retained CAD roof stays open');assert.ok(ray(3).length,'plywood lintel remains');
 const ids=[];let mats=0;g.traverse(o=>{if(o.isMesh){ids.push(o.userData.component_id);assert.ok(o.userData.source);if(o.name==='Dojo dark interlocking foam floor tile')mats++;}});
 assert.equal(ids.length,new Set(ids).size);assert.equal(mats,144);assert.equal(add2026DojoDetails(root)[0],g);
});
test('Dojo passage clears retained full CAD at ankle, torso and head height across walking width',async()=>{
 const data=await fs.readFile(new URL('../public/modular/campus-components.glb',import.meta.url)),jsonLength=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+jsonLength).toString()),binStart=28+jsonLength;
 function array(id){const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],count=a.count*(a.type==='VEC3'?3:1),offset=binStart+(v.byteOffset||0)+(a.byteOffset||0),size=a.componentType===5123?2:4,buf=data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*size);return a.componentType===5126?new Float32Array(buf):a.componentType===5123?new Uint16Array(buf):new Uint32Array(buf);}
 const root=new T.Group(),host=new T.Group();host.userData.assembly_id='north-rack-building';host.position.set(6,0,-83);root.add(host);
 for(const node of doc.nodes.filter(n=>n.extras?.assembly_id==='north-rack-building'&&n.mesh!==undefined))for(const p of doc.meshes[node.mesh].primitives){
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(array(p.attributes.POSITION),3));geometry.setIndex(new T.BufferAttribute(array(p.indices),1));const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.userData={...node.extras};if(node.translation)mesh.position.fromArray(node.translation);if(node.rotation)mesh.quaternion.fromArray(node.rotation);if(node.scale)mesh.scale.fromArray(node.scale);host.add(mesh);
 }
 const [g]=add2026DojoDetails(root);root.updateMatrixWorld(true);
 for(const x of [-2.35,-2.075,-1.8,-1.525,-1.25])for(const y of [.12,.85,1.75,2.05]){
  const ray=new T.Raycaster(g.localToWorld(new T.Vector3(x,y,5)),new T.Vector3(0,0,-1).transformDirection(g.matrixWorld),0,3.2);
  const hits=ray.intersectObject(host,true);assert.equal(hits.length,0,`entry x${x} y${y} blocked by ${hits.map(h=>h.object.userData.component_id||h.object.name).join(',')}`);
 }
});
test('all five retained cabin solids get real doors without rear through-holes',async()=>{
 const data=await fs.readFile(new URL('../public/modular/campus-components.glb',import.meta.url)),jsonLength=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+jsonLength).toString()),binStart=28+jsonLength;
 function array(id){const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],count=a.count*(a.type==='VEC3'?3:1),offset=binStart+(v.byteOffset||0)+(a.byteOffset||0),size=a.componentType===5123?2:4,buf=data.buffer.slice(data.byteOffset+offset,data.byteOffset+offset+count*size);return a.componentType===5126?new Float32Array(buf):a.componentType===5123?new Uint16Array(buf):new Uint32Array(buf);}
 const root=new T.Group(),host=new T.Group();host.userData.assembly_id='site-context';root.add(host);
 for(const node of doc.nodes.filter(n=>n.extras?.assembly_id==='site-context'&&n.mesh!==undefined))for(const p of doc.meshes[node.mesh].primitives){
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(array(p.attributes.POSITION),3));geometry.setIndex(new T.BufferAttribute(array(p.indices),1));const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.userData={...node.extras};if(node.translation)mesh.position.fromArray(node.translation);if(node.rotation)mesh.quaternion.fromArray(node.rotation);if(node.scale)mesh.scale.fromArray(node.scale);host.add(mesh);
 }
 const [g]=add2026CabinDetails(root);root.updateMatrixWorld(true);
 const ids=['wood_component-1984','wood_component-1980','wood_component-1981','wood_component-1983','wood_component-1982'];
 for(const id of ids){const hut=host.children.find(o=>o.userData.component_id===id);assert.ok(hut);const frame=new T.Matrix4().compose(new T.Vector3(hut.position.x,0,hut.position.z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),id==='wood_component-1984'?-.78366:-.69813),new T.Vector3(1,1,1));
  for(const y of [.2,1,1.9])for(const x of [-.80,-.5,-.2]){const ray=new T.Raycaster(new T.Vector3(x,y,-2).applyMatrix4(frame),new T.Vector3(0,0,1).transformDirection(frame),0,1);assert.equal(ray.intersectObject(host,true).length,0,`${id} door ray ${x},${y}: ${ray.intersectObject(host,true).map(h=>h.object.name||h.object.userData.component_id).join(',')}`);}
  const rear=new T.Raycaster(new T.Vector3(-.5,.6,2).applyMatrix4(frame),new T.Vector3(0,0,-1).transformDirection(frame),0,1);assert.ok(rear.intersectObject(hut).length,'rear lower wall not accidentally cut by front aperture');
 }
 const idsAdded=[];g.traverse(o=>{if(o.isMesh)idsAdded.push(o.userData.component_id);});assert.equal(idsAdded.length,new Set(idsAdded).size);
});

test('completed kitchen rear corners have glass while center plywood survives',async()=>{
 const data=await fs.readFile(new URL('../public/modular/campus-components.glb',import.meta.url)),len=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+len)),start=28+len;
 const root=new T.Group(),host=new T.Group();host.userData.assembly_id='northeast-compound';root.add(host);
 for(const id of ['wood_component-1469','wood_component-1468']){
  const n=doc.nodes.find(n=>n.extras?.component_id===id),p=doc.meshes[n.mesh].primitives[0];
  const arr=(i)=>{const a=doc.accessors[i],v=doc.bufferViews[a.bufferView],sz=a.componentType===5123?2:4,count=a.count*(a.type==='VEC3'?3:1),off=start+(v.byteOffset||0)+(a.byteOffset||0),b=data.buffer.slice(data.byteOffset+off,data.byteOffset+off+count*sz);return a.componentType===5126?new Float32Array(b):sz===2?new Uint16Array(b):new Uint32Array(b);};
  const geom=new T.BufferGeometry();geom.setAttribute('position',new T.BufferAttribute(arr(p.attributes.POSITION),3));geom.setIndex(new T.BufferAttribute(arr(p.indices),1));const m=new T.Mesh(geom,new T.MeshBasicMaterial({side:T.DoubleSide}));m.position.fromArray(n.translation);m.userData={...n.extras};host.add(m);
 }
 const [g]=add2026CompletedKitchen(root);root.updateMatrixWorld(true);
 const rear=host.children.find(o=>o.userData.component_id==='wood_component-1469');
 const cast=(x,y)=>new T.Raycaster(g.localToWorld(new T.Vector3(x,y,-3)),new T.Vector3(0,0,1).transformDirection(g.matrixWorld),0,2).intersectObject(rear);
 assert.equal(cast(-3,1.7).length,0);assert.equal(cast(3,1.7).length,0);assert.ok(cast(0,1.7).length,'central pan wall retained');assert.ok(cast(-3,.6).length,'lower spandrel retained');
 const end=host.children.find(o=>o.userData.component_id==='wood_component-1468');assert.equal(new T.Raycaster(g.localToWorld(new T.Vector3(-6,1.7,0)),new T.Vector3(1,0,0).transformDirection(g.matrixWorld),0,2).intersectObject(end).length,0);
 assert.equal(add2026CompletedKitchen(root)[0],g);
});
