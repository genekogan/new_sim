import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldFollow } from '../src/WorldFollow.ts';

// QA2 F11 (stranger walk 2026-10-21, legacy Eden, Nemo Owen indoors): the follow camera stood outside the house and
// saw the Soul through a doorway, so half the frame was the house's wall face. A sightline that only threads an
// opening is not a view: the camera comes in through the opening, inside the room.

/** A 6 x 6 m room of solid 0.2 m walls (boxes) with a 1.1 m doorway in the +z wall; flat roof at 3 m. */
function house(){
  const g=new THREE.Group(),m=new THREE.MeshBasicMaterial();
  const box=(w:number,h:number,d:number,x:number,y:number,z:number)=>{const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);b.position.set(x,y,z);g.add(b);};
  box(.2,3,6,-3,1.5,0);box(.2,3,6,3,1.5,0);box(6,3,.2,0,1.5,-3);
  box(2.45,3,.2,-1.775,1.5,3);box(2.45,3,.2,1.775,1.5,3);box(1.1,.8,.2,0,2.6,3);  // front wall: doorway x in [-.55,.55], 2.2 m high
  box(6.2,.2,6.2,0,3.1,0);
  g.updateWorldMatrix(true,true);return g;
}
const inside=(eye:THREE.Vector3)=>Math.abs(eye.x)<2.9&&Math.abs(eye.z)<2.9&&eye.y<3;
const seen=(root:THREE.Object3D,target:THREE.Vector3,offset:THREE.Vector3)=>{const eye=target.clone().add(offset);
  return new THREE.Raycaster(eye,offset.clone().negate().normalize(),0,offset.length()-.05).intersectObject(root,true).length===0;};

test('Follow a Soul just inside a doorway: the camera comes in through the door instead of framing the wall outside', () => {
  const root=house();
  for(const at of [new THREE.Vector3(0,1,1.6),new THREE.Vector3(.3,1,1.2)]){
    const follow=new WorldFollow();let offset=new THREE.Vector3(0,1.4,6);  // outside, looking in through the door
    assert.ok(seen(root,at,offset),'the starting view threads the doorway (the sightline alone is clear)');
    for(let i=0;i<180;i++){offset=follow.resolve(at,offset,[root],1/60);
      if(i<60)continue;  // the move in
      const eye=at.clone().add(offset);
      assert.ok(inside(eye),`Soul at ${at.toArray()}, frame ${i}: camera ${eye.toArray().map(v=>v.toFixed(2))} inside the room`);
      assert.ok(seen(root,at,offset),`frame ${i}: the Soul is in sight`);
      assert.ok(offset.length()>=.99,`frame ${i}: not in the body`);}
  }
});

test('Settled inside, the pulled-in camera holds still (no in-out jitter)', () => {
  const root=house(),at=new THREE.Vector3(0,1,1.6),follow=new WorldFollow();let offset=new THREE.Vector3(0,1.4,6);
  for(let i=0;i<120;i++)offset=follow.resolve(at,offset,[root],1/60);
  let prev=offset.clone(),most=0;
  for(let i=0;i<120;i++){offset=follow.resolve(at,offset,[root],1/60);most=Math.max(most,offset.distanceTo(prev));prev=offset.clone();}
  assert.ok(most<.01,`largest frame-to-frame move after settling ${most.toFixed(4)} m`);
});

test('A Soul outdoors beside a long wall (camera along it) and in a corridor keeps its requested distance', () => {
  const m=new THREE.MeshBasicMaterial(),wall=new THREE.Group();
  const side=new THREE.Mesh(new THREE.BoxGeometry(.2,3,30),m);side.position.set(1.2,1.5,0);wall.add(side);wall.updateWorldMatrix(true,true);
  const corridor=new THREE.Group();for(const x of [-1.2,1.2]){const b=new THREE.Mesh(new THREE.BoxGeometry(.2,3,30),m);b.position.set(x,1.5,0);corridor.add(b);}
  const roof=new THREE.Mesh(new THREE.BoxGeometry(2.6,.2,30),m);roof.position.set(0,3.1,0);corridor.add(roof);corridor.updateWorldMatrix(true,true);
  for(const [name,root] of [['wall',wall],['corridor',corridor]] as const){
    const follow=new WorldFollow(),at=new THREE.Vector3(0,1,0);let offset=new THREE.Vector3(0,1,5);
    for(let i=0;i<120;i++)offset=follow.resolve(at,offset,[root],1/60);
    assert.ok(offset.length()>4.5,`${name}: camera ${offset.length().toFixed(2)} m out (asked 5.1)`);
  }
});
