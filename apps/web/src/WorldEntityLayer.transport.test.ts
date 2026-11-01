import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {registerHooks} from 'node:module';import {arrivalMark} from './arrival-marks.ts';
arrivalMark('card-done');
test('two-hand transport follows recorded native pose until persisted arrival, then releases override',async()=>{
 (globalThis as {location?:unknown}).location??=new URL('http://offline.invalid/w/fixture');
 const index=new URL('./gen-mesh/index.ts',import.meta.url).href,h=registerHooks({load(url,c,next){return url===index?{format:'module',shortCircuit:true,source:"export {meshFor} from './registry.ts';"}:next(url,c);}});
 const {WorldEntityLayer}=await import('./WorldEntityLayer.ts').finally(()=>h.deregister());const layer=new WorldEntityLayer(p=>p);layer.active=true;const a=layer as any;
 const entity={id:'load',name:'crate',def:'crate',in:{parent:'world'}},obj=new THREE.Group();a.thingsGroup.add(obj);a.model={entities:new Map([['load',entity]]),resolvedDef:()=>({tags:['upright-carry']}),ground:()=>({extent:[0,0,0,0]})};const zero=new THREE.Vector3();a.drawn.set('load',{obj,from:{p:zero,s:1},to:{p:zero.clone(),s:1},t0:0,dur:.001,defHash:'load',world:true,settled:true});
 const frame:any={body:{p:[0,0,0],yaw:0,state:{grip:{entity:'load'}}},load:{p:[3,.6,2],yaw:.8,state:{}}};
 layer.transportPoses(frame,['body']);layer.update(.016,30000);assert.deepEqual(obj.position.toArray(),[3,.6,2]);assert.ok(Math.abs(obj.rotation.y+.8)<1e-8);
 delete frame.body.state.grip;frame.load.p=[4,0,2];layer.transportPoses(frame,['body']);layer.update(.016,30016);assert.deepEqual(obj.position.toArray(),[4,0,2],'no snap back during final write-back lag');
 a.drawn.get('load').to.p.set(4,0,2);a.drawn.get('load').from.p.set(4,0,2);layer.transportPoses(frame,['body']);layer.update(.016,30032);assert.equal(a.transported.size,0);assert.equal(a.overrides.size,0);assert.deepEqual(obj.position.toArray(),[4,0,2]);
 layer.dispose();
});
