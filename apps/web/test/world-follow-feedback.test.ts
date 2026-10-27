import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldFollow} from '../src/WorldFollow.ts';

test('Follow never treats a controls or ground correction as a request to zoom out',()=>{
  const follow=new WorldFollow(),target=new THREE.Vector3(0,1,0);
  const asked=new THREE.Vector3(0,2,8);
  let offset=follow.resolve(target,asked,[],1/60);
  for(let frame=0;frame<300;frame++){
    // The render pipeline, not the viewer, raises an eye below the drawn terrain.
    const corrected=offset.clone();corrected.y+=.025;
    offset=follow.resolve(target,corrected,[],1/60);
  }
  assert.ok(Math.abs(offset.length()-asked.length())<.01,`unrequested zoom grew from ${asked.length()} to ${offset.length()}`);
  assert.equal(follow.userActive,false,'programmatic corrections never refresh the gesture hold');
});

test('walking beside a wall has bounded frame motion and restores the original zoom after corrections',()=>{
  const wall=new THREE.Mesh(new THREE.BoxGeometry(40,5,.3),new THREE.MeshBasicMaterial());wall.position.set(0,2.5,3.5);
  const follow=new WorldFollow(),asked=new THREE.Vector3(0,2,8);let offset=asked.clone(),largestStep=0;
  for(let frame=0;frame<600;frame++){
    const corrected=offset.clone();corrected.y+=.025;
    const next=follow.resolve(new THREE.Vector3(-5+frame/60,1,0),corrected,[wall],1/60);
    if(frame)largestStep=Math.max(largestStep,next.distanceTo(offset));offset=next;
  }
  assert.ok(largestStep<.35,`largest frame movement ${largestStep} m; existing glide limit is .35 m at 60 fps`);
  assert.equal(follow.userActive,false);
  for(let frame=0;frame<600;frame++)offset=follow.resolve(new THREE.Vector3(5,1,0),offset,[],1/60);
  assert.ok(Math.abs(offset.length()-asked.length())<.01,`restored ${offset.length()} m, expected ${asked.length()} m`);
});
