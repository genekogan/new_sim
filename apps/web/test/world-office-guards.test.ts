import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {officeStairGuardBoxes,officeGuardSweepFraction} from '../../../mars/viewer/lib/office-stair-guards.ts';
import {constrainOfficeGuardCamera,officeGuardsFromPublication} from '../src/WorldOfficeGuards.ts';
import {createOfficeStairGuardAssembly} from '../../../mars/viewer/app/engine-view/content/assets/office-building-proposal/stair-guards.ts';
import {createEdenPublicQuarter} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/public-quarter.ts';
import {applyWorldRealism,buildingPaletteOf,disposeBuildingIdentity} from '../src/WorldEdenRealism.ts';
import {createEdenNeighborhood} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/neighborhood.ts';

const guards=officeStairGuardBoxes();
test('only an exact guard fact captured by the depicted tick supplies drawing and collision bands',()=>{
 const captured={body:{scene:{officeStairGuards:{version:'office-stair-guards/1',acceptedAtTick:250,guards}}}};
 assert.deepEqual(officeGuardsFromPublication(captured,250),guards);
 assert.deepEqual(officeGuardsFromPublication(captured,249),[]);
 assert.deepEqual(officeGuardsFromPublication({body:{scene:{}}},1000),[]);
 for(const mutate of[(v:typeof captured)=>{v.body.scene.officeStairGuards.guards[0].max[1]=Infinity;},
  (v:typeof captured)=>{v.body.scene.officeStairGuards.acceptedAtTick=-1;},
  (v:typeof captured)=>{v.body.scene.officeStairGuards.guards.pop();},
  (v:typeof captured)=>{v.body.scene.officeStairGuards.guards[0].min[1]=0;}]){
  const invalid=structuredClone(captured);mutate(invalid);assert.deepEqual(officeGuardsFromPublication(invalid,1000),[]);
 }
});

test('default old office assembly is unchanged; the captured guard owner alone adds the new draw',()=>{
 const old=createEdenPublicQuarter(()=>0)!,next=createEdenPublicQuarter(()=>0,guards)!;
 try{
  assert.equal(old.group.getObjectByName('eden-office-1:stair-guards'),undefined);
  assert.ok(next.group.getObjectByName('eden-office-1:stair-guards'));
  assert.deepEqual(old.plan,next.plan,'architectural footprints, original floors/stairs and other buildings unchanged');
  assert.deepEqual(old.group.getObjectByName('eden-office-1')!.userData,next.group.getObjectByName('eden-office-1')!.userData);
  assert.equal(next.group.children.length,old.group.children.length+1);
 }finally{old.dispose();next.dispose();}
});

