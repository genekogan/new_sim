import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {WorldRtsCamera,farLimit,CLICK_PIVOT_DELAY_MS,NEAR_LIMIT} from '../src/WorldRtsCamera.ts';
import {liftHorizon,BROADCAST_HORIZON_LIFT} from '../src/broadcast-horizon.ts';
import {manualCameraStep,MANUAL_FAR_LIMIT} from '../src/WorldNavigation.ts';
import {CAMERA_GROUND_MARGIN} from '../src/WorldCameraGround.ts';

/** A manual camera over a flat 2000 m ground plane at y = 0, looking down ~24° at a pivot 76 m away. */
function rig(opts:{mode?:'manual'|'broadcast'|'follow';extent?:readonly [number,number,number,number]|null}={}){
  const win=new EventTarget(),doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null as unknown,hidden:false,querySelector:()=>null});
  const canvas=Object.assign(new EventTarget(),{ownerDocument:doc,focus(){doc.activeElement=canvas;},setPointerCapture(){},hasPointerCapture(){return false;},
    getBoundingClientRect:()=>({left:0,top:0,width:1600,height:900})}) as unknown as HTMLCanvasElement;
  const scene=new THREE.Scene(),ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial());scene.add(ground);scene.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(45,16/9,.1,2400);camera.position.set(0,31,70);
  const controls=Object.assign(new THREE.EventDispatcher(),{target:new THREE.Vector3(0,0,0),maxPolarAngle:Math.PI}) as unknown as OrbitControls;
  camera.lookAt(controls.target);camera.updateMatrixWorld();canvas.focus();
  let mode=opts.mode??'manual',homes=0,takeovers=0;
  const rts=new WorldRtsCamera(canvas,camera,{controls:()=>controls,mode:()=>mode,takeOver:()=>{mode='manual';takeovers++;},scene:()=>scene,pickRoots:()=>[],
    extent:()=>opts.extent===undefined?[-200,-200,200,200]:opts.extent,home:()=>{homes++;}});
  const fire=(type:string,fields:Record<string,unknown>={},surface:EventTarget=canvas)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{clientX:800,clientY:450,deltaY:0,deltaMode:0,ctrlKey:false,code:'',key:'',button:0,pointerId:1,...fields});surface.dispatchEvent(e);return e;};
  const pitch=()=>{const d=camera.getWorldDirection(new THREE.Vector3());return Math.asin(d.y)*180/Math.PI;};
  const settle=(n=40)=>{for(let i=0;i<n;i++){rts.update(1/60);camera.lookAt(controls.target);}};
  return {canvas,camera,controls,rts,fire,pitch,settle,win,homes:()=>homes,takeovers:()=>takeovers,mode:()=>mode};
}

test('C1 zoom: wheel out to the far limit and back in keeps the chosen pitch exactly', () => {
  const f=rig();try{
    const p0=f.pitch();
    for(let i=0;i<60;i++){f.fire('wheel',{deltaY:100});f.settle(6);}
    f.settle(60);
    const far=f.camera.position.distanceTo(f.controls.target);
    assert.ok(Math.abs(far-farLimit([-200,-200,200,200]))<.5,`far ${far}`);
    assert.ok(Math.abs(f.pitch()-p0)<.05,`pitch out ${f.pitch()} vs ${p0}`);
    for(let i=0;i<90;i++){f.fire('wheel',{deltaY:-100});f.settle(6);}
    f.settle(60);
    assert.ok(Math.abs(f.pitch()-p0)<.05,`pitch in ${f.pitch()} vs ${p0}`);
    assert.ok(f.camera.position.y>=CAMERA_GROUND_MARGIN,'never below the ground margin');
    const near=f.camera.position.distanceTo(f.controls.target);assert.ok(near>=NEAR_LIMIT-1e-6&&near<6,`near ${near}`);
  }finally{f.rts.dispose();}
});

