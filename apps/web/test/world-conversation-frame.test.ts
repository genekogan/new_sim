import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {conversationFrame} from '../src/WorldConversationFrame.ts';import {containingPlace} from '../src/WorldHover.ts';
test('group shot includes every speaker at desktop and phone aspects',()=>{
 const people=[{id:'a',p:[-3,0,0] as [number,number,number],yaw:0},{id:'b',p:[3,0,0] as [number,number,number],yaw:Math.PI},{id:'c',p:[0,0,2] as [number,number,number],yaw:0}];
 for(const aspect of [1280/720,390/844]){const camera=new THREE.PerspectiveCamera(45,aspect,.1,1000),shot=conversationFrame(people,camera,[],()=>0);assert.ok(shot);camera.position.copy(shot.position);camera.lookAt(shot.target);camera.updateMatrixWorld();
  for(const m of people)for(const y of [0,1.75]){const p=new THREE.Vector3(m.p[0],y,m.p[2]).project(camera);assert.ok(Math.abs(p.x)<.9&&Math.abs(p.y)<.9,`${m.id} inside ${aspect}: ${p.toArray()}`);}}
});
test('group shot turns around an opaque wall and respects raised ground',()=>{
 const root=new THREE.Group(),wall=new THREE.Mesh(new THREE.BoxGeometry(2,8,18),new THREE.MeshBasicMaterial());wall.position.set(3,4,0);root.add(wall);const camera=new THREE.PerspectiveCamera(45,1.5,.1,100),shot=conversationFrame([{id:'a',p:[0,0,-1],yaw:0},{id:'b',p:[0,0,1],yaw:0}],camera,[root],()=>2);assert.ok(shot);assert.ok(shot.position.y>=3.5);assert.ok(shot.seen>=.97);assert.ok(shot.position.x<2);
});
test('hover selects smallest containing place and excludes upper floors',()=>{
 const places=[{id:'ground',name:'Ground',polygon:[[-10,-10],[10,-10],[10,10],[-10,10]] as [number,number][]},{id:'room',name:'Room',polygon:[[-2,-2],[2,-2],[2,2],[-2,2]] as [number,number][]},{id:'up',name:'Upper',level:2,polygon:[[-1,-1],[1,-1],[1,1],[-1,1]] as [number,number][]}];assert.equal(containingPlace(new THREE.Vector3(0,0,0),places)?.id,'room');assert.equal(containingPlace(new THREE.Vector3(100,0,0),places),null);
});
