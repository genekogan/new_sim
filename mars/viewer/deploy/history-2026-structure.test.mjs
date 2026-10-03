import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const file=new URL(`../.roof-test-${process.pid}.mjs`,import.meta.url);
await build({entryPoints:['app/history/details-2026-structure.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
const {add2026RoofStructure,correct2026RackFinish,correct2026WestStairOpening}=await import(file.href);after(()=>fs.unlink(file));
test('actual CAD roof supports connect retained posts to sheet undersides',async()=>{
 const b=await fs.readFile('public/modular/campus-components.glb'),n=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+n));
 j.images=[];j.textures=[];j.materials=j.materials.map(()=>({}));
 let text=Buffer.from(JSON.stringify(j));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);
 const bin=b.subarray(20+n),h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(20+text.length+bin.length,8);h.writeUInt32LE(text.length,12);h.write('JSON',16);
 const data=Buffer.concat([h,text,bin]);const {scene}=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 let deck;scene.traverse(o=>{if(o.userData.component_id==='wood_component-0014'&&o.isMesh)deck=o;});assert.ok(deck);
 const originalGeometry=deck.geometry,originalPositions=originalGeometry.attributes.position.array.slice();
 const frame=new T.Matrix4().set(.9045,0,.4265,0,.4265,0,-.9045,0,0,1,0,0,0,0,0,1).invert();
 const probe=(u,v)=>{const point=new T.Vector3(u,v,3.5).applyMatrix4(frame);const ray=new T.Raycaster(point,new T.Vector3(0,-1,0),0,.8);return ray.intersectObject(deck);};
 scene.updateMatrixWorld(true);assert.ok(probe(-1.95,1.4).length,'original intermediate deck crosses stair');
 assert.equal(correct2026WestStairOpening(scene),true);assert.equal(probe(-1.95,1.4).length,0,'lower flight opening is clear');
 assert.ok(probe(-3,1.4).length,'adjacent landing remains');assert.equal(deck.userData.component_id,'wood_component-0014');assert.deepEqual(originalGeometry.attributes.position.array,originalPositions,'source shared geometry is untouched');assert.equal(correct2026WestStairOpening(scene),false);
 const g=add2026RoofStructure(scene);assert.ok(g,'recognized main hall retained post frame');scene.updateMatrixWorld(true);
 const beams=g.children.filter(o=>o.userData.kind==='observed roof orange rack beam'),joists=g.children.filter(o=>o.userData.kind==='observed standing timber roof joist');
 assert.equal(beams.length,30);assert.equal(joists.length,19);
 for(const beam of beams){const top=new T.Box3().setFromObject(beam).max.y;for(const id of beam.userData.support_post_ids){const post=scene.getObjectByProperty('userData.component_id',id)||(()=>{let found;scene.traverse(o=>{if(o.userData.component_id===id)found=o;});return found;})();assert.ok(post);assert.ok(Math.abs(new T.Box3().setFromObject(post).max.y-top)<.001,'beam terminates at post top');}}
 const ray=new T.Raycaster();for(const joist of joists){const center=joist.getWorldPosition(new T.Vector3());ray.set(new T.Vector3(center.x,6.3,center.z),new T.Vector3(0,-1,0));ray.far=.4;assert.ok(ray.intersectObject(joist).length,'joist occupies actual ceiling gap');const box=new T.Box3().setFromObject(joist);assert.ok(Math.abs(box.min.y-5.979141)<.001);assert.ok(Math.abs(box.max.y-6.162167)<.001);}
 const before=g.children.length;add2026RoofStructure(scene);assert.equal(g.children.length,before);assert.equal(scene.getObjectByName(g.name),g);
});

test('rack finish changes preserve shared source materials, geometry and IDs',()=>{
 const root=new T.Group(),old=new T.MeshStandardMaterial({color:'#777777'}),geometry=new T.BoxGeometry(.08,5.9,.08);
 const upright=new T.Mesh(geometry,old);upright.userData={kind:'rack_member',component_id:'rack-test-u'};root.add(upright);
 const beam=new T.Mesh(new T.BoxGeometry(3.65,.12,.08),old);beam.userData={kind:'rack_member',component_id:'rack-test-b'};root.add(beam);
 const tie=new T.Mesh(new T.BoxGeometry(1,.05,.05),old);tie.userData={kind:'rack_member',component_id:'rack-test-t'};root.add(tie);
 const unrelated=new T.Mesh(geometry,old);root.add(unrelated);
 assert.equal(correct2026RackFinish(root),3);
 assert.equal(upright.material.color.getHexString(),'237ba5');assert.equal(beam.material.color.getHexString(),'c35b2d');assert.equal(tie.material,upright.material);
 assert.equal(unrelated.material,old);assert.equal(old.color.getHexString(),'777777');assert.equal(upright.geometry,geometry);assert.equal(upright.userData.component_id,'rack-test-u');
 assert.equal(correct2026RackFinish(root),0);
});

test('browser hierarchy applies finish and hatch to anonymous meshes under component groups',()=>{
 const root=new T.Group(),rack=new T.Group();rack.userData={kind:'rack_member',component_id:'browser-rack'};const post=new T.Mesh(new T.BoxGeometry(.08,5,.08),new T.MeshStandardMaterial());rack.add(post);root.add(rack);
 const deck=new T.Group();deck.userData={component_id:'wood_component-0014'};
 const frame=new T.Matrix4().set(.9045,0,.4265,0,.4265,0,-.9045,0,0,1,0,0,0,0,0,1).invert();
 const mesh=new T.Mesh(new T.BoxGeometry(5,5,.07).translate(-2,1.5,3.08).applyMatrix4(frame),new T.MeshStandardMaterial({side:T.DoubleSide}));deck.add(mesh);root.add(deck);root.updateMatrixWorld(true);
 assert.equal(correct2026RackFinish(root),1);assert.equal(post.material.color.getHexString(),'237ba5');
 assert.equal(correct2026WestStairOpening(root),true);
 const origin=new T.Vector3(-1.95,1.4,3.5).applyMatrix4(frame),ray=new T.Raycaster(origin,new T.Vector3(0,-1,0),0,.8);assert.equal(ray.intersectObject(mesh).length,0);
 assert.equal(deck.userData.component_id,'wood_component-0014');
});
