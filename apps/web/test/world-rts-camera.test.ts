import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {centreGround,WorldRtsCamera} from '../src/WorldRtsCamera.ts';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';

test('VF2: the pivot is the ground under the screen centre (drawn terrain, else y = 0)', () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, .1, 2000);
  camera.position.set(0, 10, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const flat = centreGround(camera, null)!;
  assert.ok(flat.distanceTo(new THREE.Vector3(0, 0, 0)) < .2, JSON.stringify(flat));
  // A raised terrain plane: the pivot lands on it, nearer than the y = 0 point.
  const scene = new THREE.Scene(), hill = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  hill.position.y = 2; scene.add(hill); scene.updateMatrixWorld(true);
  const raised = centreGround(camera, scene)!;
  assert.ok(Math.abs(raised.y - 2) < .05 && raised.z > 1.5, JSON.stringify(raised));
  camera.lookAt(0, 10, -50); camera.updateMatrixWorld();
  assert.equal(centreGround(camera, null), null, 'looking at the horizon has no pivot on the ground');
});

test('Follow orbit never paints a manual pivot at the Soul torso; manual orbit retains its pivot',()=>{
  const win=new EventTarget(),doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null,querySelector:()=>null});
  const canvas=Object.assign(new EventTarget(),{ownerDocument:doc}) as unknown as HTMLCanvasElement;
  const controls=Object.assign(new THREE.EventDispatcher(),{target:new THREE.Vector3(0,1,0),maxPolarAngle:Math.PI}) as unknown as OrbitControls;
  const camera=new THREE.PerspectiveCamera(45,16/9,.1,2000);camera.position.set(4,3,4);
  const before=camera.position.clone();let mode:'follow'|'manual'='follow';
  const rts=new WorldRtsCamera(canvas,camera,{controls:()=>controls,mode:()=>mode,takeOver:()=>{mode='manual';},scene:()=>new THREE.Scene(),pickRoots:()=>[]});
  rts.update(0);controls.dispatchEvent({type:'start'});rts.update(.05);
  assert.equal(rts.marker.visible,false,'camera target at torso is not a Soul hover marker');
  assert.deepEqual(camera.position,before,'Follow orbit ownership and camera position are unchanged');
  controls.dispatchEvent({type:'end'});mode='manual';rts.update(.05);
  assert.equal(rts.marker.visible,true,'manual camera still marks its chosen pivot');
  assert.equal(rts.marker.position.y,1.04);rts.dispose();
});
