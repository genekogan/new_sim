import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldFollow } from '../src/WorldFollow.ts';

// Single-sided round shell (outward faces only), like a tower or drum, no doorway.
function tower(radius=3){
  const group=new THREE.Group(),shell=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,4,48,1,true),new THREE.MeshBasicMaterial());
  shell.position.y=2;group.add(shell);group.updateWorldMatrix(true,true);return group;
}

// What the camera draws: front faces only (the default FrontSide raycast), from the eye toward the Soul's torso.
const seen=(root:THREE.Object3D,target:THREE.Vector3,offset:THREE.Vector3)=>{const eye=target.clone().add(offset);
  return new THREE.Raycaster(eye,offset.clone().negate().normalize(),0,offset.length()-.05).intersectObject(root,true).length===0;};

test('Follow inside a single-sided shell never puts the camera behind its drawn wall', () => {
  const root=tower(),follow=new WorldFollow(),target=new THREE.Vector3(0,1,0);
  let offset=new THREE.Vector3(6,3,4);
  for(let i=0;i<120;i++){offset=follow.resolve(target,offset,[root],1/60);
    const eye=target.clone().add(offset);
    assert.ok(Math.hypot(eye.x,eye.z)<3||eye.y>4,`frame ${i}: camera ${eye.toArray()} is inside the shell or above its open top`);
    assert.ok(seen(root,target,offset),`frame ${i}: no drawn wall between camera and Soul`);
    assert.ok(offset.length()>=.6);}
});

// A narrow hotel room (3.2 m wide, 5 m deep, 3 m high) drawn like the old Eden hotel core: every wall and the
// ceiling is one-sided, its drawn face looking OUT of the room, so rays from the body pass straight through.
function narrowRoom(){
  const g=new THREE.Group(),m=new THREE.MeshBasicMaterial();
  const face=(w:number,h:number,pos:THREE.Vector3,normal:THREE.Vector3)=>{const p=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);
    p.position.copy(pos);p.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);g.add(p);};
  face(5,3,new THREE.Vector3(-1.6,1.5,0),new THREE.Vector3(-1,0,0));face(5,3,new THREE.Vector3(1.6,1.5,0),new THREE.Vector3(1,0,0));
  face(3.2,3,new THREE.Vector3(0,1.5,-2.5),new THREE.Vector3(0,0,-1));face(3.2,3,new THREE.Vector3(0,1.5,2.5),new THREE.Vector3(0,0,1));
  face(3.2,5,new THREE.Vector3(0,3,0),new THREE.Vector3(0,1,0));  // the floor of the room above, seen from over it
  g.updateWorldMatrix(true,true);return g;
}
const inRoom=(eye:THREE.Vector3)=>Math.abs(eye.x)<1.6&&Math.abs(eye.z)<2.5&&eye.y<3;

test('Follow in a narrow room with one-sided walls: the camera comes inside (any wall, even under 1.5 m away) and sees the Soul', () => {
  const root=narrowRoom();
  // At a desk against the side wall, standing mid-room, and in a corner by the door.
  for(const at of [new THREE.Vector3(1.1,1,-.5),new THREE.Vector3(0,1,0),new THREE.Vector3(-1.1,1,1.9)]){
    const follow=new WorldFollow();let offset=new THREE.Vector3(5,3,7);
    for(let i=0;i<240;i++){offset=follow.resolve(at,offset,[root],1/60);
      if(i<90)continue;  // the glide in from outside
      const eye=at.clone().add(offset);
      assert.ok(inRoom(eye),`Soul at ${at.toArray()}, frame ${i}: camera ${eye.toArray().map(v=>v.toFixed(2))} inside the room`);
      assert.ok(seen(root,at,offset),`Soul at ${at.toArray()}, frame ${i}: no drawn wall between camera and Soul`);
      assert.ok(offset.length()>=.99,`Soul at ${at.toArray()}, frame ${i}: camera ${offset.length().toFixed(2)} m out (not in the body)`);}
  }
});

test('Dragging the camera out through a one-sided room wall pulls it back inside', () => {
  const root=narrowRoom(),follow=new WorldFollow(),target=new THREE.Vector3(1.1,1,-.5);
  let offset=follow.resolve(target,new THREE.Vector3(5,3,7),[root],1/60);
  for(let i=0;i<120;i++)offset=follow.resolve(target,offset,[root],1/60);
  // The viewer orbits toward the back wall (2 m away, nearer than the 2.4 m zoom floor) and zooms out.
  offset=follow.resolve(target,new THREE.Vector3(0,.6,-6),[root],1/60);
  assert.ok(follow.userActive);
  assert.ok(inRoom(target.clone().add(offset))&&seen(root,target,offset),`camera ${target.clone().add(offset).toArray()} kept inside`);
  // After the hand leaves the camera, the search keeps it inside too.
  for(let i=0;i<120;i++){offset=follow.resolve(target,offset,[root],1/60);
    assert.ok(seen(root,target,offset),`frame ${i}: camera ${target.clone().add(offset).toArray()} sees the Soul`);}
});

test('Follow outside a shell (Soul outside) is unchanged by the drawn-shell check', () => {
  const root=tower(),a=new WorldFollow(),target=new THREE.Vector3(8,1,0);
  // Camera on the far side of nothing: offset points away from the tower.
  const offset=a.resolve(target,new THREE.Vector3(5,3,0),[root],1/60);
  assert.ok(Math.abs(offset.length()-Math.hypot(5,3))<1e-9);
});
