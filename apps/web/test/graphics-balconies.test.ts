import {AUTHORED_CAMERA_CONTACT_PRECISION} from '../src/WorldAuthoredBoundaries.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {Builder,Materials} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/kit.ts';
import {house,buildBalcony,type BalconyLayout} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/buildings.ts';
import {authoredBoundarySweepFraction} from '../../../mars/viewer/lib/authored-boundaries.ts';
const plan:BalconyLayout[]=[{x:-2,floorY:3.12,width:2.6,depth:1.2,index:'1:0'},{x:1.3,floorY:3.12,width:2.6,depth:1.2,index:'1:1'},{x:-2,floorY:6.22,width:2.6,depth:1.2,index:'2:0'}];
const make=()=>{const b=new Builder('legacy');house(b,{w:10,d:10,floors:3,fh:3.1,wallC:'#fff',roof:'flat',trim:'#ddd',balconyLayout:plan},()=>.5);const root=new THREE.Group(),materials=new Materials(),geos:THREE.BufferGeometry[]=[];b.emit(root,materials,'fixture',geos);root.updateMatrixWorld(true);return{b,root,dispose(){for(const g of geos)g.dispose();materials.dispose();root.clear();}};};
void test('each hotel balcony has an actual 1.2×2.3m opening with no front-wall triangles, including two adjacent doors',()=>{
 const owner=make();try{for(const door of plan){for(const x of[door.x-.45,door.x,door.x+.45])for(const y of[door.floorY+.15,door.floorY+1,door.floorY+2.1]){const ray=new THREE.Raycaster(new THREE.Vector3(x,y,6),new THREE.Vector3(0,0,-1),0,1.25);const hits=ray.intersectObject(owner.root,true).filter(h=>h.object instanceof THREE.Mesh&&((h.object as THREE.Mesh).material as THREE.Material).name.includes('wall'));assert.equal(hits.length,0,'front facade really opens to the interior');}
  const from=[door.x,door.floorY+1.65,5.55],to=[door.x,door.floorY+1.65,4.2];assert.equal(authoredBoundarySweepFraction(owner.b.boundaries,from,to,.28,1.65,.1),1,'same shared walls leave full body entry clear');}
 }finally{owner.dispose();}
});
void test('three actual continuous guard faces stop body/eye sweeps while entry, lower underpass and flight above stay clear',()=>{
 const owner=make();try{assert.equal(owner.b.boundaries.filter(b=>b.kind==='guard').length,9);for(const door of plan){const guards=owner.b.boundaries.filter(b=>b.id.includes('balcony:'+door.index+':'));assert.equal(guards.length,3);
  for(const[from,to]of[[[door.x,door.floorY+1.65,5.6],[door.x,door.floorY+1.65,7]],[[door.x,door.floorY+1.65,5.6],[door.x-2,door.floorY+1.65,5.6]],[[door.x,door.floorY+1.65,5.6],[door.x+2,door.floorY+1.65,5.6]]]){assert.ok(authoredBoundarySweepFraction(guards,from,to,.08,1.65,.1)<1);assert.ok(authoredBoundarySweepFraction(guards,from,to,.28,1.75,0)<1);}
  assert.equal(authoredBoundarySweepFraction(guards,[door.x,1.65,5.6],[door.x,1.65,7],.08,1.65,.1),1);assert.equal(authoredBoundarySweepFraction(guards,[door.x,door.floorY+3,5.6],[door.x,door.floorY+3,7],.08,1.65,.1),1);
  for(const g of guards){assert.ok(Math.abs(g.c[1]-g.half[1]-door.floorY)<1e-8);assert.ok(Math.abs(g.c[1]+g.half[1]-door.floorY-1.05)<1e-8);}
 } }finally{owner.dispose();}
});
void test('real balcony and interior floor top match exactly; generic balcony shares the same solid three-sided helper',()=>{
 const owner=make();try{for(const door of plan){for(const z of[5.5,4.5,0]){const ray=new THREE.Raycaster(new THREE.Vector3(door.x,door.floorY+.1,z),new THREE.Vector3(0,-1,0),0,.2),hit=ray.intersectObject(owner.root,true)[0];assert.ok(hit);assert.ok(Math.abs(hit.point.y-door.floorY)<1e-6);if(z===5.5)assert.equal(authoredBoundarySweepFraction(owner.b.boundaries,[door.x,hit.point.y+1.65,5.5],[door.x,hit.point.y+1.65,4.5],.08,1.65,.1,AUTHORED_CAMERA_CONTACT_PRECISION),1,'actual Float32 rendered floor permits eye capsule through the matching door');}}
  const b=new Builder('legacy');house(b,{w:6,d:7,floors:2,balcony:true,wallC:'#fff',roof:'flat',trim:'#ddd'},()=>.5);assert.equal(b.boundaries.filter(v=>v.kind==='guard').length,3);
 }finally{owner.dispose();}
});
void test('balcony metadata transforms match the actually emitted guard mesh under rotated placement',()=>{
 const b=new Builder('legacy');b.push(140,2,121,Math.PI/3);buildBalcony(b,plan[0],5,'#ddd','rotated');b.pop();assert.equal(b.boundaries.length,3);
 const materials=new Materials(),geos:THREE.BufferGeometry[]=[],root=new THREE.Group();b.emit(root,materials,'rotated',geos);root.updateMatrixWorld(true);
 try{for(const guard of b.boundaries){const start=new THREE.Vector3(guard.c[0],guard.c[1],guard.c[2]);const direction=new THREE.Vector3(Math.cos(guard.yaw),0,Math.sin(guard.yaw));const ray=new THREE.Raycaster(start.addScaledVector(direction,-4),direction,0,8);assert.ok(ray.intersectObject(root,true).length>0,'shared prism is at the actual visible panel');assert.ok(authoredBoundarySweepFraction([guard],start.toArray(),start.clone().addScaledVector(direction,8).toArray(),.08)<1);}}
 finally{for(const g of geos)g.dispose();materials.dispose();root.clear();}
});
void test('plain house remains the same solid draw but is explicitly registered solid; no painted doorway is invented',()=>{
 const b=new Builder('legacy');house(b,{w:8,d:6,floors:2,roof:'flat',wallC:'#fff',trim:'#ddd'},()=>.5);assert.equal(b.boundaries.length,1);const box=b.boundaries[0];assert.equal(box.collision,'solid');assert.equal(box.kind,'wall');assert.deepEqual(box.half,[4,(5.8-.35)/2,3]);assert.ok(authoredBoundarySweepFraction(b.boundaries,[0,1.65,5],[0,1.65,0],.28,1.65,.1)<1);
});