test('C1 zoom: a notch is about 12% of the distance, eased; Broadcast is taken over; Follow keeps OrbitControls', () => {
  const f=rig({mode:'broadcast'});try{
    const d0=f.camera.position.distanceTo(f.controls.target);f.fire('wheel',{deltaY:100});
    assert.equal(f.mode(),'manual');assert.equal(f.takeovers(),1);
    f.rts.update(1/60);const first=f.camera.position.distanceTo(f.controls.target);
    assert.ok(first>d0&&first<d0*1.06,'eased: the first frame takes only part of the step');
    f.settle(60);assert.ok(Math.abs(f.camera.position.distanceTo(f.controls.target)/d0-Math.exp(.12))<1e-3);
  }finally{f.rts.dispose();}
  const g=rig({mode:'follow'});try{const e=g.fire('wheel',{deltaY:100});assert.equal(e.defaultPrevented,false);g.settle(10);
    assert.ok(Math.abs(g.camera.position.distanceTo(g.controls.target)-Math.hypot(31,70))<1e-9);}finally{g.rts.dispose();}
});

test('C1 zoom: toward the ground under the cursor stops at the ground margin instead of re-tilting', () => {
  const f=rig();try{
    const p0=f.pitch();
    for(let i=0;i<200;i++){f.fire('wheel',{deltaY:-100,clientX:800,clientY:850});f.settle(4);}
    assert.ok(Math.abs(f.pitch()-p0)<.05,`same pitch ${f.pitch()} vs ${p0}`);
    assert.ok(f.camera.position.y>=CAMERA_GROUND_MARGIN-1e-6&&f.camera.position.y<CAMERA_GROUND_MARGIN+.5,`stopped just above the margin: ${f.camera.position.y}`);
  }finally{f.rts.dispose();}
});

test('C1 far limit follows the map size, between 320 m and MANUAL_FAR_LIMIT', () => {
  assert.equal(farLimit(null),320);assert.equal(farLimit([-50,-50,50,50]),320);
  assert.equal(farLimit([-256,-256,256,256]),640);assert.equal(farLimit([-900,-900,900,900]),MANUAL_FAR_LIMIT);
});

// The click-pivot tests (B1: the eye stays, the view turns onto the pivot) are in world-camera-pivot-look.test.ts.

test('CAMERA-PIVOT: Follow and Broadcast ignore a click', async () => {
  for(const mode of ['follow','broadcast'] as const){
    const f=rig({mode});try{
      const eye=f.camera.position.clone(),t=f.controls.target.clone();
      f.rts.clickPivot({clientX:400,clientY:700,pointerType:'mouse'});await new Promise(r=>setTimeout(r,CLICK_PIVOT_DELAY_MS+30));f.settle(30);
      assert.ok(f.controls.target.distanceTo(t)<1e-9&&f.camera.position.distanceTo(eye)<1e-9,mode);assert.equal(f.mode(),mode);
    }finally{f.rts.dispose();}
  }
});

test('C1: Home/H goes to the overview; WASD speed grows with height; the pivot stays over the map', () => {
  const f=rig();try{
    f.fire('keydown',{code:'KeyH'},f.win);assert.equal(f.homes(),1);f.fire('keydown',{code:'Home'},f.win);assert.equal(f.homes(),2);
    const w=new Set(['KeyW']);
    assert.ok(Math.abs((manualCameraStep(w,1).forward??0)-.1*3)<1e-9,'dt is capped at .1 s');
    assert.ok(Math.abs((manualCameraStep(w,.1,10).forward??0)-3)<1e-9);
    assert.ok(Math.abs((manualCameraStep(w,.1,.2).forward??0)-.3)<1e-9,'never slower than the base');
    f.controls.target.set(5000,0,0);f.camera.position.set(5000,31,70);f.rts.update(1/60);
    assert.equal(f.controls.target.x,300);assert.equal(f.camera.position.x,300);
  }finally{f.rts.dispose();}
});

test('C1 broadcast: the aim lifts toward the horizon by the tunable fraction, same eye and distance', () => {
  const eye=[0,10,0],at=[0,0,-10/Math.tan(25*Math.PI/180)],lifted=liftHorizon(eye,at);
  const d=(a:readonly number[],b:readonly number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  assert.ok(Math.abs(d(eye,lifted)-d(eye,at))<1e-9);
  const pitch=Math.atan2(lifted[1]-eye[1],Math.hypot(lifted[0]-eye[0],lifted[2]-eye[2]))*180/Math.PI;
  assert.ok(Math.abs(pitch+25*(1-BROADCAST_HORIZON_LIFT))<1e-9,String(pitch));
  assert.deepEqual(liftHorizon(eye,[0,12,-5]),[0,12,-5],'an upward look is unchanged');
  assert.deepEqual(liftHorizon(eye,at,0),at);
});
