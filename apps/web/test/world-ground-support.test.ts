import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {groundTriangleSampler} from '../../../mars/viewer/lib/ground-triangles.ts';
import {authoredBoundarySweepFraction} from '../../../mars/viewer/lib/authored-boundaries.ts';
import {Builder,Materials} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/kit.ts';
import {Terrain} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/terrain.ts';
import {publishedGroundSampler} from '../src/WorldPublishedGround.ts';
import {createWorldGroundDetails} from '../src/WorldGroundDetails.ts';
import {WindPatches} from '../src/atmosphere/wind.ts';
import {decorationGround} from '../../../mars/viewer/app/engine-view/content/assets/eden-imports/assets.ts';
import {createEdenAnimals,agentAt} from '../../../mars/viewer/app/engine-view/content/assets/eden-imports/animals.ts';
import {HERDS} from '../../../mars/viewer/app/engine-view/content/assets/eden-imports/animal-plan.ts';

function hit(mesh:THREE.Mesh,x:number,z:number){mesh.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh,false)[0]?.point.y??null;}
test('triangle support is the actually drawn Float32 surface, including transforms and holes',()=>{
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,.123456789,0,2,1.23456789,0,2,3.23456789,2,0,.123456789,0,2,3.23456789,2,0,-.987654321,2],3));
 const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.position.set(20,3,-7);m.rotation.y=.47;
 const sampler=groundTriangleSampler(m);
 for(const [x,z]of[[.2,.1],[1.6,.2],[.2,1.6],[1.6,1.7]]){const p=new THREE.Vector3(x,0,z).applyMatrix4(m.matrixWorld),want=hit(m,p.x,p.z);assert.notEqual(want,null);assert.ok(Math.abs(sampler.heightAt(p.x,p.z)!-want!)<1e-8);}
 assert.equal(sampler.heightAt(500,500),null);const before=sampler.heightAt(20,-7);g.attributes.position.setY(0,900);assert.equal(sampler.heightAt(20,-7),before,'source mutations cannot rewrite a frozen sampled surface');g.dispose();(m.material as THREE.Material).dispose();
});
test('regional decoration samples rendered hill triangles; inner/native hole remains a hole',()=>{
 const t=new Terrain(()=>0),group=new THREE.Group(),mats=new Materials(),geos:THREE.BufferGeometry[]=[];t.build(group,mats,geos);const mesh=group.children[0] as THREE.Mesh;
 for(const [x,z]of[[226.4,-22.7],[-60.1,-200.2],[350.5,-200.7]]){const want=hit(mesh,x,z);assert.notEqual(want,null);assert.ok(Math.abs(t.sampleRenderedGround(x,z)!-want!)<1e-7);}
 assert.equal(t.sampleRenderedGround(0,0),null);assert.ok(t.sampleRenderedGround(226,-22)!>15,'a hillside animal no longer gets invented Y0');geos.forEach(g=>g.dispose());mats.dispose();
});
test('published native bed wins over clearance ground; upper floors and absent terrain do not grant ground',()=>{
 const info:any={scene:{surfaces:[{level:0,y:0,obb:{c:[1,1],half:[10,10],yaw:0}},{level:1,y:8,obb:{c:[1,1],half:[10,10],yaw:0}}]},shore:{metadata:{terrain:{originXZ:[0,0],spacingMetres:1,columns:2,rows:2,heightMetres:[[-2,-1],[-1,1]]}}}};
 const sample=publishedGroundSampler(info);assert.equal(sample(.5,.25),-1);assert.equal(sample(-2,-2),0);assert.equal(sample(50,50),null);
 assert.equal(decorationGround(()=>null,50,50),null);assert.equal(decorationGround(()=>null,50,50,-2.15),-2.15,'explicit water support remains authored');
});
test('every meadow root follows its supplied surface, even above Y26 and across relief',()=>{
 const ground=(x:number,z:number)=>40+.04*x-.03*z,owner=createWorldGroundDetails(ground),camera=new THREE.PerspectiveCamera();camera.position.set(10,ground(10,0)+2,0);camera.updateMatrixWorld(true);owner.meadow.follow(camera);assert.ok(owner.meadow.counts.tufts>100);
 const matrix=new THREE.Matrix4(),p=new THREE.Vector3();for(const mesh of[owner.meadow.tufts,owner.meadow.blooms])for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);p.setFromMatrixPosition(matrix);assert.ok(Math.abs(p.y-ground(p.x,p.z))<5e-6,'each offset root is grounded, not only its cell centre');}
 owner.dispose();
});
test('wind excludes unanchored world-space batches and separates grass/crown shader programs',()=>{
 const root=new THREE.Group(),grass=new THREE.InstancedMesh(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([-.1,0,0,.1,0,0,0,.2,0],3)),new THREE.MeshStandardMaterial(),1);grass.name='vegetation:blade:grass';grass.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,50,0));root.add(grass);
 const crown=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshStandardMaterial(),1);crown.name='vegetation:ball:leaf';root.add(crown);
 const b=new Builder();b.box('bark',20,50,30,1,5,1,'#777');const mats=new Materials(),geos:THREE.BufferGeometry[]=[];b.emit(root,mats,'world-space grove',geos);
 const patches=new WindPatches();patches.scan(root,0);assert.equal(patches.count,2,'merged rootless grove is refused; only anchored instances sway');assert.notEqual((grass.material as THREE.Material).customProgramCacheKey(),(crown.material as THREE.Material).customProgramCacheKey());
 const shader:any={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>',uniforms:{}};(grass.material as THREE.Material).onBeforeCompile(shader,{} as any);assert.ok(shader.vertexShader.includes('min(edenHL,1.0)'));assert.ok(!shader.vertexShader.includes('edenHL+edenHO*.1'),'root flutter does not inherit absolute terrain altitude');assert.equal(shader.uniforms.uEdenWindP.value.y,0,'grass base has no origin-height bending term');patches.dispose();grass.geometry.dispose();crown.geometry.dispose();(grass.material as THREE.Material).dispose();(crown.material as THREE.Material).dispose();geos.forEach(g=>g.dispose());mats.dispose();
});
test('actual Builder prism records survive merged sectors; doorway and elevated bands use the same eye/body sweep',()=>{
 const b=new Builder(),sink=new Builder(),group=new THREE.Group(),mats=new Materials(),geos:THREE.BufferGeometry[]=[];b.push(10,4,20,.5);
 b.boundary('wall',-1,0,0,1,2.3,.18,'house','left');b.boundary('wall',1,0,0,1,2.3,.18,'house','right');b.boundary('guard',0,0,2,3,1.05,.08,'house','front');b.pop();b.drain(()=>sink);sink.emit(group,mats,'sector',geos);
 const boxes=group.userData.edenAuthoredBoundaries;assert.equal(boxes.length,3);const at=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).applyMatrix4(new THREE.Matrix4().makeTranslation(10,4,20).multiply(new THREE.Matrix4().makeRotationY(.5))).toArray();
 assert.equal(authoredBoundarySweepFraction(boxes,at(0,.9,-1),at(0,.9,1),.2,.9,.9),1,'the actual doorway stays open');assert.ok(authoredBoundarySweepFraction(boxes,at(-1,.9,-1),at(-1,.9,1),.2,.9,.9)<1,'a body cannot cross the same wall');assert.ok(authoredBoundarySweepFraction(boxes,at(0,1.6,1.6),at(0,1.6,2.5),.08,1.65,.1)<1,'eye/feet cannot rise over a waist-high guard');assert.equal(authoredBoundarySweepFraction(boxes,[10,.9,19],[10,.9,22],.2,.9,.9),1,'upper bands are not extruded to ground');geos.forEach(g=>g.dispose());mats.dispose();
});
test('real animation mixer owns a local model below a grounded placement parent',async()=>{
 const model=new THREE.Group();model.name='dog';model.add(new THREE.Mesh(new THREE.BoxGeometry(.3,.5,.6),new THREE.MeshStandardMaterial()));const scene=new THREE.Group();scene.add(model);const clip=new THREE.AnimationClip('dog|Walk',1,[new THREE.VectorKeyframeTrack('dog.position',[0,1],[0,0,0,0,.3,0])]);
 const owner=createEdenAnimals((x,z)=>30+.1*x+.03*z,async()=>({scene,animations:[clip]} as any));await Promise.resolve();const root=owner.group.getObjectByName('animal dogs-commons-0')!;assert.ok(root);const camera=new THREE.PerspectiveCamera();camera.position.set(0,35,0);camera.updateMatrixWorld(true);const hook=owner.group.getObjectByName('animals: frame hook') as THREE.Mesh;hook.onBeforeRender({} as any,new THREE.Scene(),camera,hook.geometry,hook.material as any,null as any);
 const p=root.position;assert.ok(Math.abs(p.y-(30+.1*p.x+.03*p.z))<1e-8);assert.equal(root.children[0].name,'dog','clip binding names are preserved on the local model');assert.notEqual(root.children[0].position.y,p.y,'mixer cannot replace world support height');const row=HERDS.find(h=>h.id==='dogs-commons')!;assert.equal(agentAt(row,'dogs-commons-0',123).length,4);owner.dispose();
});
