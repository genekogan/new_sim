import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {anyPersonInView} from './people-in-view.ts';
test('a person counts only inside the camera frustum and reach',()=>{
 const camera=new THREE.PerspectiveCamera(45,390/844,.1,2000);camera.position.set(0,2,10);camera.lookAt(0,1,0);camera.updateProjectionMatrix();
 assert.equal(anyPersonInView(camera,[]),false);
 assert.equal(anyPersonInView(camera,[[0,0,0]]),true,'straight ahead');
 assert.equal(anyPersonInView(camera,[[0,0,20]]),false,'behind the camera');
 assert.equal(anyPersonInView(camera,[[30,0,0]]),false,'far off to the side of a narrow phone view');
 assert.equal(anyPersonInView(camera,[[0,0,-400]]),false,'beyond reach');
 assert.equal(anyPersonInView(camera,[[0,0,-400]],1000),true,'within a longer reach');
 assert.equal(anyPersonInView(camera,[[30,0,0],[1,0,-5]]),true,'any one is enough');
 assert.equal(anyPersonInView(camera,[[NaN,0,0]]),true,'an unknown place counts as seen');
 // Just outside the left edge: the sphere still overlaps, so the person counts.
 const half=Math.atan(Math.tan(THREE.MathUtils.degToRad(45/2))*390/844),d=10,x=-Math.tan(half)*d-1;assert.equal(anyPersonInView(camera,[[x,0,10-d]]),true);
});
