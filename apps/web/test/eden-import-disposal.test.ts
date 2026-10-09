import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createEdenAnimals} from '../../../mars/viewer/app/engine-view/content/assets/eden-imports/animals.ts';
import {createEdenGroundCover} from '../../../mars/viewer/app/engine-view/content/assets/eden-imports/groundcover.ts';

test('animal clones release their actual bone textures exactly once while shared pack resources survive recreation',async()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(12),4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  const material=new THREE.MeshStandardMaterial(),bone=new THREE.Bone(),model=new THREE.SkinnedMesh(geometry,material);
  model.name='cow';model.add(bone);model.bind(new THREE.Skeleton([bone]));model.skeleton.computeBoneTexture();
  const scene=new THREE.Group();scene.add(model);
  const fixture={scene,animations:[]} as unknown as GLTF;
  let sharedGeometry=0,sharedMaterial=0,sourceBoneTexture=0;
  geometry.addEventListener('dispose',()=>sharedGeometry++);material.addEventListener('dispose',()=>sharedMaterial++);
  model.skeleton.boneTexture!.addEventListener('dispose',()=>sourceBoneTexture++);
  const originals=new Set<THREE.Skeleton>([model.skeleton]);
  for(let generation=0;generation<2;generation++){
    const owner=createEdenAnimals(()=>0,async()=>fixture);await Promise.resolve();
    const skeletons=new Set<THREE.Skeleton>();owner.group.traverse(o=>{if(o instanceof THREE.SkinnedMesh){assert.equal(o.geometry,geometry);assert.equal(o.material,material);assert.ok(!originals.has(o.skeleton),'each clone/recreation owns a new skeleton');skeletons.add(o.skeleton);}});
    assert.ok(skeletons.size>0,'actual production loader constructed cloned animals');
    const disposed=new Map<THREE.Skeleton,number>();
    for(const skeleton of skeletons){originals.add(skeleton);skeleton.computeBoneTexture();disposed.set(skeleton,0);skeleton.boneTexture!.addEventListener('dispose',()=>disposed.set(skeleton,disposed.get(skeleton)!+1));}
    owner.dispose();owner.dispose();
    for(const skeleton of skeletons){assert.equal(disposed.get(skeleton),1,'owned bone texture disposed once');assert.equal(skeleton.boneTexture,null);}
    assert.equal(owner.group.children.length,0);
    assert.equal(sharedGeometry,0);assert.equal(sharedMaterial,0);assert.equal(sourceBoneTexture,0,'borrowed GLTF skeleton stays alive');
  }
  model.skeleton.dispose();geometry.dispose();material.dispose();
});

test('ground-cover frame hook releases its distinct material once on disposal and recreation',async t=>{
  // No network/pack decode is needed to test the synchronous production hook owner.
  t.mock.method(globalThis,'fetch',async()=>{throw Error('fixture deliberately provides no pack');});
  t.mock.method(console,'warn',()=>{});
  for(let generation=0;generation<2;generation++){
    const owner=createEdenGroundCover(()=>0,[],()=>false,'test-disposal-only.glb');
    const hook=owner.group.children.find(o=>o instanceof THREE.Mesh&&o.frustumCulled===false) as THREE.Mesh;
    assert.ok(hook);const material=hook.material as THREE.MeshBasicMaterial;
    assert.ok(material instanceof THREE.MeshBasicMaterial);
    let materialDisposals=0,geometryDisposals=0;
    material.addEventListener('dispose',()=>materialDisposals++);hook.geometry.addEventListener('dispose',()=>geometryDisposals++);
    owner.dispose();owner.dispose();
    assert.equal(materialDisposals,1,'hook-owned material disposed once');assert.equal(geometryDisposals,1);
    await Promise.resolve();await Promise.resolve();
  }
});
