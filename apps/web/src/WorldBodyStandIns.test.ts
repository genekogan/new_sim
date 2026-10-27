import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldBodyStandIns} from './WorldBodyStandIns.ts';
const ready={unresolved:false,customReady:true,uploaded:false,legacyReady:false};
function scene(){const group=new THREE.Group(),body=new THREE.Group();return {group,body,standIns:new WorldBodyStandIns(group,new THREE.BoxGeometry(),new THREE.MeshBasicMaterial())};}
test('pending custom look keeps a figure then reveals the same resolved body without a legacy template',()=>{
 const {group,body,standIns}=scene();standIns.sync('s',[2,3,4],body,{...ready,unresolved:true,customReady:false});
 assert.equal(body.visible,false);assert.equal(group.children.length,1);assert.deepEqual(group.children[0].position.toArray(),[2,3.82,4]);
 standIns.sync('s',[2,3,4],body,ready);assert.equal(body.visible,true);assert.equal(group.children.length,0);
});
test('loaded template with absent replacement keeps stand-in through lazy-renderer handoff',()=>{
 const {group,body,standIns}=scene();standIns.sync('s',[0,0,0],null,ready);assert.equal(group.children.length,1);
 standIns.sync('s',[0,0,0],body,ready);assert.equal(group.children.length,0);assert.equal(body.visible,true);
});
test('failed loading keeps fallback; stand-ins never revive another owner hidden body',()=>{
 const {group,body,standIns}=scene();body.visible=false;
 for(let i=0;i<3;i++)standIns.sync('s',[0,0,0],body,{...ready,unresolved:true});assert.equal(group.children.length,1);
 standIns.sync('s',[0,0,0],body,ready);assert.equal(body.visible,false);assert.equal(group.children.length,0);
});
test('legacy and uploaded readiness resolve; departed figures disappear',()=>{
 const {group,body,standIns}=scene();for(const r of[{...ready,customReady:false,legacyReady:true},{...ready,customReady:false,uploaded:true}]){standIns.sync('s',[0,0,0],body,{...r,unresolved:true});standIns.sync('s',[0,0,0],body,r);assert.equal(body.visible,true);assert.equal(group.children.length,0);}
 standIns.sync('gone',[0,0,0],null,ready);standIns.finish(new Set());assert.equal(group.children.length,0);
});
