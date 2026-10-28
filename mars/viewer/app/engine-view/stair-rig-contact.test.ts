import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import manifest from './stair-mesh-profiles.json' with {type:'json'};
import {meshStairFlight,type MeshStairProfile} from './stair-mesh-profile.ts';
import {gaitAt,axisPoint,stairFootTarget} from './stair-gait.ts';
import {stairBearingRotation,stairContactEnvelope} from './stair-rig-contact.ts';
const profile=manifest.profiles[1] as MeshStairProfile;
test('actual mesh entry/exit is guarded by rig reach; far flat and generic flights keep their old behavior',()=>{
 const f=meshStairFlight(profile,'real',{x:10,y:-.2403,z:0,yaw:0,s:1})!,envelope={reach:.95,blend:.3};
 const at=(s:number,y:number)=>{const[x,z]=axisPoint(f,s,0);return gaitAt(f,x,z,y,envelope);};
 // Retained frame68's body is behind the authored link while its stride reaches tread1.
 assert.equal(gaitAt(f,10.535667,.622,0)?.weight??0,0);
 assert.equal(gaitAt(f,10.535667,.622,0,envelope)?.weight,1);
 const enter=f.supports![0].lo-envelope.reach,exit=f.supports!.at(-1)!.hi+envelope.reach;
 assert.equal(at(enter-envelope.blend-.01,f.yBottom),null);assert.equal(at(exit+envelope.blend+.01,f.yTop),null);
 assert.ok(at(enter-envelope.blend+1e-5,f.yBottom)!.weight<1e-7);
 assert.ok(at(exit+envelope.blend-1e-5,f.yTop)!.weight<1e-7);
 assert.equal(gaitAt({...f,supports:undefined},10.535667,.622,0,envelope)?.weight??0,0,'generic path never consumes measured mesh envelope');
 const moved=meshStairFlight(profile,'moved',{x:-20,y:2,z:8,yaw:.8,s:1.4})!,s=moved.supports![0].lo-envelope.reach,[x,z]=axisPoint(moved,s,0);
 assert.equal(gaitAt(moved,x,z,moved.yBottom,envelope)?.weight,1);assert.equal(gaitAt(moved,x,z,moved.yTop+2,envelope),null);
});
test('shoe-derived blend follows body heading; bearing orientation is continuous through plant/swing',()=>{
 const metrics={reach:1,length:.3,width:.1,normals:new Map<number,THREE.Vector3>()};
 assert.equal(stairContactEnvelope(metrics,0,[1,0]).blend,.3);assert.ok(Math.abs(stairContactEnvelope(metrics,Math.PI/2,[1,0]).blend-.1)<1e-12);
 const rest=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.44),localDown=new THREE.Vector3(0,-1,0),flat=stairBearingRotation(rest,localDown);
 assert.ok(localDown.clone().applyQuaternion(flat).distanceTo(new THREE.Vector3(0,-1,0))<1e-12);
 const f=meshStairFlight(profile,'real',{x:0,y:-.2403,z:0,yaw:0,s:1})!;
 const [tx,tz]=axisPoint(f,f.treads[1].s,0),turn=gaitAt(f,tx,tz,f.treads[1].y)!;
 for(const side of ['left','right'] as const){const a=stairFootTarget(f,turn,side,.1,Math.PI/2-1e-7),b=stairFootTarget(f,turn,side,.1,Math.PI/2+1e-7);assert.ok(Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1])<1e-6,'turning through perpendicular cannot flip the measured stance');}
 for(const u of [.5,1.3,1.5,2.3]){
  const s=f.treads[0].s+(u-1)*f.going,[a,z]=axisPoint(f,s-1e-7,0),[b]=axisPoint(f,s+1e-7,0),before=gaitAt(f,a,z,f.yBottom,{reach:1,blend:.3})!,after=gaitAt(f,b,z,f.yBottom,{reach:1,blend:.3})!;
  if(!before||!after)continue;
  for(let i=0;i<2;i++)assert.ok(Math.hypot(before.feet[i].s-after.feet[i].s,before.feet[i].y-after.feet[i].y)<1e-5);
 }
});
