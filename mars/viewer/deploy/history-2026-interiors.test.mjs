import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-2026-interior-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export * from './app/history/details-2026-chiba';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(){return new T.Texture();};
const {add2026ChibaInteriors}=await import(file.href);after(()=>fs.unlink(file));
const meshes=(o,kind)=>{const found=[];o.traverse(m=>{if(m.isMesh&&(!kind||m.userData.kind===kind))found.push(m);});return found;};
test('2026 interiors are attached in Chiba local CAD frame and replace obsolete details once',()=>{
 const root=new T.Group(),chiba=new T.Group();chiba.name='Chiba';chiba.position.set(50,1,-30);root.add(chiba);
 const first=add2026ChibaInteriors(root),second=add2026ChibaInteriors(root);
 assert.ok(first.every(g=>!g.parent));assert.equal(chiba.children.length,2);assert.ok(second.every(g=>g.parent===chiba));
 assert.equal(second[0].position.y,.37);assert.equal(second[1].position.y,.37);assert.ok(second[1].position.z<0,'Mimos belongs to north glazed annex, not main-hall solar frontage');
 assert.ok(Math.abs(second[0].rotation.y+Math.atan2(.4265,.9045))<1e-8);
 const ids=meshes(chiba).map(m=>m.userData.component_id);assert.equal(new Set(ids).size,ids.length);
});
test('2026 kitchen island has longitudinal backsplash and preserves an aisle beside imported CAD counter',()=>{
 const [g]=add2026ChibaInteriors(new T.Group());const top=meshes(g,'commissary steel prep top')[0],splash=meshes(g,'commissary longitudinal backsplash')[0];
 assert.equal(top.geometry.parameters.depth,splash.geometry.parameters.depth);
 assert.ok(splash.position.x<top.position.x-.5);assert.equal(splash.position.z,top.position.z);
 assert.ok(top.geometry.parameters.depth>2,'longitudinal source prep surface; real retained-counter aisle probed in actual-browser test');
 assert.equal(meshes(g,'commercial refrigerator door').length,2);assert.equal(meshes(g,'commissary chest freezer').length,1);
});
test('2026 interior furniture stands on its local CAD floor without ground-seating artifacts',()=>{
 const groups=add2026ChibaInteriors(new T.Group());for(const g of groups){g.updateMatrixWorld(true);for(const m of meshes(g)){
  m.geometry.computeBoundingBox();const b=m.geometry.boundingBox.clone().applyMatrix4(m.matrix);
  assert.ok(b.min.y+g.position.y>=-.161,`${m.name} must not extend below Studio sand datum`);
 }}
 const cafe=groups[1];assert.equal(meshes(cafe,'Mimos gravity water filter').length,1);assert.equal(meshes(cafe,'Mimos tea pantry shelf').length,5);assert.equal(meshes(cafe,'Mimos red mini refrigerator').length,1);assert.equal(meshes(cafe,'Mimos photographed cutout sign').length,1);
});

test('retained CAD former window wall preserves identity as full ground-level internal dining passage',()=>{
 const root=new T.Group(),chiba=new T.Group();chiba.name='Chiba';root.add(chiba);
 const wall=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial({side:T.DoubleSide}));wall.name='wood_component-0018';wall.userData.component_id=wall.name;chiba.add(wall);
 const [g]=add2026ChibaInteriors(root);root.updateMatrixWorld(true);
 assert.equal(wall.parent,chiba);assert.equal(wall.userData.component_id,'wood_component-0018');
 const ray=(x,y)=>{const start=g.localToWorld(new T.Vector3(x,y,-3.8)),end=g.localToWorld(new T.Vector3(x,y,-4.8));return new T.Raycaster(start,end.sub(start).normalize(),0,1).intersectObject(wall).length;};
 for(const x of [1.42,3.18,6.20])assert.equal(ray(x,1.4),0,'window must be an aperture, not a dark panel on an intact wall');
 for(const [x,y]of [[4.5,1.4],[6.20,.12],[6.20,1.9]])assert.equal(ray(x,y),0,'photo c47859 ground-level internal passage');assert.ok(ray(6.2,2.3)>0,'header retained above passage');
 assert.equal(meshes(g,'diner blue pedestal tabletop').length,3);assert.equal(meshes(g,'diner gray bus seat back').length,6);assert.equal(meshes(g,'kitchen white refrigerator carcass').length,1);
 const partition=meshes(g,'late kitchen diner partial partition')[0];assert.ok(partition,'photographed pegboard/partial divider retained; actual passage ray gate in compressed-browser test');
});
