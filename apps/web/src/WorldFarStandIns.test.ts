import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldFarStandIns,PHONE_STAND_INS,type Snapshotter} from './WorldFarStandIns.ts';

const stub:Snapshotter=()=>new THREE.DataTexture(new Uint8Array(4),1,1);
// A row of 100 one-metre bushes (200 triangles each) from 5 m to 500 m along -z.
function world(){
  const scene=new THREE.Scene(),group=new THREE.Group();scene.add(group);
  const bushes=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6,3),new THREE.MeshLambertMaterial(),100);bushes.castShadow=true;
  for(let i=0;i<100;i++){bushes.setMatrixAt(i,new THREE.Matrix4().makeTranslation(0,0.6,-5-i*5));bushes.setColorAt(i,new THREE.Color(i/100,0.5,0.2));}
  group.add(bushes);
  const few=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6,3),new THREE.MeshLambertMaterial(),3);group.add(few);   // too few to bother
  const camera=new THREE.PerspectiveCamera(45,390/844,0.1,2400);camera.position.set(0,1.6,0);camera.lookAt(0,1.6,-1);
  const standIns=new WorldFarStandIns(PHONE_STAND_INS,stub);scene.add(standIns.group);scene.updateMatrixWorld(true);
  return {scene,bushes,few,camera,standIns};
}
const frame=(w:ReturnType<typeof world>,n=1)=>{for(let i=0;i<n;i++){w.standIns.restore();w.standIns.apply(w.scene,w.camera,844);}};

test('far instances become cards, near ones keep their mesh and shadow; render-time only', () => {
  const w=world();frame(w,2);
  const s=w.standIns.stats;
  assert.equal(s.sources,1);                       // the three-instance mesh is left alone
  // 0.6·√3 ≈ 1.04 m radius (box), 7 px of radius on an 844 px phone at 45°: farther than ~150 m becomes a card
  assert.ok(s.cards>60&&s.cards<80,`cards ${s.cards}`);assert.equal(s.cards+s.near,100);
  assert.equal(w.bushes.visible,false);
  const near=w.bushes.parent!.children.find(o=>o.name.endsWith('near')) as THREE.InstancedMesh;
  assert.equal(near.visible,true);assert.equal(near.count,s.near);assert.equal(near.castShadow,true);
  const cards=w.standIns.group.children[0] as THREE.InstancedMesh;assert.equal(cards.count,s.cards);assert.equal(cards.castShadow,false);
  // card colours follow their instances
  const c=new THREE.Color();cards.getColorAt(0,c);assert.ok(c.r>0.2);
  assert.ok(s.trianglesSaved>s.cards*100);
  w.standIns.restore();
  assert.equal(w.bushes.visible,true);assert.equal(near.visible,false);assert.equal(w.standIns.group.visible,false);
});

test('walking forward turns cards back into meshes; moved instances are re-read', () => {
  const w=world();frame(w,2);const before=w.standIns.stats.cards;
  w.camera.position.set(0,1.6,-400);w.scene.updateMatrixWorld(true);frame(w);
  assert.ok(w.standIns.stats.cards<before);
  w.bushes.setMatrixAt(99,new THREE.Matrix4().makeTranslation(0,0.6,-402));w.bushes.instanceMatrix.needsUpdate=true;frame(w);
  const near=w.bushes.parent!.children.find(o=>o.name.endsWith('near')) as THREE.InstancedMesh,m=new THREE.Matrix4(),p=new THREE.Vector3();
  const zs=[...Array(near.count).keys()].map(i=>{near.getMatrixAt(i,m);return p.setFromMatrixPosition(m).z;});
  assert.ok(zs.includes(-402));
});

test('a removed source is dropped with its derived meshes; nothing changes when no instance is far', () => {
  const w=world();w.camera.position.set(0,1.6,-250);w.camera.far=2400;w.scene.updateMatrixWorld(true);
  const standIns=new WorldFarStandIns({...PHONE_STAND_INS,cardRadiusPx:0.01,rescanFrames:1},stub);w.scene.add(standIns.group);
  standIns.apply(w.scene,w.camera,844);assert.equal(standIns.stats.cards,0);assert.equal(w.bushes.visible,true);standIns.restore();
  w.bushes.removeFromParent();standIns.apply(w.scene,w.camera,844);assert.equal(standIns.stats.sources,0);
  assert.equal(standIns.group.children.length,0);standIns.dispose();
});

test('a mesh that cannot be photographed keeps its full detail', () => {
  const w=world(),standIns=new WorldFarStandIns(PHONE_STAND_INS,()=>null);w.scene.add(standIns.group);
  standIns.apply(w.scene,w.camera,844);standIns.restore();standIns.apply(w.scene,w.camera,844);
  assert.equal(standIns.stats.cards,0);assert.equal(w.bushes.visible,true);assert.equal(w.bushes.userData.keepDetail,true);
});
