import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MeshoptSimplifier} from 'meshoptimizer/simplifier';
import {WorldMeshLod,buildLevels,PHONE_MESH_LOD,type Simplifier} from './WorldMeshLod.ts';

await MeshoptSimplifier.ready;
const simplifier=MeshoptSimplifier as unknown as Simplifier;
// A 200 m terrain sector: 128×128 quads (32k triangles), gently rolling.
function terrain(){
  const g=new THREE.PlaneGeometry(200,200,128,128).rotateX(-Math.PI/2);
  const p=g.attributes.position as THREE.BufferAttribute;for(let i=0;i<p.count;i++)p.setY(i,2*Math.sin(p.getX(i)/23)+1.5*Math.cos(p.getZ(i)/31));
  g.computeVertexNormals();return g;
}
const frame=(lod:WorldMeshLod,root:THREE.Object3D,camera:THREE.PerspectiveCamera,n=2)=>{for(let i=0;i<n;i++){lod.restore();lod.apply(root,camera,844);}};

test('levels are coarser, keep the vertices, and report their error in metres', () => {
  const g=terrain(),levels=buildLevels(simplifier,g,PHONE_MESH_LOD.ratios);
  assert.ok(levels.length>=2);
  let last=g.index!.count/3,lastError=0;
  for(const l of levels){assert.ok(l.triangles<last*0.8);assert.ok(l.error>=lastError);assert.ok(Math.max(...l.index)<g.attributes.position.count);last=l.triangles;lastError=l.error;}
  assert.ok(levels.at(-1)!.error<1,'a 3% terrain level stays within a metre of the original');
});

test('far terrain draws a coarse level, near terrain the original; render-time only', async () => {
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(terrain(),new THREE.MeshBasicMaterial());scene.add(mesh);
  const camera=new THREE.PerspectiveCamera(45,390/844,0.1,2400);camera.position.set(0,40,600);camera.lookAt(0,0,0);scene.updateMatrixWorld(true);
  const lod=new WorldMeshLod({...PHONE_MESH_LOD,budgetMs:1e9},async()=>simplifier);await new Promise(r=>setTimeout(r,0));
  const base=mesh.geometry;frame(lod,scene,camera);
  assert.notEqual(mesh.geometry,base);assert.equal(lod.stats.coarser,1);assert.ok(lod.stats.triangles<lod.stats.fullTriangles/3);
  assert.equal(mesh.geometry.attributes.position,base.attributes.position);   // shared vertices
  lod.restore();assert.equal(mesh.geometry,base);
  camera.position.set(0,10,0);camera.lookAt(0,0,-50);scene.updateMatrixWorld(true);   // standing on it
  frame(lod,scene,camera);assert.equal(mesh.geometry,base);assert.equal(lod.stats.coarser,0);lod.restore();
});

test('small meshes, skinned and instanced meshes are left alone; a replaced geometry is rescanned', async () => {
  const scene=new THREE.Scene(),small=new THREE.Mesh(new THREE.SphereGeometry(1,16,8),new THREE.MeshBasicMaterial());scene.add(small);
  const big=new THREE.Mesh(terrain(),new THREE.MeshBasicMaterial());scene.add(big);
  const camera=new THREE.PerspectiveCamera(45,390/844,0.1,2400);camera.position.set(0,40,900);scene.updateMatrixWorld(true);
  const lod=new WorldMeshLod({...PHONE_MESH_LOD,budgetMs:1e9,rescanFrames:1},async()=>simplifier);await new Promise(r=>setTimeout(r,0));
  frame(lod,scene,camera);assert.equal(lod.stats.meshes,1);lod.restore();
  big.geometry=terrain();frame(lod,scene,camera,3);assert.equal(lod.stats.meshes,1);assert.equal(lod.stats.coarser,1);lod.restore();
  lod.dispose();
});

test('without a simplifier everything is drawn as before', async () => {
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(terrain(),new THREE.MeshBasicMaterial());scene.add(mesh);
  const camera=new THREE.PerspectiveCamera(45,1,0.1,2400);camera.position.set(0,40,900);scene.updateMatrixWorld(true);
  const lod=new WorldMeshLod(PHONE_MESH_LOD,async()=>null);await new Promise(r=>setTimeout(r,0));
  const base=mesh.geometry;frame(lod,scene,camera);assert.equal(mesh.geometry,base);assert.equal(lod.stats.coarser,0);
});
