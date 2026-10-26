import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {WorldRtsCamera,clickPivotPose,headGaze,lookFor,orbitEye,CLICK_PIVOT_DELAY_MS,LOOK_BLEND_SECONDS,LOOK_MODEL} from '../src/WorldRtsCamera.ts';
import {cameraGround} from '../src/WorldCameraGround.ts';
import {SoulFlight,easeInOut,followShot,soulFlightSeconds,SHOT_NEAR,SHOT_FAR,SHOT_LOW,SHOT_HIGH} from '../src/WorldSoulFlight.ts';

/** Lane B (camera, 2026-10-26): B2a pivot state, B1 click-pivot, B2 head look, B3 flight to a Soul. */
function rig(ground?:THREE.Mesh){
  const win=new EventTarget(),doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null as unknown,hidden:false,querySelector:()=>null});
  const canvas=Object.assign(new EventTarget(),{ownerDocument:doc,focus(){doc.activeElement=canvas;},setPointerCapture(){},hasPointerCapture(){return false;},
    getBoundingClientRect:()=>({left:0,top:0,width:1600,height:900})}) as unknown as HTMLCanvasElement;
  const scene=new THREE.Scene();scene.add(ground??new THREE.Mesh(new THREE.PlaneGeometry(2000,2000).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial()));scene.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(45,16/9,.1,2400);camera.position.set(0,31,70);
  const controls=Object.assign(new THREE.EventDispatcher(),{target:new THREE.Vector3(0,0,0),maxPolarAngle:Math.PI}) as unknown as OrbitControls;
  camera.lookAt(controls.target);camera.updateMatrixWorld();canvas.focus();
  let mode:'manual'|'follow'='manual';
  const rts=new WorldRtsCamera(canvas,camera,{controls:()=>controls,mode:()=>mode,takeOver:()=>{mode='manual';},scene:()=>scene,pickRoots:()=>[],extent:()=>[-200,-200,200,200]});
  const fire=(type:string,fields:Record<string,unknown>={},surface:EventTarget=canvas)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{clientX:800,clientY:450,deltaY:0,deltaMode:0,ctrlKey:false,code:'',key:'',button:0,pointerId:1,...fields});surface.dispatchEvent(e);return e;};
  /** One LiveWorld frame: rts.update, OrbitControls aiming at its target, then the head offset. */
  const frame=(dt=1/60)=>{rts.update(dt);camera.lookAt(controls.target);rts.afterControls();camera.updateMatrixWorld();};
  const centreMiss=(p:THREE.Vector3)=>{const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);return ray.ray.distanceToPoint(p);};
  const pointerGround=(x:number,y:number)=>{const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/1600*2-1,-(y/900)*2+1),camera);return ray.ray;};
  return {win,canvas,camera,controls,rts,fire,frame,centreMiss,pointerGround,setMode:(m:'manual'|'follow')=>{mode=m;},mode:()=>mode,scene};
}
const wait=()=>new Promise(r=>setTimeout(r,CLICK_PIVOT_DELAY_MS+40));
const levelHorizon=(camera:THREE.Camera)=>{camera.updateMatrixWorld();return Math.abs(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).y);};

test('B2a: the pivot is the module state the ring shows; an outside re-frame of controls.target is adopted', () => {
  const f=rig();try{
    f.frame();assert.deepEqual(f.rts.pivot.toArray(),[0,0,0]);
    f.controls.target.set(20,0,-10);f.camera.position.set(20,15,20);f.camera.lookAt(f.controls.target);f.frame();
    assert.deepEqual(f.rts.pivot.toArray(),[20,0,-10],'a framing elsewhere moves the pivot with it');
    assert.ok(f.centreMiss(f.rts.pivot)<1e-6);
  }finally{f.rts.dispose();}
});

test('B1: a click sets the pivot under the cursor and never translates the eye; the view turns onto it', async () => {
  const f=rig();try{
    for(const [x,y] of [[400,700],[1250,600],[820,300]] as const){
      const eye=f.camera.position.clone(),expected=f.pointerGround(x,y).intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3())!;
      f.rts.clickPivot({clientX:x,clientY:y,pointerType:'mouse'});f.frame();
      assert.deepEqual(f.camera.position.toArray(),eye.toArray(),'inside the double-click window nothing moves');
      await wait();
      assert.ok(f.rts.pivot.distanceTo(expected)<.02,`pivot ${f.rts.pivot.toArray()} = picked ${expected.toArray()}`);
      assert.deepEqual(f.controls.target.toArray(),f.rts.pivot.toArray(),'controls orbit about the pivot');
      for(let t=0;t<LOOK_BLEND_SECONDS+.1;t+=1/60){f.frame();assert.deepEqual(f.camera.position.toArray(),eye.toArray(),'the eye never moves');}
      assert.ok(f.centreMiss(f.rts.pivot)<1e-6,'after the re-aim the pivot is at the screen centre');
      assert.ok(levelHorizon(f.camera)<1e-9);
    }
  }finally{f.rts.dispose();}
});

