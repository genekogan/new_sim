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

function manualRig(radius=30,mode:'follow'|'manual'='manual'){
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null as unknown,hidden:false,querySelector:()=>null});
 const canvas=Object.assign(new EventTarget(),{ownerDocument:doc,focus(){doc.activeElement=canvas;},setPointerCapture(){},hasPointerCapture(){return false;}}) as unknown as HTMLCanvasElement;
 const camera=new THREE.PerspectiveCamera(45,16/9,.1,2000);camera.position.set(0,3,0);
 const controls=Object.assign(new THREE.EventDispatcher(),{target:new THREE.Vector3(0,3,-radius),maxPolarAngle:Math.PI}) as unknown as OrbitControls;camera.lookAt(controls.target);canvas.focus();
 let takeovers=0;const rts=new WorldRtsCamera(canvas,camera,{controls:()=>controls,mode:()=>mode,takeOver:()=>{mode='manual';takeovers++;},scene:()=>new THREE.Scene(),pickRoots:()=>[]});
 const fire=(type:string,fields:Record<string,unknown>={},surface:EventTarget=win)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{code:'',key:'',pointerId:1,button:2,clientX:0,clientY:0,...fields});surface.dispatchEvent(event);return event;};
 const hold=(codes:string[])=>{codes.forEach(code=>fire('keydown',{code}));for(let i=0;i<60;i++)rts.update(1/60);codes.forEach(code=>fire('keyup',{code}));};
 return {camera,controls,rts,win,doc,canvas,fire,hold,takeovers:()=>takeovers,mode:()=>mode};
}
for(const radius of [30,300])for(const [keys,speed]of [[['KeyW'],3],[['KeyW','ShiftLeft'],9],[['KeyW','AltLeft'],.6],[['KeyW','KeyD','KeyE'],3]] as const){
 test(`manual speed at ${radius}m radius is bounded ${speed}m/s for ${keys.join('+')}`,()=>{
  const f=manualRig(radius),p=f.camera.position.clone();try{f.hold([...keys]);assert.ok(Math.abs(f.camera.position.distanceTo(p)-speed)<1e-8);assert.equal(f.takeovers(),1);}finally{f.rts.dispose();}
 });
}
test('Follow keyboard handover preserves eye/gaze before horizontal translation; arrows only turn the head',()=>{
 const f=manualRig(30,'follow'),before=f.camera.position.clone(),direction=f.camera.getWorldDirection(new THREE.Vector3());try{
  f.fire('keydown',{code:'KeyW'});f.rts.update(.1);assert.equal(f.mode(),'manual');assert.equal(f.takeovers(),1);
  assert.ok(f.camera.position.distanceTo(before.clone().addScaledVector(direction,.3))<1e-9);
  assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)<1e-9);f.fire('keyup',{code:'KeyW'});
  const p=f.camera.position.clone();f.hold(['ArrowRight','ArrowUp']);assert.ok(f.camera.position.distanceTo(p)<1e-9);assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).x>.3);
 }finally{f.rts.dispose();}
});
test('right mouse looks in place, mouse and keys combine, and blur clears all retained input',()=>{
 const f=manualRig(30,'follow'),before=f.camera.position.clone();try{
  assert.equal(f.fire('pointerdown',{},f.canvas).defaultPrevented,true);assert.equal(f.mode(),'follow','a right click alone does not change the camera');
  assert.equal(f.fire('pointermove',{clientX:40,clientY:-20},f.canvas).defaultPrevented,true);
  assert.equal(f.mode(),'manual');assert.ok(f.camera.position.distanceTo(before)<1e-9);assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).x>.1);
  f.fire('keydown',{code:'KeyW'});f.rts.update(.1);assert.ok(Math.abs(f.camera.position.distanceTo(before)-.3)<1e-8);
  f.win.dispatchEvent(new Event('blur'));const p=f.camera.position.clone(),q=f.camera.quaternion.clone();f.rts.update(.1);
  f.fire('pointermove',{clientX:100,clientY:100},f.canvas);assert.ok(f.camera.position.distanceTo(p)<1e-9);assert.ok(f.camera.quaternion.angleTo(q)<1e-7);
 }finally{f.rts.dispose();}
});

test('Escape and explicit release stop a pending glide and held movement at the current pose',()=>{
 const f=manualRig();try{
  f.rts.flyTo(new THREE.Vector3(30,0,-30));f.rts.update(.1);const p=f.camera.position.clone();
  f.fire('keydown',{key:'Escape',code:'Escape'});f.rts.update(.1);assert.ok(f.camera.position.distanceTo(p)<1e-9);
  f.fire('keydown',{code:'KeyW'});f.rts.update(.1);const moved=f.camera.position.clone();f.rts.release();f.rts.update(.1);assert.ok(f.camera.position.distanceTo(moved)<1e-9);
 }finally{f.rts.dispose();}
});

test('the ordinary Follow button keeps immediate arrow head control without moving the eye',()=>{
 const f=manualRig(30,'follow'),p=f.camera.position.clone(),q=f.camera.quaternion.clone();try{
  f.doc.activeElement={tagName:'BUTTON',closest:(selector:string)=>selector.includes('.human-panel')?{}:null};
  assert.equal(f.fire('keydown',{code:'ArrowUp'}).defaultPrevented,true);f.rts.update(.1);
  assert.equal(f.mode(),'manual');assert.equal(f.takeovers(),1);
  assert.ok(f.camera.position.distanceTo(p)<1e-9);assert.ok(f.camera.quaternion.angleTo(q)>.05);
 }finally{f.rts.dispose();}
});

test('camera arrows leave editors, widget buttons, modal dialogs and focused panel scrolling alone',()=>{
 for(const role of ['dialog','radiogroup','listbox','menu','slider','textbox','input','panel','modal']){
  const f=manualRig(30,'follow'),p=f.camera.position.clone(),q=f.camera.quaternion.clone();try{
   const active={tagName:role==='input'?'INPUT':role==='panel'?'H2':'BUTTON',getAttribute:(name:string)=>name==='role'&&role==='textbox'?'textbox':null,
    closest:(selector:string)=>selector.includes(`[role=${role}]`)?{}:null};
   f.doc.activeElement=active;
   if(role==='modal')f.doc.querySelector=()=>({}) as never;
   assert.equal(f.fire('keydown',{code:'ArrowUp',composedPath:()=>[active]}).defaultPrevented,false,role);f.rts.update(.1);
   assert.equal(f.mode(),'follow',role);assert.equal(f.takeovers(),0,role);
   assert.ok(f.camera.position.distanceTo(p)<1e-9,role);assert.ok(f.camera.quaternion.angleTo(q)<1e-7,role);
  }finally{f.rts.dispose();}
 }
});
