import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {CameraGroundClamp,CAMERA_GROUND_MARGIN,cameraGroundSampler} from '../src/WorldCameraGround.ts';
import type {SceneInfo} from '../src/WorldGeometry.ts';
import {groundTriangleSampler} from '../../../mars/viewer/lib/ground-triangles.ts';
import {Builder,Materials} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/kit.ts';

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
  THREE.Raycaster.prototype.intersectObjects=function(this:THREE.Raycaster,...a:Parameters<typeof orig>){calls++;return orig.apply(this,a);} as typeof orig;
  try{const c=cam(5,-2,5);g.apply(c,scene,0);const first=calls;for(let i=1;i<50;i++)g.apply(c,scene,i*16);assert.equal(calls,first,'no new rays within the cache window');}
  finally{THREE.Raycaster.prototype.intersectObjects=orig;void spy;}
});

const published=(y:number,water?:{wetBoundsXZ:number[];datumY:number})=>({scene:{surfaces:[{id:'ground',level:0,y,obb:{c:[0,0],half:[100,100],yaw:0}},{id:'upper-floor',level:1,y:20,obb:{c:[0,0],half:[100,100],yaw:0}}]},...(water?{shore:{metadata:{water}}}:{})}) as unknown as Pick<SceneInfo,'scene'|'shore'>;

test('qualified land excludes the actual wide merged Builder roof that fools legacy rays',()=>{
  const scene=new THREE.Scene(),builder=new Builder('legacy'),materials=new Materials(),geos:THREE.BufferGeometry[]=[],roofs=new THREE.Group();
  const ground=plane(160,160,0);scene.add(ground);
  for(const x of[0,80])builder.gable('roof',x,6,0,12,8,2,new THREE.Color(0x885544),null,new THREE.Color());
  builder.emit(roofs,materials,'Actual Builder roof soup',geos);scene.add(roofs);scene.updateMatrixWorld(true);
  try{
    const legacy=new CameraGroundClamp();assert.equal(legacy.heightAt(scene,0,0,0),8,'retained original classifier witness');
    const source=published(0),g=new CameraGroundClamp();g.bindGround(cameraGroundSampler(source),source);
    const c=cam(0,1.65,0);assert.equal(g.apply(c,scene,0),0);assert.equal(c.position.y,1.65,'real merged roof cannot lift a supplied land-only camera');
    assert.equal(g.heightAt(scene,0,0,0),0,'upper-floor publication does not become ground');
  }finally{for(const geo of geos)geo.dispose();materials.dispose();ground.geometry.dispose();(ground.material as THREE.Material).dispose();}
});

test('actual drawn Float32 hill triangles lift the camera even when sightline-transparent',()=>{
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,3,0,10,7,0,10,9,10,0,3,0,10,9,10,0,5,10],3));
  const hill=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));hill.userData.cameraTransparent=true;
  const scene=new THREE.Scene();scene.add(hill);scene.updateMatrixWorld(true);const actual=groundTriangleSampler(hill),g=new CameraGroundClamp();
  g.bindGround(cameraGroundSampler(undefined,(x,z)=>actual.heightAt(x,z)),hill);
  const c=cam(5,2,5);c.lookAt(5,-100,5);c.updateMatrixWorld();g.apply(c,scene,0);
  assert.equal(actual.heightAt(5,5),6);assert.ok(Math.abs(c.position.y-(6+CAMERA_GROUND_MARGIN))<1e-10);
  geometry.dispose();(hill.material as THREE.Material).dispose();
});

test('selected pond datum protects submerged bed only inside wet bounds with actual support',()=>{
  const source=published(-3,{wetBoundsXZ:[-10,-10,10,10],datumY:-.4}),provider=cameraGroundSampler(source)!;
  assert.equal(provider(0,0),-.4);assert.equal(provider(11,0),-3,'outside wet bounds remains land');
  assert.equal(cameraGroundSampler(source,()=>1)!(0,0),1,'dry land above water is not lowered');
  assert.equal(cameraGroundSampler(source,()=>null)!(0,0),null,'water does not invent a missing ground publication');
  const g=new CameraGroundClamp();g.bindGround(provider,source);const c=cam(0,-2,0);g.apply(c,new THREE.Scene(),0);
  assert.ok(Math.abs(c.position.y-(-.4+CAMERA_GROUND_MARGIN))<1e-10);
  assert.equal(cameraGroundSampler(undefined),undefined,'unqualified worlds explicitly retain legacy fallback');
});

test('qualified null support and publication/scene refresh never reuse old heights',()=>{
  const scene=world(),g=new CameraGroundClamp();assert.equal(g.heightAt(scene,100,0,0),8);
  const a=published(0);g.bindGround(cameraGroundSampler(a),a);assert.equal(g.heightAt(scene,100,0,10),0);
  const b=published(5);g.bindGround(cameraGroundSampler(b),b);assert.equal(g.heightAt(scene,100,0,20),5,'new immutable publication is immediate');
  g.bindGround(()=>null,b);assert.equal(g.heightAt(scene,100,0,30),null);assert.equal(g.apply(cam(100,-10,0),scene,30),0,'qualified missing support never falls back to a roof or invented Y0');
  g.bindGround(undefined);const replacement=new THREE.Scene();replacement.add(plane(400,400,2));replacement.updateMatrixWorld(true);
  assert.equal(g.heightAt(replacement,100,0,40),2,'provider release clears legacy scene cache too');
});
