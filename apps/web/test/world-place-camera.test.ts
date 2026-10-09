import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {WorldPlaceCamera} from '../src/WorldPlaceCamera.ts';
import {WorldRtsCamera} from '../src/WorldRtsCamera.ts';
import {WorldOrbitPivot} from '../src/WorldOrbitPivot.ts';
import {WorldPlacePreviews} from '../src/WorldPlacePreviews.ts';
import {WORLD_PLACE_VIEWS,worldPlaceView} from '../src/WorldPlaces.ts';
import {WALL_FRAME_MANIFEST} from '../src/WorldWallFrames.ts';
import {WorldAuthoredBoundaries} from '../src/WorldAuthoredBoundaries.ts';
import {constrainOfficeGuardCamera} from '../src/WorldOfficeGuards.ts';
import {officeStairGuardBoxes} from '../../../mars/viewer/lib/office-stair-guards.ts';
import {authoredBoundaryDeclarationV1} from '../../../packages/engine-contract/src/authored-boundaries-v1.ts';
import {createEdenPublicQuarter} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/public-quarter.ts';
import {createEdenInteriors,interiorBoxes} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/index.ts';

void test('Explore replaces pending RTS flight and orbit glide, retaining its endpoint across scene refreshes',()=>{
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null,querySelector:()=>null});
 const canvas=Object.assign(new EventTarget(),{ownerDocument:doc}) as unknown as HTMLCanvasElement;
 const controls=Object.assign(new THREE.EventDispatcher(),{target:new THREE.Vector3(),maxPolarAngle:Math.PI,update(){}}) as unknown as OrbitControls;
 const camera=new THREE.PerspectiveCamera(45,16/9,.1,2000);camera.position.set(0,10,10);
 let mode:'follow'|'manual'='follow';const rts=new WorldRtsCamera(canvas,camera,{controls:()=>controls,mode:()=>mode,takeOver:()=>{mode='manual';},scene:()=>new THREE.Scene(),pickRoots:()=>[]}),pivot=new WorldOrbitPivot(),framing=new WorldPlaceCamera();
 try{rts.flyTo(new THREE.Vector3(150,0,150));pivot.start(camera,controls.target,new THREE.Vector3(40,0,40));rts.update(.1);
  for(const id of ['fountain','gallery','int-office-studio']){win.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code:'KeyW',key:'w'}));const view=worldPlaceView(id)!;framing.place(camera,()=>controls,view,()=>{mode='manual';},()=>{rts.release();pivot.cancel();});
   for(let i=0;i<100;i++){rts.update(.05);pivot.update(.05,camera,controls.target);framing.initial(()=>{camera.position.set(400,200,400);});}
   assert.deepEqual(camera.position.toArray(),view.p);assert.deepEqual(controls.target.toArray(),view.target);assert.equal(mode,'manual');assert.equal(pivot.gliding,false);
  }
 }finally{rts.dispose();pivot.dispose();}
 const fresh=new WorldPlaceCamera();let calls=0;fresh.initial(()=>calls++);fresh.initial(()=>calls++);assert.equal(calls,1,'initial real scenery is still framed exactly once');
});

void test('the next rendered frame sweeps from the selected legal endpoint while manual wall crossing stays blocked',()=>{
 const camera=new THREE.PerspectiveCamera(),target=new THREE.Vector3(),framing=new WorldPlaceCamera(),view=worldPlaceView('int-office-studio')!,oldEye=new THREE.Vector3(100,4.7,18.5);
 camera.position.copy(oldEye);const boundaries=new WorldAuthoredBoundaries();boundaries.bind({body:{scene:{authoredBoundaries:{...authoredBoundaryDeclarationV1('fixture-wall',[{id:'wall-between-views',buildingId:'fixture',kind:'wall',c:[99,3,18.5],half:[.1,3,5],yaw:0}]),acceptedAtTick:1}}}});
 framing.place(camera,()=>({target,update(){}}),view,()=>{},()=>{});
 const frameStart=camera.position.clone(); // LiveWorld records this before any movement/update on every RAF.
 assert.equal(boundaries.constrain(camera,target,frameStart,1),false);assert.equal(constrainOfficeGuardCamera(camera,target,frameStart,officeStairGuardBoxes()),false);assert.deepEqual(camera.position.toArray(),view.p);
 assert.equal(boundaries.constrain(camera,target,oldEye,1),true,'the same wall still blocks an actual manual sweep from the old eye');
});

void test('gallery preset sees both actual frame corners unobstructed by the authored library furniture',()=>{
 const view=WORLD_PLACE_VIEWS.gallery,camera=new THREE.PerspectiveCamera(45,16/9,.1,100);camera.position.fromArray(view.p);camera.lookAt(new THREE.Vector3().fromArray(view.target));camera.updateMatrixWorld(true);
 const boxes=interiorBoxes().filter(b=>b.room==='library'),ray=new THREE.Ray(),hit=new THREE.Vector3();
 for(const row of WALL_FRAME_MANIFEST)for(const x of [-.5,0,.5])for(const y of [-.5,0,.5]){
  const p=new THREE.Vector3(row.p[0]+x*row.width,row.p[1]+y*row.height,row.p[2]),projection=p.clone().project(camera);
  assert.ok(Math.abs(projection.x)<.98&&Math.abs(projection.y)<.98,`${row.id} fits gallery frame`);
  ray.set(camera.position,p.clone().sub(camera.position).normalize());
  for(const box of boxes){const bounds=new THREE.Box3(new THREE.Vector3(...box.min),new THREE.Vector3(...box.max));if(ray.intersectBox(bounds,hit))assert.ok(hit.distanceTo(camera.position)>p.distanceTo(camera.position)-.01,`${row.id} occluded by ${box.label}`);}
 }
});

void test('actual library and office preview meshes fill the transparent thumbnail without cropping',async()=>{
 const quarter=createEdenPublicQuarter(()=>0)!,interiors=createEdenInteriors(()=>0)!;let rendered=0;const captures:{points:THREE.Vector3[]}[]=[];
 const renderer={autoClear:false,getRenderTarget:()=>null,setRenderTarget(){},getViewport:(v:THREE.Vector4)=>v,setViewport(){},getScissor:(v:THREE.Vector4)=>v,setScissor(){},getScissorTest:()=>false,setScissorTest(){},getClearColor:(v:THREE.Color)=>v,getClearAlpha:()=>1,setClearColor(){},render(scene:THREE.Scene,camera:THREE.Camera){
  rendered++;camera.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(scene),points:THREE.Vector3[]=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(camera));
  captures.push({points});
  throw Error('geometry-only projection capture');
 }};
 const previews=new WorldPlacePreviews(renderer as unknown as THREE.WebGLRenderer,()=>[quarter.group,interiors.group]);
 try{for(const id of ['gallery','library','int-office-studio'] as const)await previews.capture(id);assert.equal(rendered,3);for(const {points} of captures){assert.ok(points.every(p=>Math.abs(p.x)<=.881&&Math.abs(p.y)<=.881&&p.z>-1&&p.z<1),JSON.stringify(points.map(p=>p.toArray())));const width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));assert.ok(Math.max(width,height)>=1.4,JSON.stringify({width,height,points:points.map(p=>p.toArray())}));}}finally{previews.dispose();interiors.dispose();quarter.dispose();}
});
