import test from 'node:test';import assert from 'node:assert/strict';
import {authoredBoundarySweepFraction,type AuthoredBoundaryBox} from '../../../mars/viewer/lib/authored-boundaries.ts';
const box:AuthoredBoundaryBox={id:'box',buildingId:'building',kind:'wall',c:[0,0,0],half:[1,1,1],yaw:0};
test('inside escape follows the nearest actual exit face, including a rotated prism',()=>{
 assert.equal(authoredBoundarySweepFraction([box],[.5,0,0],[.6,0,-5],0),0,'positive X drift cannot permit first exit at -Z');
 assert.equal(authoredBoundarySweepFraction([box],[.5,0,0],[2,0,.1],0),1,'nearest +X escape remains permitted');
 const yaw=.71,rotate=(p:number[])=>[p[0]*Math.cos(yaw)-p[2]*Math.sin(yaw),p[1],p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw)];
 assert.equal(authoredBoundarySweepFraction([{...box,yaw}],rotate([.5,0,0]),rotate([.6,0,-5]),0),0);
 assert.equal(authoredBoundarySweepFraction([{...box,yaw}],rotate([.5,0,0]),rotate([2,0,.1]),0),1);
});
test('feet tangent to a doorway lower band are clear; actual penetration and inward contact remain blocked',()=>{
 const floor=3.12,wall:AuthoredBoundaryBox={...box,c:[0,floor-.5,0],half:[2,.5,.09]};
 assert.equal(authoredBoundarySweepFraction([wall],[0,floor+1.65,-1],[0,floor+1.65,1],.08,1.65,.1),1,'supported foot on the band top does not penetrate it');
 assert.ok(authoredBoundarySweepFraction([wall],[0,floor+1.65-.001,-1],[0,floor+1.65-.001,1],.08,1.65,.1)<1,'one millimetre actual penetration still collides');
 assert.equal(authoredBoundarySweepFraction([box],[1,0,0],[0,0,0],0),0,'contact followed by inward motion blocks at the face');
});
test('renderer may declare Float32 floor contact precision without changing native default or actual penetration',()=>{
 const floor=3.12,drawn=Math.fround(floor),wall:AuthoredBoundaryBox={...box,c:[0,floor-.5,0],half:[2,.5,.09]},from=[0,drawn+1.65,-1],to=[0,drawn+1.65,1];
 assert.ok(floor-drawn>1e-10&&floor-drawn<1e-6);
 assert.equal(authoredBoundarySweepFraction([wall],from,to,.08,1.65,.1,1e-6),1,'Float32 surface contact is clear at explicitly selected renderer precision');
 assert.ok(authoredBoundarySweepFraction([wall],from,to,.08,1.65,.1)<1,'native/default double-precision seam remains unchanged');
 assert.ok(authoredBoundarySweepFraction([wall],[0,floor+1.65-.001,-1],[0,floor+1.65-.001,1],.08,1.65,.1,1e-6)<1,'real1mm penetration stays blocked');
});