test('adding guards before the original office leaves its assigned palette and actual finish unchanged',()=>{
 const finish=(withGuards:boolean)=>{
  disposeBuildingIdentity();const root=new THREE.Group(),neighborhood=createEdenNeighborhood(()=>0,{houseOne:'direct-courtyard',houseThree:'lower-roof-route'})!,owner=createEdenPublicQuarter(()=>0,withGuards?guards:[])!;
  root.add(neighborhood.group,owner.group); // Actual production neighbour and public-quarter ordering.
  try{
   applyWorldRealism(root,{buildings:true});
   const office=owner.group.getObjectByName('eden-office-1')!,mesh=office.children[0] as THREE.Mesh;
   const material=mesh.material as THREE.MeshStandardMaterial;
   const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}} as THREE.WebGLProgramParametersWithUniforms;
   material.onBeforeCompile(shader,{} as THREE.WebGLRenderer);
   return {palette:buildingPaletteOf('eden-office-1'),style:shader.uniforms.edenStyle.value.toArray(),paint:shader.uniforms.edenPaint.value.toArray(),trim:shader.uniforms.edenTrim.value.toArray(),guardPalette:buildingPaletteOf('eden-office-1:stair-guards')};
  }finally{disposeBuildingIdentity();owner.dispose();neighborhood.dispose();}
 };
 const original=finish(false),guarded=finish(true);assert.notEqual(original.palette,null);
 assert.deepEqual(guarded,original,'guards must not consume a neighbouring building finish before the office');
 assert.equal(guarded.guardPalette,null,'a rail assembly is not a second building');
});
test('upper office guards block a fast camera crossing on three sides while preserving the gaze',()=>{
 for(const floor of[3.1,6.1])for(const[from,to]of[
  [[86.7,floor+1.65,15],[88,floor+1.65,15]],
  [[88,floor+1.65,13],[88,floor+1.65,14]],
  [[89.7,floor+1.65,15],[88,floor+1.65,15]]]){
  const camera=new THREE.PerspectiveCamera(),start=new THREE.Vector3(...from);camera.position.fromArray(to);
  const target=camera.position.clone().add(new THREE.Vector3(.5,.2,-1));camera.lookAt(target);
  const direction=camera.getWorldDirection(new THREE.Vector3());
  assert.equal(constrainOfficeGuardCamera(camera,target,start,guards),true);
  assert.ok(camera.position.distanceTo(start)<new THREE.Vector3(...to).distanceTo(start));
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)<1e-9);
  assert.ok(target.clone().sub(camera.position).distanceTo(new THREE.Vector3(.5,.2,-1))<1e-9);
 }
});
test('south stair mouth, ground-floor underpass and deliberate flight above the rail remain clear',()=>{
 for(const[from,to]of[
  [[88.6,4.75,17],[88.6,4.75,16.28]],
  [[86.7,1.75,15],[89.7,1.75,15]],
  [[88.6,1.75,17],[88.6,1.75,15.8]],
  [[86.7,9,15],[88,9,15]]]){
  assert.equal(officeGuardSweepFraction(guards,from,to,.08,1.65,.1),1);
 }
});
test('each actual switchback flight and northern landing clears guard bands for a full standing body',()=>{
 const path=[...Array.from({length:8},(_,i)=>[87.6,.1+(i+1)*.2,16.34-(i+.5)*.28]),
  [87.6,1.7,13.8],[88.6,1.7,13.8],...Array.from({length:7},(_,i)=>[88.6,1.7+(i+1)*.2,14.1+(i+.5)*.28]),[88.6,3.1,16.28],[88.6,3.1,16.8]];
 for(const offset of[0,3])for(let i=1;i<path.length;i++){
  const from=path[i-1].map((v,j)=>j===1?v+offset:v),to=path[i].map((v,j)=>j===1?v+offset:v);
  assert.equal(officeGuardSweepFraction(guards,from,to,.28,0,1.75),1,`flight${offset/3} segment${i}`);
 }
});

test('actual rail instances stay within the collision bands; stringers leave the high-flight underpass clear',()=>{
 const owner=createOfficeStairGuardAssembly(guards),mesh=owner.group.children[0] as THREE.InstancedMesh;
 try{
  const matrix=new THREE.Matrix4();
  for(let i=0;i<owner.parts.length;i++){
   const part=owner.parts[i],guard=guards.find(g=>part.name.startsWith(g.id+':'));
   if(!guard)continue;
   mesh.getMatrixAt(i,matrix);const box=new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(matrix);
   for(let axis=0;axis<3;axis++){
    assert.ok(box.min.getComponent(axis)>=guard.min[axis]-1e-5,part.name);
    assert.ok(box.max.getComponent(axis)<=guard.max[axis]+1e-5,part.name);
   }
  }
  // Raycast the actual instanced support draw over a full standing-body footprint beneath the high return flight.
  owner.group.updateMatrixWorld(true);
  for(let ix=0;ix<=10;ix++)for(let iz=0;iz<=10;iz++){
   const ray=new THREE.Raycaster(new THREE.Vector3(88.32+ix*.056,1.85,15.52+iz*.056),new THREE.Vector3(0,-1,0),0,1.75);
   assert.equal(ray.intersectObject(mesh).length,0,`underpass grid${ix},${iz}`);
  }
  const hangers=owner.parts.filter(p=>p.name.startsWith('rim-hanger:'));
  assert.equal(hangers.length,4);assert.ok(hangers.every(p=>p.p[1]-p.size[1]/2>1.5),'landing hangers stop above ground routes');
 }finally{owner.dispose();owner.dispose();}
 assert.equal(owner.group.children.length,0);
});
