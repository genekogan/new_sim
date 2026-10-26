import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldNavigation, type NavigationContext } from '../src/WorldNavigation.ts';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WorldRtsCamera, CLICK_PIVOT_DELAY_MS, LOOK_BLEND_SECONDS } from '../src/WorldRtsCamera.ts';

// Minimal canvas stub: records listeners so tests can deliver focus/key events.
function stubCanvas(){
  const listeners=new Map<string,((e:any)=>void)[]>(),doc={defaultView:null,hidden:false,activeElement:null as unknown,addEventListener(){},removeEventListener(){}};
  const canvas:any={tabIndex:-1,ownerDocument:doc,addEventListener(name:string,cb:(e:any)=>void){listeners.set(name,[...(listeners.get(name)??[]),cb]);},removeEventListener(){},
    hasPointerCapture:()=>false,releasePointerCapture(){},setPointerCapture(){},focus(){},blur(){}};
  const fire=(name:string,e:any={})=>{for(const cb of listeners.get(name)??[])cb({composedPath:()=>[],preventDefault(){},...e});};
  return {canvas,fire};
}
function rig(){
  const {canvas,fire}=stubCanvas(),camera=new THREE.PerspectiveCamera(45,1,.1,500),target=new THREE.Vector3(0,1.5,-10);
  camera.position.set(0,1.5,0);camera.lookAt(target);
  const context:NavigationContext={mode:'manual',navigation:'free',lifecycle:''};
  const nav=new WorldNavigation(canvas,camera,()=>target,()=>context,()=>{});
  fire('focus');
  const hold=(code:string,seconds=.5)=>{fire('keydown',{code,key:code});for(let i=0;i<Math.round(seconds/.05);i++)nav.update(.05);fire('keyup',{code,key:code});};
  return {camera,target,nav,hold};
}
const dir=(c:THREE.Camera)=>c.getWorldDirection(new THREE.Vector3());

test('arrow left/right turn the view in place; right turns clockwise seen from above', () => {
  const {camera,hold}=rig(),p0=camera.position.clone();
  hold('ArrowRight');const d=dir(camera);
  assert.ok(d.x>.3,'facing -Z, turning right swings toward +X');assert.ok(camera.position.distanceTo(p0)<1e-9,'turning does not move');
  hold('ArrowLeft');hold('ArrowLeft');assert.ok(dir(camera).x<-.3);
});

test('arrows pitch the head in place; horizontal W movement keeps its height',()=>{
  const {camera,hold}=rig(),p0=camera.position.clone();
  hold('ArrowUp');assert.ok(dir(camera).y>.3);assert.ok(camera.position.distanceTo(p0)<1e-9);
  hold('ArrowDown');assert.ok(Math.abs(dir(camera).y)<1e-8);
  hold('ArrowUp');const y=camera.position.y,z=camera.position.z;hold('KeyW');
  assert.equal(camera.position.y,y);assert.ok(camera.position.z<z-1);
});

test('Q/E raise/lower without tilting; arrow pitch is clamped short of vertical',()=>{
  const {camera,hold}=rig(),d0=dir(camera),y=camera.position.y;
  hold('KeyQ');assert.ok(camera.position.y<y-1);assert.ok(dir(camera).distanceTo(d0)<1e-9);
  hold('KeyE');assert.ok(Math.abs(camera.position.y-y)<1e-8);
  hold('ArrowUp',3);assert.ok(dir(camera).y>.9&&dir(camera).y<.999);
});

test('button deltas (yaw/pitch) apply through move()', () => {
  const {camera,nav}=rig();
  assert.equal(nav.move({yaw:.2}),true);assert.ok(dir(camera).x>.15);
  nav.move({pitch:-.15});assert.ok(dir(camera).y<-.1);
});

function pivotRig(){
  const win=new EventTarget(),doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null as unknown,hidden:false,querySelector:()=>null});
  const canvas=Object.assign(new EventTarget(),{ownerDocument:doc,focus(){doc.activeElement=canvas;},setPointerCapture(){},hasPointerCapture(){return false;},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})}) as unknown as HTMLCanvasElement;
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(200,200).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial()));scene.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(45,1,.1,500);camera.position.set(10,8,12);
  const controls=Object.assign(new THREE.EventDispatcher(),{target:new THREE.Vector3(0,0,0),maxPolarAngle:Math.PI}) as unknown as OrbitControls;
  camera.lookAt(controls.target);camera.updateMatrixWorld();canvas.focus();
  const rts=new WorldRtsCamera(canvas,camera,{controls:()=>controls,mode:()=>'manual',takeOver:()=>{},scene:()=>scene,pickRoots:()=>[],extent:()=>[-100,-100,100,100]});
  const frame=(dt=1/30)=>{rts.update(dt);camera.lookAt(controls.target);rts.afterControls();camera.updateMatrixWorld();};
  const key=(type:string,code:string)=>win.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{code,key:code}));
  return {camera,controls,rts,frame,key};
}

// Test ID kept from main (WorldOrbitPivot is gone); the assertions are B1's: the clicked point is the orbit centre, the eye stays.
test('orbit pivot: clicked point becomes the centre; camera keeps the same offset', async () => {
  const f=pivotRig();try{
    const eye=f.camera.position.clone(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(.3,-.2),f.camera);
    const point=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3())!;
    f.rts.clickPivot({clientX:650,clientY:600});await new Promise(r=>setTimeout(r,CLICK_PIVOT_DELAY_MS+30));for(let i=0;i<20;i++)f.frame();
    assert.ok(f.rts.pivot.distanceTo(point)<.02&&f.controls.target.distanceTo(point)<.02,'the clicked point is the orbit centre');
    assert.deepEqual(f.camera.position.toArray(),eye.toArray(),'the eye is unchanged');
  }finally{f.rts.dispose();}
});

// Test ID kept from main (WorldOrbitPivot is gone); the assertions are B2's: a new gesture mid-blend cancels the look blend.
test('orbit pivot: a new gesture cancels the glide mid-way', () => {
  const f=pivotRig();try{
    f.key('keydown','ArrowRight');for(let i=0;i<15;i++)f.frame();f.key('keyup','ArrowRight');f.frame();
    const looked=f.rts.headLook.yaw;assert.ok(looked>.3);
    f.controls.dispatchEvent({type:'start'} as never);f.frame(LOOK_BLEND_SECONDS/2);f.controls.dispatchEvent({type:'end'} as never);
    const mid=f.rts.headLook.yaw;assert.ok(mid>0&&mid<looked,'blending back');
    f.key('keydown','ArrowRight');f.frame(1/30);f.key('keyup','ArrowRight');const after=f.rts.headLook.yaw;
    for(let i=0;i<30;i++)f.frame();
    assert.ok(Math.abs(f.rts.headLook.yaw-after)<1e-12&&after>mid,'the new gesture cancelled the blend; the head stays where it put it');
  }finally{f.rts.dispose();}
});