test('B1: a double-click still cancels the pending click and flies (unchanged)', async () => {
  const f=rig();try{
    const t=f.rts.pivot.clone();f.rts.clickPivot({clientX:1200,clientY:700,pointerType:'mouse'});f.fire('dblclick',{clientX:1200,clientY:700});
    await wait();for(let i=0;i<70;i++)f.frame();
    assert.ok(f.rts.pivot.distanceTo(t)>3,'the double-click flew to its point');
  }finally{f.rts.dispose();}
});

test('B2: arrows and right-drag turn the head and leave the pivot (and the eye) bit-identical, horizon level', () => {
  assert.equal(LOOK_MODEL,'head','Q1 default');
  const f=rig();try{
    f.frame();const pivot=f.rts.pivot.toArray(),eye=f.camera.position.toArray(),gaze=f.camera.getWorldDirection(new THREE.Vector3());
    f.fire('keydown',{code:'ArrowRight'},f.win);f.fire('keydown',{code:'ArrowUp'},f.win);for(let i=0;i<30;i++)f.frame();
    f.fire('keyup',{code:'ArrowRight'},f.win);f.fire('keyup',{code:'ArrowUp'},f.win);f.frame();
    assert.deepEqual(f.rts.pivot.toArray(),pivot);assert.deepEqual(f.controls.target.toArray(),pivot);assert.deepEqual(f.camera.position.toArray(),eye);
    const turned=f.camera.getWorldDirection(new THREE.Vector3());assert.ok(turned.angleTo(gaze)>.3,'the head turned');assert.ok(turned.x>0&&turned.y>gaze.y,'right and up');
    assert.ok(levelHorizon(f.camera)<1e-9,'horizon stays level');
    f.fire('pointerdown',{button:2});f.fire('pointermove',{button:2,clientX:900,clientY:400});f.fire('pointerup',{button:2},f.win);f.frame();
    assert.deepEqual(f.rts.pivot.toArray(),pivot);assert.deepEqual(f.camera.position.toArray(),eye);assert.ok(levelHorizon(f.camera)<1e-9);
    assert.ok(Math.abs(f.rts.headLook.yaw)>.1);
  }finally{f.rts.dispose();}
});

test('B2: the next orbit (or zoom) eases the head back onto the pivot over 0.3 s', () => {
  for(const gesture of ['orbit','zoom'] as const){
    const f=rig();try{
      f.fire('keydown',{code:'ArrowLeft'},f.win);for(let i=0;i<40;i++)f.frame();f.fire('keyup',{code:'ArrowLeft'},f.win);f.frame();
      assert.ok(f.centreMiss(f.rts.pivot)>5,'looking away from the pivot');
      if(gesture==='orbit')f.controls.dispatchEvent({type:'start'} as never);else f.fire('wheel',{deltaY:100});
      f.frame(LOOK_BLEND_SECONDS/2);const mid=Math.abs(f.rts.headLook.yaw);assert.ok(mid>0&&mid<.9,'blending, not snapped');
      for(let i=0;i<30;i++)f.frame();
      assert.deepEqual(f.rts.headLook,{yaw:0,pitch:0});assert.ok(f.centreMiss(f.rts.pivot)<1e-6,`${gesture} ends looking at the pivot`);
      if(gesture==='orbit')f.controls.dispatchEvent({type:'end'} as never);
    }finally{f.rts.dispose();}
  }
});

test('B2: WASD/QE walking pans eye and pivot together, the head offset kept', () => {
  const f=rig();try{
    f.fire('keydown',{code:'ArrowRight'},f.win);for(let i=0;i<20;i++)f.frame();f.fire('keyup',{code:'ArrowRight'},f.win);f.frame();
    const look={...f.rts.headLook},p0=f.rts.pivot.clone(),e0=f.camera.position.clone();
    f.fire('keydown',{code:'KeyW'},f.win);f.fire('keydown',{code:'KeyE'},f.win);for(let i=0;i<30;i++)f.frame();f.fire('keyup',{code:'KeyW'},f.win);f.fire('keyup',{code:'KeyE'},f.win);
    const dp=f.rts.pivot.clone().sub(p0),de=f.camera.position.clone().sub(e0);
    assert.ok(de.length()>1);assert.ok(dp.distanceTo(de)<1e-9,'same translation');assert.ok(Math.abs(f.rts.headLook.yaw-look.yaw)<1e-12);
  }finally{f.rts.dispose();}
});

