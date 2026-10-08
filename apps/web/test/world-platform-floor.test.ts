import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePlatformFloors,platformFloorOffset} from '../../../mars/viewer/lib/platform-floor.ts';
import {projectPlatformFrame} from '../../../mars/viewer/app/engine-view/recorded-platforms.ts';
import type {TakeFrame} from '../../../mars/viewer/engine/take/replay.ts';
import * as THREE from 'three';
import {WorldPlatforms} from '../src/WorldPlatforms.ts';
const original=JSON.parse(readFileSync(new URL('../../../worlds/eden/activity-spots.v1.json',import.meta.url),'utf8'));
const platforms=parsePlatformFloors(original.platforms);
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('declared stage, bandstand and greenhouse floors match authored heights without mutating metadata',()=>{
 const before=JSON.stringify(platforms);near(platformFloorOffset(platforms,92,-30,0),.6);near(platformFloorOffset(platforms,38.5,-26,0),.35);near(platformFloorOffset(platforms,69,35,0),.45);
 near(platformFloorOffset(platforms,0,0,0),0);assert.equal(JSON.stringify(platforms),before);
});
test('stage ramp increases from ground through midpoint to deck and survives random-access reversal',()=>{
 near(platformFloorOffset(platforms,92,-24.4,0),0);near(platformFloorOffset(platforms,92,-26.2,0),.3);near(platformFloorOffset(platforms,92,-28,0),.6);
 near(platformFloorOffset(platforms,92,-26.2,0),.3);near(platformFloorOffset(platforms,91,-26.2,0),0);
});
test('native elevated records are not lifted a second time; invalid and unbounded floor metadata is dropped',()=>{
 near(platformFloorOffset(platforms,92,-30,.6),0);near(platformFloorOffset(platforms,92,-30,8),0);near(platformFloorOffset(platforms,92,-30,NaN),0);
 assert.deepEqual(parsePlatformFloors([{id:'bad',c:[0,0],half:[1,-1],top:.4},{id:'bad',c:[0,0],r:1,top:Infinity}]),[]);
 near(platformFloorOffset(parsePlatformFloors([{id:'turned',c:[0,0],half:[2,1],yaw:Math.PI/2,top:.5}]),0,1.5,0),.5);
 near(platformFloorOffset(parsePlatformFloors([{id:'turned',c:[0,0],half:[2,1],yaw:Math.PI/2,top:.5}]),1.5,0,0),0);
});
test('drawn performers and absolute scenery seats share floor offsets; beams and native hands retain authority',()=>{
 const entity=(state:Record<string,unknown>={})=>({p:[92,0,-30] as [number,number,number],yaw:0,pitch:0,roll:0,level:0,state});
 const frame:TakeFrame={t:0,tick:0,entities:{performer:entity({seatHeight:.88}),beam:entity({on:'beam:1'}),builder:{...entity(),hands:{right:[92,.8,-30]}},part:entity()}};
 const records=Object.fromEntries(Object.keys(frame.entities).map(id=>[id,{kind:id==='part'?'component':'human'}]));const before=JSON.stringify(frame);
 const drawn=projectPlatformFrame(frame,records,platforms);near(drawn.entities.performer.p[1],.6);near(Number(drawn.entities.performer.state.seatHeight),.28);
 assert.equal(drawn.entities.beam,frame.entities.beam);assert.equal(drawn.entities.builder,frame.entities.builder);assert.equal(drawn.entities.part,frame.entities.part);assert.equal(JSON.stringify(frame),before);
 assert.equal(projectPlatformFrame(frame,records,[]),frame,'unbound historical frames do not borrow current platform metadata');
});
test('captured fallback has real deck/ramp support and retires when current authored scenery draws',()=>{
 // Mesh positions are Float32; a 1-micrometre geometry tolerance still exceeds the recorded 1mm precision by1000x.
 const meshNear=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
 const owner=new WorldPlatforms();owner.set(platforms,0,false);assert.equal(owner.group.visible,true);
 const ray=new THREE.Raycaster(new THREE.Vector3(92,5,-30),new THREE.Vector3(0,-1,0));owner.group.updateMatrixWorld(true);meshNear(ray.intersectObject(owner.group,true)[0].point.y,.6);
 ray.set(new THREE.Vector3(92,5,-26.2),new THREE.Vector3(0,-1,0));meshNear(ray.intersectObject(owner.group,true)[0].point.y,.3);
 owner.set(platforms,0,true);assert.equal(owner.group.visible,false);owner.set([],0,false);assert.equal(owner.group.children.length,0);owner.dispose();
});
