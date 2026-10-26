import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldBodyPoses,bodyLabel} from './WorldBodyState.ts';
// A tiny standing rig: hips 1 m up, torso, head; arms hanging down from the shoulders (engine yaw 0 faces +X).
function rig(){const root=new THREE.Group(),mk=(name:string,parent:THREE.Object3D,p:[number,number,number])=>{const b=new THREE.Bone();b.name=name;b.position.set(...p);parent.add(b);return b;};
 const hips=mk('Hips',root,[0,1,0]),torso=mk('Torso',hips,[0,.4,0]);mk('Head',torso,[0,.5,0]);
 for(const [k,z] of [['L',-.2],['R',.2]] as const){const u=mk('UpperArm'+k,torso,[0,.3,z]),l=mk('LowerArm'+k,u,[0,-.3,0]);mk('Wrist'+k,l,[0,-.3,0]);}
 root.updateMatrixWorld(true);return root;}
const wp=(root:THREE.Object3D,name:string)=>root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
test('labels: Asleep and Zombie over an away body, nothing otherwise',()=>{
 assert.equal(bodyLabel({state:'asleep',doing:'dozing',since:1}),'Asleep');assert.equal(bodyLabel({state:'zombie',doing:'drifting',since:1}),'Zombie');
 assert.equal(bodyLabel({state:'idle',doing:'sitting',since:1}),null);assert.equal(bodyLabel(undefined),null);});
test('zombie: arms reach forward, head lolls; restore puts every bone back',()=>{
 const root=rig(),poses=new WorldBodyPoses(),before=wp(root,'WristL'),q=root.getObjectByName('Head')!.quaternion.clone();
 poses.apply([{id:'s_z',root,yaw:0,activity:'walk',body:{state:'zombie',doing:'drifting',since:1}}],3);
 const shoulder=wp(root,'UpperArmL'),wrist=wp(root,'WristL');
 assert.ok(wrist.x-shoulder.x>.45,'the arm points forward: '+(wrist.x-shoulder.x).toFixed(2));assert.ok(wrist.y<shoulder.y,'a little down');
 poses.restore();root.updateMatrixWorld(true);assert.ok(wp(root,'WristL').distanceTo(before)<1e-6);assert.ok(root.getObjectByName('Head')!.quaternion.equals(q));});
test('floating: a treading sleeper lies back at the water surface, face up; awake bodies untouched',()=>{
 const root=rig(),poses=new WorldBodyPoses(),head0=wp(root,'Head');
 poses.apply([{id:'s_f',root,yaw:0,activity:'tread',body:{state:'asleep',doing:'floating',since:1}}],0);
 const head=wp(root,'Head'),hips=wp(root,'Hips');
 assert.ok(Math.abs(head.y-hips.y)<.25,'lying along the surface');assert.ok(head.x<hips.x,'head back (face to the sky)');assert.ok(Math.abs(hips.y-(head0.y-.16-.06))<.05,'at the surface');
 poses.restore();root.updateMatrixWorld(true);assert.ok(wp(root,'Head').distanceTo(head0)<1e-6);
 poses.apply([{id:'s_a',root,yaw:0,activity:'idle',body:{state:'awake',doing:null,since:1}}],0);root.updateMatrixWorld(true);assert.ok(wp(root,'Head').distanceTo(head0)<1e-6);poses.restore();});