test('B2 math: headGaze/lookFor are inverses; Q1 alternative orbitEye keeps the pivot and distance', () => {
  const eye=new THREE.Vector3(3,12,40),pivot=new THREE.Vector3(-5,0,0);
  for(const look of [{yaw:.4,pitch:.2},{yaw:-2.5,pitch:-.3},{yaw:0,pitch:0}]){
    const back=lookFor(eye,pivot,headGaze(eye,pivot,look));assert.ok(Math.abs(back.yaw-look.yaw)<1e-9&&Math.abs(back.pitch-look.pitch)<1e-9,JSON.stringify(back));
  }
  assert.ok(headGaze(eye,pivot,{yaw:0,pitch:0}).distanceTo(pivot.clone().sub(eye).normalize())<1e-12);
  const moved=orbitEye(eye,pivot,.5,-.1);assert.ok(Math.abs(moved.distanceTo(pivot)-eye.distanceTo(pivot))<1e-9);assert.ok(moved.distanceTo(eye)>1);
});

test('B3: flight duration is clamp(1, 3, 1 + d/60 + θ/120°) and the easing lands exactly', () => {
  const deg=Math.PI/180;
  assert.equal(soulFlightSeconds(0,0),1);assert.equal(soulFlightSeconds(60,0),2);assert.ok(Math.abs(soulFlightSeconds(0,120*deg)-2)<1e-12);
  assert.ok(Math.abs(soulFlightSeconds(30,60*deg)-2)<1e-12);assert.equal(soulFlightSeconds(900,0),3);assert.equal(soulFlightSeconds(NaN,NaN),1);
  assert.equal(easeInOut(0),0);assert.equal(easeInOut(1),1);assert.equal(easeInOut(.5),.5);
  for(let t=0;t<1;t+=.05)assert.ok(easeInOut(t+.05)>=easeInOut(t));
  assert.ok(easeInOut(.01)<.001&&easeInOut(.99)>.999,'eased in and out');
});

test('B3: the Follow shot is 6-12 m out at 15-40 degrees on the camera side; a flight lands exactly on it, tracking a walking Soul', () => {
  const target=new THREE.Vector3(10,1,-5);
  for(const eye of [new THREE.Vector3(0,300,250),new THREE.Vector3(14,2,-2),new THREE.Vector3(10,1.5,-5.5)]){
    const shot=followShot(eye,target),off=shot.eye.clone().sub(target),el=Math.atan2(off.y,Math.hypot(off.x,off.z));
    assert.ok(off.length()>=SHOT_NEAR-1e-9&&off.length()<=SHOT_FAR+1e-9);assert.ok(el>=SHOT_LOW-1e-9&&el<=SHOT_HIGH+1e-9);
    assert.ok(off.x*(eye.x-target.x)>=0&&off.z*(eye.z-target.z)>=0,'same side');
  }
  const eye=new THREE.Vector3(0,300,250),gaze=new THREE.Vector3(0,-1,-1).normalize(),flight=new SoulFlight('s_a',eye,gaze,350,target);
  assert.equal(flight.seconds,3,'from the overview: the 3 s cap');
  const walking=target.clone();let pose=flight.step(0,walking);assert.ok(pose.eye.distanceTo(eye)<1e-9,'starts at the eye');
  assert.ok(pose.target.clone().sub(eye).normalize().distanceTo(gaze)<1e-9,'starts on the current gaze');
  let n=0;while(!pose.done&&n<1000){walking.x+=.01;pose=flight.step(1/60,walking);n++;}
  assert.ok(pose.done&&Math.abs(n/60-3)<.05,`${n} frames`);
  const shot=followShot(eye,target),offset=shot.eye.clone().sub(shot.target);
  assert.ok(pose.target.distanceTo(walking)<1e-9,'lands on the Soul');assert.ok(pose.eye.distanceTo(walking.clone().add(offset))<1e-9,'at the Follow shot');
  const near=new SoulFlight('s_a',new THREE.Vector3(14,4,-1),target.clone().sub(new THREE.Vector3(14,4,-1)).normalize(),6,target);
  assert.ok(near.seconds<1.2,`close by ${near.seconds}`);
});

test('B1: on a slope the pivot is on the drawn ground; an eye below the clicked point is lifted only to 1 m above it', async () => {
  const slope=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000).rotateX(-Math.PI/2).rotateZ(.2),new THREE.MeshBasicMaterial());
  const f=rig(slope),height=(x:number)=>Math.tan(.2)*x;try{
    cameraGround.heightAt(f.scene,0,0,performance.now()+1e7);  // the shared ground cache keeps the meshes it saw for 3 s: take this scene's (last test in the file)
    f.rts.clickPivot({clientX:1300,clientY:650,pointerType:'mouse'});await wait();
    const p=f.rts.pivot;assert.ok(Math.abs(p.x)>3,'clicked off-centre');assert.ok(Math.abs(p.y-height(p.x))<.02,`on the slope: ${p.toArray()} vs ${height(p.x)}`);
  }finally{f.rts.dispose();}
  const low=clickPivotPose(new THREE.Vector3(10,-2,0),new THREE.Vector3(3,4,3));
  assert.deepEqual(low.eye.toArray(),[10,5,0]);assert.deepEqual(low.pivot.toArray(),[3,4,3]);
  const high=new THREE.Vector3(1,30,2);assert.deepEqual(clickPivotPose(high,new THREE.Vector3(0,0,0)).eye.toArray(),high.toArray());
});
