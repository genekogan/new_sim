import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WorldSoulAvatars,soulAvatars} from '../src/SoulAvatars.ts';

test('portrait capture restores shared renderer state on success and render failure',()=>{
 const previousDocument=globalThis.document;
 let image:Uint8ClampedArray|null=null;
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:(v:{data:Uint8ClampedArray})=>{image=v.data;}}),toDataURL:()=> 'data:image/png;base64,private-test'})} as unknown as Document;
 const originalTarget=new THREE.WebGLRenderTarget(30,40),viewport=new THREE.Vector4(2,3,20,25),scissor=new THREE.Vector4(1,2,15,20);
 let current:THREE.WebGLRenderTarget|null=originalTarget,actualViewport=viewport.clone(),actualScissor=scissor.clone(),scissorTest=true,throwRender=false,disposed=false;
 const renderer={autoClear:false,getRenderTarget:()=>current,getViewport:(out:THREE.Vector4)=>out.copy(actualViewport),getScissor:(out:THREE.Vector4)=>out.copy(actualScissor),getScissorTest:()=>scissorTest,
  setRenderTarget:(v:THREE.WebGLRenderTarget|null)=>{current=v;},setViewport:(v:THREE.Vector4)=>{actualViewport.copy(v);},setScissor:(v:THREE.Vector4)=>{actualScissor.copy(v);},setScissorTest:(v:boolean)=>{scissorTest=v;},
  render:(scene:THREE.Scene)=>{assert.equal(current?.width,96);assert.equal(current?.height,96);assert.equal(scene.getObjectByName('activity prop: test-book'),undefined,'neutral portrait excludes carried props');if(throwRender)throw Error('GPU failure');},
  readRenderTargetPixels:(_t:unknown,_x:number,_y:number,w:number,h:number,bytes:Uint8Array)=>{for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=(y*w+x)*4;bytes[at]=y;bytes[at+3]=255;}},dispose:()=>{disposed=true;},
 };
 const body=new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshBasicMaterial()));
 body.name='actual-entity-body';body.userData.bodyModel='owned-model-instance';
 const prop=new THREE.Group();prop.name='activity prop: test-book';prop.add(new THREE.Mesh(new THREE.BoxGeometry(.1,.2,.1),new THREE.MeshBasicMaterial()));body.add(prop);
 const owner=new WorldSoulAvatars(renderer as unknown as THREE.WebGLRenderer);
 try{
  owner.capture('avatar-state-test','bodyA',body,true,1000);
  assert.equal(soulAvatars.images.get('avatar-state-test'),'data:image/png;base64,private-test');
  assert.deepEqual(soulAvatars.sources.get('avatar-state-test'),{entityId:'actual-entity-body',model:'owned-model-instance',bodyRoot:body.uuid});
  assert.equal((image as unknown as Uint8ClampedArray)[0],95,'WebGL bottom row flips to canvas top');
  const restored=()=>{assert.equal(current,originalTarget);assert.deepEqual(actualViewport.toArray(),viewport.toArray());assert.deepEqual(actualScissor.toArray(),scissor.toArray());assert.equal(scissorTest,true);assert.equal(renderer.autoClear,false);assert.equal(disposed,false);};
  restored();throwRender=true;owner.capture('avatar-state-test','bodyB',body,true,1400);restored();assert.equal(soulAvatars.images.get('avatar-state-test'),undefined,'failed new body capture cannot retain a different old body portrait');owner.dispose();assert.equal(disposed,false,'view owns the shared renderer');
 }finally{globalThis.document=previousDocument;soulAvatars.images.delete('avatar-state-test');soulAvatars.sources.delete('avatar-state-test');originalTarget.dispose();body.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh){m.geometry.dispose();for(const mat of [m.material].flat())mat.dispose();}});}
});
