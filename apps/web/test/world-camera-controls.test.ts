import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldNavigation, type NavigationContext } from '../src/WorldNavigation.ts';
import { WorldOrbitPivot } from '../src/WorldOrbitPivot.ts';

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

test('orbit pivot: clicked point becomes the centre; camera keeps the same offset', () => {
  const pivot=new WorldOrbitPivot(),camera=new THREE.PerspectiveCamera(45,1,.1,500),target=new THREE.Vector3(0,0,0);
  camera.position.set(10,8,12);camera.lookAt(target);camera.updateMatrixWorld();
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial());ground.updateMatrixWorld();
  const point=pivot.pick(new THREE.Vector2(.3,-.2),camera,[ground]);assert.ok(point&&Math.abs(point.y)<1e-6);
  const offset=camera.position.clone().sub(target);pivot.start(camera,target,point!);
  for(let i=0;i<40;i++)pivot.update(1/30,camera,target);
  assert.ok(target.distanceTo(point!)<1e-6,'centre reached');assert.ok(camera.position.clone().sub(target).distanceTo(offset)<1e-6,'same distance and angle');
  assert.equal(pivot.gliding,false);pivot.dispose();
});

test('orbit pivot: a new gesture cancels the glide mid-way', () => {
  const pivot=new WorldOrbitPivot(),camera=new THREE.PerspectiveCamera(),target=new THREE.Vector3();camera.position.set(0,5,10);
  pivot.start(camera,target,new THREE.Vector3(20,0,0));pivot.update(.1,camera,target);const mid=target.clone();
  pivot.cancel();pivot.update(.1,camera,target);assert.ok(target.distanceTo(mid)<1e-9);assert.ok(mid.x>0&&mid.x<20);
});
