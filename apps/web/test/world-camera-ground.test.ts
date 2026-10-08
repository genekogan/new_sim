import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {CameraGroundClamp,CAMERA_GROUND_MARGIN} from '../src/WorldCameraGround.ts';

const plane=(w:number,d:number,y:number,name='ground')=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial());m.position.y=y;m.name=name;return m;};
function world(){
  const scene=new THREE.Scene();
  scene.add(plane(400,400,0));                                   // terrain
  const hill=plane(60,60,8,'hill');hill.position.x=100;scene.add(hill);   // a raised plateau
  const water=plane(80,50,-.4,'lake');water.position.z=-250;(water.material as THREE.Material).depthWrite=false;(water.material as THREE.Material).transparent=true;scene.add(water);
  const lakeBed=plane(80,50,-3,'lake bed');lakeBed.position.z=-250;scene.add(lakeBed);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(10,6,10),new THREE.MeshBasicMaterial());roof.position.set(-50,3,0);scene.add(roof);   // a house: never "ground"
  const balloons=plane(300,300,60,'atmosphere: drifting hot-air balloons');scene.add(balloons);
  scene.updateMatrixWorld(true);return scene;
}
const cam=(x:number,y:number,z:number)=>{const c=new THREE.PerspectiveCamera();c.position.set(x,y,z);c.lookAt(x,y-1,z+1);c.updateMatrixWorld();return c;};

test('the camera is lifted above terrain, a raised hill and water, never pushed down, and houses/sky do not count', () => {
  const scene=world(),g=new CameraGroundClamp();
  let c=cam(0,-5,0);assert.ok(g.apply(c,scene,0)>0);assert.ok(Math.abs(c.position.y-CAMERA_GROUND_MARGIN)<1e-6,'below the ground: lifted to the margin');
  c=cam(100,3,0);g.apply(c,scene,0);assert.ok(Math.abs(c.position.y-(8+CAMERA_GROUND_MARGIN))<1e-6,'inside the hill: lifted above it');
  c=cam(0,-1.5,-250);g.apply(c,scene,0);assert.ok(Math.abs(c.position.y-(-.4+CAMERA_GROUND_MARGIN))<1e-6,'under water: above the surface, not the bed');
  c=cam(-50,1.6,0);assert.equal(g.apply(c,scene,0),0,'inside a house: left alone (roofs are not ground)');
  c=cam(0,30,0);assert.equal(g.apply(c,scene,0),0,'high above: untouched');assert.equal(c.position.y,30);
  assert.equal(g.last.surfaces,4,'terrain, hill, water, lake bed (not the house or the balloons)');
});
test('heights are cached per cell, so a still camera costs no rays', () => {
  const scene=world(),g=new CameraGroundClamp();
  const spy=new THREE.Raycaster();let calls=0;const orig=THREE.Raycaster.prototype.intersectObjects;
  THREE.Raycaster.prototype.intersectObjects=function(...a){calls++;return orig.apply(this,a as Parameters<typeof orig>);};
  try{const c=cam(5,-2,5);g.apply(c,scene,0);const first=calls;for(let i=1;i<50;i++)g.apply(c,scene,i*16);assert.equal(calls,first,'no new rays within the cache window');}
  finally{THREE.Raycaster.prototype.intersectObjects=orig;void spy;}
});
