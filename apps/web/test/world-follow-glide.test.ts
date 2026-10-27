import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldFollow } from '../src/WorldFollow.ts';

// VF4: a Soul walks along a street lined with houses that pass between it and the camera.
function street(){
  const g=new THREE.Group(),m=new THREE.MeshBasicMaterial();
  for(let x=-20;x<=40;x+=7){const house=new THREE.Mesh(new THREE.BoxGeometry(5,4,4),m);house.position.set(x,2,4.5);g.add(house);}
  g.updateWorldMatrix(true,true);return g;
}
const sightClear=(root:THREE.Object3D,target:THREE.Vector3,offset:THREE.Vector3)=>{const r=new THREE.Raycaster(target.clone().add(new THREE.Vector3(0,.3,0)),offset.clone().normalize(),.05,offset.length());return r.intersectObject(root,true).length===0;};

test('Follow glides around houses: no jumps, rises/orbits to a clear view, keeps the Soul in sight', () => {
  const root=street(),follow=new WorldFollow();let offset=new THREE.Vector3(0,3,9);const steps:number[]=[];let clear=0;
  for(let i=0;i<600;i++){
    const target=new THREE.Vector3(-15+i/60*1.4,1,0); // 1.4 m/s
    const next=follow.resolve(target,offset,[root],1/60);
    if(i>0)steps.push(next.distanceTo(offset));
    offset=next;if(sightClear(root,target,offset))clear++;
  }
  const worst=Math.max(...steps);
  assert.ok(worst<.35,`largest frame-to-frame camera move ${worst.toFixed(3)} m (no snapping)`);
  assert.ok(clear/600>.85,`Soul in clear sight on ${(clear/6).toFixed(0)}% of frames`);
});

test('Follow keeps one solution while it stays clear (no flipping)', () => {
  const root=street(),follow=new WorldFollow();let offset=new THREE.Vector3(0,3,9);const thetas:number[]=[];
  const target=new THREE.Vector3(3.5,1,0); // standing behind a house
  for(let i=0;i<240;i++){offset=follow.resolve(target,offset,[root],1/60);thetas.push(Math.atan2(offset.x,offset.z));}
  const late=thetas.slice(120);let flips=0;for(let i=2;i<late.length;i++)if(Math.sign(late[i]-late[i-1])!==Math.sign(late[i-1]-late[i-2])&&Math.abs(late[i]-late[i-1])>1e-3)flips++;
  assert.ok(flips<=1,`direction reversals after settling: ${flips}`);
  assert.ok(sightClear(root,target,offset),'settled on a clear view');
});

test('A Soul in a narrow alley: the camera rises over it and never comes into the body', () => {
  const g=new THREE.Group(),m=new THREE.MeshBasicMaterial();
  for(const z of [-1.4,1.4]){const wall=new THREE.Mesh(new THREE.BoxGeometry(40,5,.4),m);wall.position.set(0,2.5,z);g.add(wall);}
  g.updateWorldMatrix(true,true);
  const follow=new WorldFollow(),target=new THREE.Vector3(0,1,0);let offset=new THREE.Vector3(0,2,8);let minR=Infinity;
  for(let i=0;i<300;i++){offset=follow.resolve(target,offset,[g],1/60);if(i>30)minR=Math.min(minR,offset.length());}
  assert.ok(minR>=2.3,`closest camera distance ${minR.toFixed(2)} m`);
  assert.ok(sightClear(g,target,offset),'ends with a clear view (from above the alley)');
});

test('VF6: a drag/zoom in Follow is the view: kept as drawn, not glided back, no drift behind the walk', () => {
  const follow=new WorldFollow(),root=new THREE.Group();let offset=new THREE.Vector3(0,3,9);
  for(let i=0;i<60;i++){const target=new THREE.Vector3(i/60*1.4,1,0);offset=follow.resolve(target,offset,[root],1/60);}
  // The viewer orbits 70° and zooms out by 1.5×, in small per-frame steps (OrbitControls output).
  for(let i=0;i<20;i++){
    const target=new THREE.Vector3((60+i)/60*1.4,1,0),dragged=offset.clone().applyAxisAngle(new THREE.Vector3(0,1,0),70/20*Math.PI/180).multiplyScalar(Math.pow(1.5,1/20));
    follow.userInput(offset,dragged);
    const next=follow.resolve(target,dragged,[root],1/60);
    assert.ok(next.distanceTo(dragged)<1e-6,`frame ${i}: drawn as dragged (${next.distanceTo(dragged).toFixed(4)} m off)`);
    offset=next;
  }
  const held=offset.clone();
  for(let i=0;i<300;i++){const target=new THREE.Vector3((80+i)/60*1.4,1,0);offset=follow.resolve(target,offset,[root],1/60);}
  assert.ok(offset.angleTo(held)<.02,`kept the viewer's angle after release (moved ${(offset.angleTo(held)*180/Math.PI).toFixed(2)}°)`);
  assert.ok(Math.abs(offset.length()-held.length())<.05,'kept the viewer\'s distance');
});

test('VF6: a wall behind the camera while dragging pulls it in, and the asked-for distance comes back', () => {
  const g=new THREE.Group(),wall=new THREE.Mesh(new THREE.BoxGeometry(20,8,.4),new THREE.MeshBasicMaterial());wall.position.set(0,4,-5);g.add(wall);g.updateWorldMatrix(true,true);
  const follow=new WorldFollow(),target=new THREE.Vector3(0,1,0);let offset=new THREE.Vector3(0,2,8);
  for(let i=0;i<30;i++)offset=follow.resolve(target,offset,[g],1/60);
  // Orbit 180° in 30 frames: the camera passes behind the wall.
  let minR=Infinity;for(let i=0;i<30;i++){const dragged=offset.clone().applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/30);follow.userInput(offset,dragged);offset=follow.resolve(target,dragged,[g],1/60);minR=Math.min(minR,offset.length());}
  assert.ok(offset.z<0&&offset.length()<5.2,`behind the wall the camera is in front of it (r=${offset.length().toFixed(2)})`);
  assert.ok(minR>=2.39,'never into the body');
  for(let i=0;i<30;i++){const dragged=offset.clone().applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/30);follow.userInput(offset,dragged);offset=follow.resolve(target,dragged,[g],1/60);}
  assert.ok(offset.length()>7.5,`back out of the wall the asked-for distance returns (r=${offset.length().toFixed(2)})`);
});

test('Follow ignores speech-bubble sprites: no raycast errors and they never pull the camera in', () => {
  const root=street(),bubble=new THREE.Sprite(new THREE.SpriteMaterial());bubble.position.set(0,2,3);root.add(bubble);root.updateWorldMatrix(true,true);
  const errors:unknown[][]=[],orig=console.error;console.error=(...a:unknown[])=>{errors.push(a);};
  try{const follow=new WorldFollow();let offset=new THREE.Vector3(0,3,9);for(let i=0;i<30;i++)offset=follow.resolve(new THREE.Vector3(0,1,0),offset,[root],1/60);}finally{console.error=orig;}
  assert.deepEqual(errors,[]);
});
