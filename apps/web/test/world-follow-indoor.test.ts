import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldFollow } from '../src/WorldFollow.ts';

// Single-sided round shell (outward faces only), like a tower or drum, no doorway.
function tower(radius=3){
  const group=new THREE.Group(),shell=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,4,48,1,true),new THREE.MeshBasicMaterial());
  shell.position.y=2;group.add(shell);group.updateWorldMatrix(true,true);return group;
}

test('Follow inside a single-sided shell keeps the camera inside its drawn wall', () => {
  const root=tower(),follow=new WorldFollow(),target=new THREE.Vector3(0,1,0);
  let offset=new THREE.Vector3(6,3,4);
  for(let i=0;i<120;i++){offset=follow.resolve(target,offset,[root],1/60);
    const eye=target.clone().add(offset);
    assert.ok(Math.hypot(eye.x,eye.z)<3,`frame ${i}: camera ${eye.toArray()} stays inside the shell`);
    assert.ok(offset.length()>=.6);}
});

test('Follow outside a shell (Soul outside) is unchanged by the drawn-shell check', () => {
  const root=tower(),a=new WorldFollow(),target=new THREE.Vector3(8,1,0);
  // Camera on the far side of nothing: offset points away from the tower.
  const offset=a.resolve(target,new THREE.Vector3(5,3,0),[root],1/60);
  assert.ok(Math.abs(offset.length()-Math.hypot(5,3))<1e-9);
});
