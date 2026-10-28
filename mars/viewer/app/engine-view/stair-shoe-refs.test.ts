import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {stairShoeRefs} from './stair-shoe-refs.ts';
import type {Rig} from './people.ts';
function fixture(){
 const root=new THREE.Bone();root.name='Root';const body=new THREE.Bone();body.name='Body';root.add(body);
 const legs=[1,-1].map(side=>{const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();body.add(upper);upper.add(lower);root.add(foot);return {upper,lower,foot,side};});
 const bones=legs.flatMap(l=>[l.upper,l.lower,l.foot]),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(12),3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([1,0,0,0,2,0,0,0,4,0,0,0,5,0,0,0],4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],4));
 const shoes=new THREE.SkinnedMesh(geometry);shoes.name='shoes';shoes.bind(new THREE.Skeleton(bones));const scene=new THREE.Group();scene.userData.humanoid={};scene.add(root,shoes);
 const rig={template:{gltf:{scene}},model:scene} as unknown as Rig;return {rig,legs,shoes};
}
test('stair contacts include shin-weighted shoe vertices and separate Root-child feet',()=>{
 const {rig,legs}=fixture(),result=stairShoeRefs(rig,legs)!;assert.equal(result.complete,true);assert.equal(result.vertices,4);assert.deepEqual(result.refs.get(1)![0].idx,[0,1]);assert.deepEqual(result.refs.get(-1)![0].idx,[2,3]);
});
test('ambiguous weights, malformed chains and nonfinite values do not claim complete coverage',()=>{
 for(const corrupt of [
  (f:ReturnType<typeof fixture>)=>f.legs[0].lower.removeFromParent(),
  (f:ReturnType<typeof fixture>)=>{f.legs[1].side=1;},
  (f:ReturnType<typeof fixture>)=>{f.shoes.geometry.attributes.skinWeight.setX(0,NaN);},
  (f:ReturnType<typeof fixture>)=>{f.shoes.geometry.attributes.skinWeight.setX(0,-1);},
  (f:ReturnType<typeof fixture>)=>{f.shoes.geometry.attributes.skinIndex.setX(0,99);},
  (f:ReturnType<typeof fixture>)=>{f.shoes.geometry.attributes.skinWeight.setXY(0,.5,.5);f.shoes.geometry.attributes.skinIndex.setXY(0,1,4);},
 ]){const f=fixture();corrupt(f);const result=stairShoeRefs(f.rig,f.legs)!;assert.equal(result.vertices,4,'raw shoe vertex count remains disclosed');assert.equal(result.complete,false);}
 const f=fixture();delete f.rig.template.gltf.scene.userData.humanoid;assert.equal(stairShoeRefs(f.rig,f.legs),null,'legacy template contacts retain their original source');
});
