import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldFollow } from '../src/WorldFollow.ts';
import { createEdenRegions } from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/index.ts';
import { SEAFRONT_HOTELS, HOTEL_Z, hotelCoreLayout, hotelFlight, hotelFloorYs } from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/hotel-core.ts';

// The real drawing of old Eden's seafront hotels (narrow rooms with one-sided walls, far out in the resort district).
// Seen in Chrome: following a Soul at hotel 2's Room 101 desk showed the hotel's flat outside wall, the Soul hidden.
const regions=createEdenRegions(()=>0)!;
const opaque:THREE.Mesh[]=[];
regions.group.updateWorldMatrix(true,true);
regions.group.traverse(o=>{let clear=false;for(let p:THREE.Object3D|null=o;p;p=p.parent)if(p.userData.cameraTransparent===true)clear=true;if((o as THREE.Mesh).isMesh&&!clear)opaque.push(o as THREE.Mesh);});
// What the camera draws between it and the Soul's torso (front faces only, like the renderer).
const seen=(target:THREE.Vector3,offset:THREE.Vector3)=>new THREE.Raycaster(target.clone().add(offset),offset.clone().negate().normalize(),0,offset.length()-.05).intersectObjects(opaque,false).length===0;

test('the seafront hotels stop the camera: their walls are in camera rays though the resort is a distant district', () => {
  const h=SEAFRONT_HOTELS[1],west=h.cx-h.w/2;
  const hit=new THREE.Raycaster(new THREE.Vector3(west-2,4.5,119),new THREE.Vector3(1,0,0),0,2.5).intersectObjects(opaque,false);
  assert.ok(hit.length>0,'hotel 2 west wall seen from outside blocks the camera');
});

test('Follow at hotel 2 Room 101 desk, on hotel 1 stair and in its lobby: the camera comes inside and sees the Soul', () => {
  const h2=SEAFRONT_HOTELS[1],c2=hotelCoreLayout(h2.w),bx=h2.cx+c2.guestColumns[0];
  const h1=SEAFRONT_HOTELS[0],c1=hotelCoreLayout(h1.w);
  const cases=[
    // seated at the desk (pivot as recorded in Chrome), camera where Follow left it then: outside the west wall
    {name:'Room 101 desk',target:new THREE.Vector3(bx+1.05,4.12,HOTEL_Z-2),offset:new THREE.Vector3(-4.99,1.5,-.31),x:[bx-1.65,bx+1.65]},
    // up hotel 1's first flight: a tread in lane L, the turn landing, a tread in lane U (body pivot 1 m over the tread),
    // camera out over the sea front
    ...[3,8,12].map(i=>{const [x,y,z]=hotelFlight(c1,0,hotelFloorYs(h1.floors)[0])[i];
      return {name:`hotel 1 stair point ${i}`,target:new THREE.Vector3(h1.cx+x,y+1,HOTEL_Z+z),offset:new THREE.Vector3(2,3,7),x:[h1.cx+c1.inner[0],h1.cx+c1.inner[2]]};}),
    // standing in hotel 1's lobby by the reception
    {name:'hotel 1 lobby',target:new THREE.Vector3(h1.cx,1,HOTEL_Z-3),offset:new THREE.Vector3(0,3,9),x:[h1.cx+c1.inner[0],h1.cx+c1.inner[2]]},
  ];
  for(const k of cases){
    const follow=new WorldFollow();let offset=k.offset.clone();
    for(let i=0;i<180;i++)offset=follow.resolve(k.target,offset,[regions.group],1/60);
    const eye=k.target.clone().add(offset);
    assert.ok(seen(k.target,offset),`${k.name}: no drawn wall between camera ${eye.toArray().map(v=>v.toFixed(2))} and Soul`);
    assert.ok(eye.x>k.x[0]&&eye.x<k.x[1]&&eye.z>HOTEL_Z-5&&eye.z<HOTEL_Z+5,`${k.name}: camera ${eye.toArray().map(v=>v.toFixed(2))} inside`);
  }
});
