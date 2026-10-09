import {authoredBoundaryDeclarationV1} from '../../../packages/engine-contract/src/authored-boundaries-v1.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {WorldAuthoredBoundaries} from '../src/WorldAuthoredBoundaries.ts';
const box={id:'wall',buildingId:'house',kind:'guard' as const,c:[0,3.625,0] as[number,number,number],half:[1,.525,.04] as[number,number,number],yaw:0};
const captured=(collision?:string)=>({body:{scene:{authoredBoundaries:{...authoredBoundaryDeclarationV1('fixture-source',[{...box,...(collision?{collision}:{})}]),acceptedAtTick:20}}}});
void test('same accepted captured prism constrains manual camera body extent and preserves gaze; old/tick-before/decorative are inert',()=>{
 const owner=new WorldAuthoredBoundaries();owner.bind(captured());assert.equal(owner.at(19).length,0);assert.equal(owner.at(20).length,1);
 const camera=new THREE.PerspectiveCamera(),from=new THREE.Vector3(0,4.75,-1),target=new THREE.Vector3(0,4.75,2);camera.position.set(0,4.75,1);const gaze=target.clone().sub(camera.position);assert.equal(owner.constrain(camera,target,from,20),true);assert.ok(camera.position.z<0);assert.deepEqual(target.clone().sub(camera.position).toArray(),gaze.toArray());
 owner.bind(captured('decorative'));assert.equal(owner.at(20).length,0);owner.bind({body:{scene:{}}});assert.equal(owner.at(100).length,0);
});
void test('malformed/duplicate prisms or absent publication never acquire current renderer registration as collision authority',()=>{
 const owner=new WorldAuthoredBoundaries();for(const change of[(v:ReturnType<typeof captured>)=>{v.body.scene.authoredBoundaries.boxes[0].half[1]=0;},(v:ReturnType<typeof captured>)=>{v.body.scene.authoredBoundaries.boxes.push(v.body.scene.authoredBoundaries.boxes[0]);},(v:ReturnType<typeof captured>)=>{v.body.scene.authoredBoundaries.sourceHash='bad';},(v:ReturnType<typeof captured>)=>{v.body.scene.authoredBoundaries.acceptedAtTick=-1;}]){const v=captured();change(v);owner.bind(v);assert.equal(owner.at(100).length,0);}
 owner.bind(null);assert.equal(owner.at(100).length,0);
});
